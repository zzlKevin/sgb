package com.smilelight.voice;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import com.cocos.lib.JsbBridgeWrapper;

import org.json.JSONObject;

import java.util.ArrayList;

/**
 * VoiceRecognitionHelper - 神光棒 TV6 安卓语音识别辅助类 v5
 *
 * ⚠️ 正确放置位置：
 *   native/engine/android/app/src/main/java/com/smilelight/voice/VoiceRecognitionHelper.java
 *
 * 桥接 API（Cocos 3.8.8 引擎源码核实）：
 *   TS → Java : native.jsbBridgeWrapper.dispatchEventToNative(event, arg)
 *               → 本类 addScriptEventListener(...) 收到
 *   Java → TS : dispatchToScript(event, data)
 *               → TS 端 native.jsbBridgeWrapper.addNativeEventListener(event, cb) 收到
 *
 * 事件协议：
 *   initVoiceRecognition  (TS→Java)  握手，收到后回发 onVoiceReady
 *   startVoiceRecognition (TS→Java)  开始监听
 *   stopVoiceRecognition  (TS→Java)  停止监听
 *   onVoiceReady          (Java→TS)  初始化完成
 *   onVoiceResult         (Java→TS)  {text, confidence, isFinal}
 *   onVoiceError          (Java→TS)  安卓标准错误码 1~9
 */
public class VoiceRecognitionHelper {

    private static final String TAG = "VoiceRecognitionHelper";

    private static SpeechRecognizer sRecognizer = null;
    private static boolean sInitialized = false;
    private static boolean sListening = false;

    /**
     * ⚠️ 崩溃教训（SIGABRT 实测）：
     * onCreate 阶段 Cocos 的 JS 引擎还没启动，此时调 dispatchEventToScript
     * 会在 native 层 ApplicationManager::getCurrentAppSafe() 直接 abort 杀进程，
     * Java 的 try-catch 根本拦不住（不是异常，是 native abort）。
     * 所以：Java 绝不主动发事件，必须等 TS 先发握手（initVoiceRecognition）过来，
     * 此时引擎必然已就绪，回发才安全。sTsReady 就是这道闸门。
     */
    private static volatile boolean sTsReady = false;

    /** 设备不支持语音识别（延迟到握手后上报，不能在 onCreate 期间上报） */
    private static boolean sUnavailable = false;

    /** 权限被拒（延迟到握手后上报） */
    private static boolean sPermissionDenied = false;

    // ═════════════════════════════════════════
    // 初始化（AppActivity onCreate 调用，此时只做纯 Java 工作，绝不向 TS 发事件）
    // ═════════════════════════════════════════

    public static void init(Context context) {
        if (sInitialized) return;

        try {
            // 设备可用性检查（国产 ROM 缺谷歌服务时常见不可用）
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                Log.w(TAG, "本机没有可用的语音识别服务（缺少谷歌服务/语音引擎）");
                sUnavailable = true;
                // ⚠️ 不在这里 dispatch！onCreate 阶段发事件 = SIGABRT 闪退
                // 握手后由 handleTsReady 统一上报
            }

            if (!sUnavailable) {
                sRecognizer = SpeechRecognizer.createSpeechRecognizer(context);
                sRecognizer.setRecognitionListener(sRecognitionListener);
            }

            JsbBridgeWrapper jbw = JsbBridgeWrapper.getInstance();

            // TS→Java 事件注册（OnScriptEventListener 单参数，引擎源码核实的接口名）
            // 注册本身是纯 Java 操作，onCreate 阶段安全
            jbw.addScriptEventListener("initVoiceRecognition", new JsbBridgeWrapper.OnScriptEventListener() {
                @Override
                public void onScriptEvent(String arg) {
                    Log.d(TAG, "收到 TS 就绪握手");
                    handleTsReady();
                }
            });

            jbw.addScriptEventListener("startVoiceRecognition", new JsbBridgeWrapper.OnScriptEventListener() {
                @Override
                public void onScriptEvent(String arg) {
                    startListening();
                }
            });

            jbw.addScriptEventListener("stopVoiceRecognition", new JsbBridgeWrapper.OnScriptEventListener() {
                @Override
                public void onScriptEvent(String arg) {
                    stopListening();
                }
            });

            sInitialized = true;
            Log.d(TAG, "语音识别初始化完成（已挂监听，等 TS 握手，不发任何事件）");

        } catch (Throwable t) {
            // 捕获一切异常（含 NoClassDefFoundError），语音模块绝不拖崩 APP
            Log.e(TAG, "初始化失败（语音停用，APP 继续运行）", t);
            sInitialized = false;
        }
    }

    /**
     * TS 握手到达 → 引擎已就绪，现在才允许向 TS 发事件。
     * 把初始化期间积累的状态一次性上报。
     */
    private static void handleTsReady() {
        sTsReady = true;
        try {
            if (sPermissionDenied) {
                dispatchToScript("onVoiceError", "9");
                return;
            }
            if (sUnavailable) {
                dispatchToScript("onVoiceError", "5");
                return;
            }
            dispatchToScript("onVoiceReady", "1");
        } catch (Throwable t) {
            Log.e(TAG, "handleTsReady 异常", t);
        }
    }

    /** 权限被拒时记录，握手后上报（错误码 9 = INSUFFICIENT_PERMISSIONS） */
    public static void notifyPermissionDenied() {
        sPermissionDenied = true;
        if (sTsReady) {
            dispatchToScript("onVoiceError", "9");
        }
        // 未握手时不上报，等 handleTsReady 统一处理
    }

    // ═════════════════════════════════════════
    // 监听控制
    // ═════════════════════════════════════════

    public static void startListening() {
        if (!sInitialized || sRecognizer == null) {
            Log.w(TAG, "未初始化，无法开始识别");
            return;
        }
        if (sListening) return;

        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            sRecognizer.startListening(intent);
            sListening = true;
            Log.d(TAG, "开始监听（通知栏应出现麦克风标识）");
        } catch (Throwable t) {
            Log.e(TAG, "startListening 失败", t);
            sListening = false;
            dispatchToScript("onVoiceError", "5");
        }
    }

    public static void stopListening() {
        if (!sInitialized || sRecognizer == null) return;
        try {
            sRecognizer.stopListening();
            Log.d(TAG, "停止监听");
        } catch (Throwable t) {
            Log.e(TAG, "stopListening 失败", t);
        }
        sListening = false;
    }

    public static void destroy() {
        try {
            if (sRecognizer != null) {
                sRecognizer.destroy();
                sRecognizer = null;
            }
        } catch (Throwable t) {
            // 忽略
        }
        sInitialized = false;
        sListening = false;
    }

    // ═════════════════════════════════════════
    // 识别回调
    // ═════════════════════════════════════════

    private static final RecognitionListener sRecognitionListener = new RecognitionListener() {
        @Override
        public void onResults(Bundle results) {
            sListening = false;
            try {
                ArrayList<String> list =
                        results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (list == null || list.isEmpty()) return;

                String text = list.get(0);
                float[] confArr = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
                float conf = (confArr != null && confArr.length > 0) ? confArr[0] : 0.8f;

                JSONObject json = new JSONObject();
                json.put("text", text);
                json.put("confidence", (double) conf);
                json.put("isFinal", true);

                Log.d(TAG, "识别结果: " + text + " (conf=" + conf + ")");
                dispatchToScript("onVoiceResult", json.toString());
            } catch (Throwable t) {
                Log.e(TAG, "识别结果处理失败", t);
            }
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            // 中间结果不上报，等最终结果
        }

        @Override
        public void onError(int error) {
            sListening = false;
            Log.w(TAG, "识别错误 code=" + error + " (" + errorName(error) + ")");
            dispatchToScript("onVoiceError", String.valueOf(error));
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            Log.d(TAG, "就绪，可以说话了");
        }

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {
            Log.d(TAG, "说话结束，识别中...");
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    };

    /** 错误码中文名（logcat 排障用） */
    private static String errorName(int code) {
        switch (code) {
            case 1: return "网络超时";
            case 2: return "网络错误";
            case 3: return "音频错误";
            case 4: return "服务端错误";
            case 5: return "客户端错误";
            case 6: return "无语音超时";
            case 7: return "无匹配结果";
            case 8: return "识别器忙";
            case 9: return "权限不足";
            default: return "未知(" + code + ")";
        }
    }

    // ═════════════════════════════════════════
    // Java → TS 派发
    // ═════════════════════════════════════════

    private static void dispatchToScript(String event, String data) {
        // 闸门：TS 未握手 = JS 引擎未就绪 = 发事件必 SIGABRT 闪退
        if (!sTsReady) {
            Log.w(TAG, "跳过向 TS 发送 " + event + "（引擎未就绪，发送会闪退）");
            return;
        }
        try {
            // 引擎源码核实的方法名是 dispatchEventToScript（不是 emitEventToScript）
            JsbBridgeWrapper.getInstance().dispatchEventToScript(event, data);
        } catch (Throwable t) {
            // 引擎桥异常，静默失败，绝不拖崩 APP
        }
    }
}
