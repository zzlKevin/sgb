package com.cocos.game.voice;

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
 * VoiceRecognitionHelper
 * 神光棒 TV6 - 安卓语音识别辅助类
 *
 * 适配 Cocos Creator 3.8.x：
 *   - 通过 JsbBridgeWrapper 与 TS 层通信（com.cocos.lib 包）
 *   - TS → Java: nativeBridge.sendToNative('xxx', '') → addScriptEventListener('xxx') 收到
 *   - Java → TS: emitEventToScript('xxx', data) → nativeBridge.addEventListener('xxx') 收到
 *
 * 放置位置：build/android/proj/src/com/cocos/game/voice/VoiceRecognitionHelper.java
 * （如果你的项目包名不是 com.cocos.game，请把第一行 package 和目录结构改成你的实际包名）
 *
 * 事件协议：
 *   initVoiceRecognition  (TS→Java)  初始化
 *   startVoiceRecognition (TS→Java)  开始识别
 *   stopVoiceRecognition  (TS→Java)  停止识别
 *   onVoiceReady   (Java→TS)  初始化完成 "1"
 *   onVoiceResult  (Java→TS)  识别结果 JSON: {"text":"..","confidence":0.9,"isFinal":true}
 *   onVoiceError   (Java→TS)  错误码 数字字符串
 */
public class VoiceRecognitionHelper {

    private static final String TAG = "VoiceRecognition";

    private static SpeechRecognizer sRecognizer = null;
    private static boolean sInitialized = false;

    private VoiceRecognitionHelper() {}

    /**
     * 初始化（在 AppActivity.onCreate 中调用）
     */
    public static void init(Context context) {
        if (sInitialized) {
            Log.d(TAG, "已初始化，跳过");
            return;
        }

        // 检查设备是否支持语音识别
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            Log.w(TAG, "此设备不支持语音识别（无语音识别服务）");
            emitToScript("onVoiceError", "7"); // NOT_AVAILABLE
            return;
        }

        try {
            sRecognizer = SpeechRecognizer.createSpeechRecognizer(context);
            sRecognizer.setRecognitionListener(sRecognitionListener);
            sInitialized = true;

            // ── 注册 TS → Java 事件 ──
            JsbBridgeWrapper.getInstance().addScriptEventListener("initVoiceRecognition",
                new JsbBridgeWrapper.ScriptEventListener() {
                    @Override
                    public void onScriptEvent(String eventName, String data) {
                        Log.d(TAG, "收到 TS 初始化确认");
                        emitToScript("onVoiceReady", "1");
                    }
                });

            JsbBridgeWrapper.getInstance().addScriptEventListener("startVoiceRecognition",
                new JsbBridgeWrapper.ScriptEventListener() {
                    @Override
                    public void onScriptEvent(String eventName, String data) {
                        startListening();
                    }
                });

            JsbBridgeWrapper.getInstance().addScriptEventListener("stopVoiceRecognition",
                new JsbBridgeWrapper.ScriptEventListener() {
                    @Override
                    public void onScriptEvent(String eventName, String data) {
                        stopListening();
                    }
                });

            Log.d(TAG, "语音识别初始化完成");
            emitToScript("onVoiceReady", "1");
        } catch (Exception e) {
            Log.e(TAG, "初始化失败", e);
            emitToScript("onVoiceError", "5"); // CLIENT_ERROR
        }
    }

    /**
     * 开始监听（中文识别）
     */
    public static void startListening() {
        if (!sInitialized || sRecognizer == null) {
            Log.w(TAG, "未初始化，无法开始识别");
            emitToScript("onVoiceError", "5");
            return;
        }

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        // 中文识别
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, true);
        // 静音超时（用户不说话多久结束）
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2000);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);

        try {
            sRecognizer.startListening(intent);
            Log.d(TAG, "开始语音识别");
        } catch (Exception e) {
            Log.e(TAG, "启动识别失败", e);
            emitToScript("onVoiceError", "5");
        }
    }

    /**
     * 停止监听
     */
    public static void stopListening() {
        if (sRecognizer != null) {
            try {
                sRecognizer.stopListening();
            } catch (Exception e) {
                Log.e(TAG, "停止识别失败", e);
            }
            Log.d(TAG, "停止语音识别");
        }
    }

    /**
     * 销毁（在 AppActivity.onDestroy 中调用）
     */
    public static void destroy() {
        if (sRecognizer != null) {
            try {
                sRecognizer.destroy();
            } catch (Exception e) {
                Log.e(TAG, "销毁失败", e);
            }
            sRecognizer = null;
        }
        sInitialized = false;
        Log.d(TAG, "语音识别已销毁");
    }

    public static boolean isInitialized() {
        return sInitialized;
    }

    // ═════════════════════════════════════════
    // 识别结果回调
    // ═════════════════════════════════════════

    private static final RecognitionListener sRecognitionListener = new RecognitionListener() {

        @Override
        public void onResults(Bundle results) {
            ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (texts != null && !texts.isEmpty()) {
                String text = texts.get(0);
                Log.d(TAG, "识别结果: " + text);
                try {
                    JSONObject json = new JSONObject();
                    json.put("text", text);
                    json.put("confidence", 0.9);
                    json.put("isFinal", true);
                    emitToScript("onVoiceResult", json.toString());
                } catch (Exception e) {
                    // JSON 组织失败，直接发纯文本（TS 端有兼容处理）
                    emitToScript("onVoiceResult", text);
                }
            }
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            // 部分结果，忽略（避免频繁打扰 TS 层）
        }

        @Override
        public void onError(int error) {
            Log.w(TAG, "识别错误 code=" + error);
            emitToScript("onVoiceError", String.valueOf(error));
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            Log.d(TAG, "准备就绪，开始说话吧");
        }

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {
            Log.d(TAG, "说话结束");
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    };

    /** Java → TS 发事件 */
    private static void emitToScript(String event, String data) {
        try {
            JsbBridgeWrapper.getInstance().emitEventToScript(event, data);
        } catch (Exception e) {
            Log.e(TAG, "emitEventToScript 失败: " + event, e);
        }
    }
}
