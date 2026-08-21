package com.smilelight.voice;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.cocos.lib.JsbBridgeWrapper;
import com.iflytek.cloud.InitListener;
import com.iflytek.cloud.RecognizerListener;
import com.iflytek.cloud.RecognizerResult;
import com.iflytek.cloud.SpeechConstant;
import com.iflytek.cloud.SpeechError;
import com.iflytek.cloud.SpeechRecognizer;
import com.iflytek.cloud.SpeechUtility;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * VoiceRecognitionHelper - 神光棒 TV6 安卓语音识别辅助类 v7（科大讯飞离线版）
 *
 * ⚠️ 正确放置位置：
 *   native/engine/android/app/src/main/java/com/smilelight/voice/VoiceRecognitionHelper.java
 *
 * 本版改动：把安卓系统 SpeechRecognizer（依赖谷歌服务，国产 ROM 缺失）
 *           整体替换为科大讯飞 MSC SDK 离线语音听写。
 *           对 TS 层完全透明：事件协议、JSON 结构、错误码语义全部保持不变。
 *
 * ┚┚ 接入前必做（详见 README_讯飞语音接入.md）：
 *   1. 在讯飞开放平台 https://www.xfyun.cn 创建应用，开通「语音听写（流式版）」
 *      并在下载 SDK 时勾选【离线听写】能力（离线听写需付费/试用授权）。
 *   2. 把 SDK 文件放进工程：
 *        Msc.jar                → native/engine/android/app/libs/
 *        libmsc.so (各ABI)      → native/engine/android/app/libs/arm64-v8a/ 等
 *        assets/iflytek/ 离线资源 → native/engine/android/app/src/main/assets/iflytek/
 *   3. 把下面 IFLYTEK_APPID 换成你自己的 appid（注意：appid 与 APK 包名绑定，
 *      讯飞后台创建应用时填的包名必须和 Cocos 构建的包名一致，否则报 10111）。
 *
 * 桥接 API（与 v5/v6 完全一致）：
 *   TS → Java : native.jsbBridgeWrapper.dispatchEventToNative(event, arg)
 *               → 本类 addScriptEventListener(...) 收到
 *   Java → TS : JsbBridgeWrapper.getInstance().dispatchEventToScript(event, data)
 *               → TS 端 native.jsbBridgeWrapper.addNativeEventListener(...) 收到
 *
 * 事件协议（与 v5/v6 完全一致，TS 层零改动）：
 *   initVoiceRecognition  (TS→Java)  TS 就绪握手，Java 收到后回发 onVoiceReady
 *   startVoiceRecognition (TS→Java)  开始监听
 *   stopVoiceRecognition  (TS→Java)  停止监听
 *   onVoiceReady          (Java→TS)  初始化完成（TS 收到后按需自动开始监听）
 *   onVoiceResult         (Java→TS)  识别结果 JSON: {text, confidence, isFinal}
 *   onVoiceError          (Java→TS)  错误码字符串（沿用安卓标准码语义，见 mapIflytekError）
 *   onPermissionDenied    (Java→TS)  录音权限被拒
 *
 * 离线持续聆听机制：
 *   讯飞一次听写会话 = 用户说一段话 → onResult(isLast=true) 结束。
 *   TS 端收到 isFinal 结果后会自动重新发起 startVoiceRecognition（协议未变），
 *   Java 端直接再次 startListening 即可，形成「说完一段 → 自动继续听」的循环。
 */
public class VoiceRecognitionHelper {

    private static final String TAG = "VoiceRecognitionHelper";

    // ═════════════════════════════════════════
    // ⚠️⚠️⚠️ 把这里换成你的讯飞 appid ⚠️⚠️⚠️
    // 讯飞开放平台 → 控制台 → 我的应用 → APPID（8位数字+字母）
    // ═════════════════════════════════════════
    private static final String IFLYTEK_APPID = "00000000";

    // ═════════════════════════════════════════
    // 状态
    // ═════════════════════════════════════════

    private static SpeechRecognizer sRecognizer = null;
    private static final AtomicBoolean sEngineReady = new AtomicBoolean(false);
    private static volatile boolean sListening = false;      // 讯飞会话进行中
    private static volatile boolean sPendingStart = false;   // 引擎未就绪/权限未授予时挂起的开始请求
    private static volatile boolean sTsReady = false;        // TS 握手闸门（防闪退，同 v6）
    private static boolean sInitialized = false;             // init() 已调用过
    private static volatile boolean sUnavailable = false;    // 引擎彻底不可用（appid/资源错误）

    /** AppActivity 弱引用（权限检查用，避免静态持有 Activity 泄漏） */
    private static WeakReference<Activity> sActivityRef = null;

    /** 本次会话累积识别文本（讯飞分段返回，isLast 时统一上报，与原版 onPartialResults 不上报策略一致） */
    private static final StringBuilder sResultText = new StringBuilder();

    private static final Handler sMainHandler = new Handler(Looper.getMainLooper());

    // ═════════════════════════════════════════
    // 生命周期
    // ═════════════════════════════════════════

    /**
     * 初始化（AppActivity.onCreate 调用，内部有防重入）。
     * 讯飞 createRecognizer 是异步的，就绪后 sEngineReady=true；
     * 期间 TS 若先发起 startVoiceRecognition，会挂起等就绪后自动开始。
     */
    public static void init(Context context) {
        if (sInitialized) {
            Log.d(TAG, "init 已调用过，跳过");
            return;
        }
        sInitialized = true;

        if (context instanceof Activity) {
            sActivityRef = new WeakReference<>((Activity) context);
        }

        try {
            // 1. 讯飞引擎基础初始化（appid 必须与包名匹配；官方写法用 SpeechConstant.APPID）
            SpeechUtility utility = SpeechUtility.createUtility(
                    context.getApplicationContext(),
                    SpeechConstant.APPID + "=" + IFLYTEK_APPID);
            if (utility == null) {
                Log.e(TAG, "讯飞 SpeechUtility 创建失败（检查 appid 是否已替换 / Msc.jar 是否已放入 libs）");
                sUnavailable = true;
            }
        } catch (Throwable t) {
            Log.e(TAG, "SpeechUtility 创建异常（Msc.jar 未正确集成？）", t);
            sUnavailable = true;
        }

        try {
            // 2. 创建离线识别器（结果在 mInitListener 异步回调）
            sRecognizer = SpeechRecognizer.createRecognizer(
                    context.getApplicationContext(), mInitListener);
            if (sRecognizer == null) {
                Log.e(TAG, "讯飞识别器创建失败");
                sUnavailable = true;
            }
        } catch (Throwable t) {
            Log.e(TAG, "createRecognizer 异常", t);
            sUnavailable = true;
        }

        // 3. 挂 JsbBridge 监听（纯 Java 操作，引擎未就绪也安全，同 v6 策略）
        try {
            JsbBridgeWrapper.getInstance().addScriptEventListener(
                    "initVoiceRecognition", (arg) -> handleTsReady());
            JsbBridgeWrapper.getInstance().addScriptEventListener(
                    "startVoiceRecognition", (arg) -> startListening());
            JsbBridgeWrapper.getInstance().addScriptEventListener(
                    "stopVoiceRecognition", (arg) -> stopListening());
        } catch (Throwable t) {
            Log.e(TAG, "挂 JsbBridge 监听失败", t);
        }

        // 4. 引擎就绪兜底：15 秒后 onInit 仍未成功回调 → 上报致命错误（防 TS 侧无限等待）
        sMainHandler.postDelayed(() -> {
            if (!sEngineReady.get() && !sUnavailable && sRecognizer != null) {
                Log.e(TAG, "等待讯飞引擎就绪超时（15s 无 onInit 回调），上报致命错误");
                sUnavailable = true;
                dispatchToScript("onVoiceError", "5");
            }
        }, 15000);

        Log.d(TAG, "语音识别初始化完成（讯飞离线版 v7，已挂监听，等 TS 握手，不发任何事件）");
        if (sUnavailable) {
            Log.e(TAG, "⚠️ 引擎不可用：请按 README_讯飞语音接入.md 检查 SDK 文件与 appid");
        }
    }

    /** 释放（AppActivity.onDestroy 调用） */
    public static void destroy() {
        try {
            sPendingStart = false;
            sListening = false;
            if (sRecognizer != null) {
                sRecognizer.cancel();
                sRecognizer.destroy();
                sRecognizer = null;
            }
        } catch (Throwable t) {
            Log.w(TAG, "destroy 异常（忽略）", t);
        }
        sEngineReady.set(false);
        sTsReady = false;
        sInitialized = false;
    }

    /** 权限被拒回调（AppActivity 调用，协议保持） */
    public static void notifyPermissionDenied() {
        dispatchToScript("onPermissionDenied", "");
    }

    /**
     * 录音权限授予回调（AppActivity.onRequestPermissionsResult 授权成功分支调用）。
     * 首次安装场景：TS 在权限弹窗期间发起的监听请求被挂起（sPendingStart），
     * 授权成功后在此自动恢复，避免「首次启动语音永久停摆」。
     */
    public static void onPermissionGranted() {
        Log.d(TAG, "录音权限已授予");
        if (sPendingStart) {
            sMainHandler.post(() -> {
                if (sPendingStart) {
                    sPendingStart = false;
                    startListening();
                }
            });
        }
    }

    /** 是否已授予录音权限（API 23 以下安装时已授予，直接返回 true） */
    private static boolean hasRecordPermission() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                return true;
            }
            Activity activity = sActivityRef != null ? sActivityRef.get() : null;
            if (activity == null) {
                return true; // 拿不到 Activity 引用就不拦截，交给引擎自己报错
            }
            return activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return true;
        }
    }

    // ═════════════════════════════════════════
    // 讯飞引擎回调
    // ═════════════════════════════════════════

    private static final InitListener mInitListener = new InitListener() {
        @Override
        public void onInit(int code) {
            Log.d(TAG, "讯飞识别器初始化回调 code=" + code);
            if (code == 0) {
                sEngineReady.set(true);
                Log.i(TAG, "讯飞离线引擎就绪");
                // 引擎未就绪期间挂起的监听请求，现在自动开始
                if (sPendingStart) {
                    sPendingStart = false;
                    sMainHandler.post(() -> startListening());
                }
            } else {
                sUnavailable = true;
                Log.e(TAG, "讯飞识别器初始化失败 code=" + code
                        + "（" + iflytekCodeDesc(code) + "）");
                // 已握手则立刻上报致命错误，未握手则等握手时由 startListening 兜底
                dispatchToScript("onVoiceError", "5");
            }
        }
    };

    private static final RecognizerListener mRecognizerListener = new RecognizerListener() {

        @Override
        public void onVolumeChanged(int volume, byte[] data) {
            // 音量回调，不处理（引擎内部线程，禁止做耗时操作）
        }

        @Override
        public void onBeginOfSpeech() {
            Log.d(TAG, "就绪，可以说话了");
        }

        @Override
        public void onEndOfSpeech() {
            Log.d(TAG, "说话结束，识别中...");
        }

        @Override
        public void onResult(RecognizerResult result, boolean isLast) {
            if (result == null) {
                return;
            }
            try {
                // 解析讯飞分段 JSON，累积文本；只在 isLast 时上报（协议与 v6 一致）
                String piece = parseIflytekText(result.getResultString());
                if (piece != null && !piece.isEmpty()) {
                    sResultText.append(piece);
                }
                if (isLast) {
                    sListening = false;
                    String finalText = sResultText.toString().trim();
                    Log.d(TAG, "识别最终结果: \"" + finalText + "\"");

                    JSONObject json = new JSONObject();
                    json.put("text", finalText);
                    json.put("confidence", finalText.isEmpty() ? 0.0 : 0.9);
                    json.put("isFinal", true);
                    dispatchToScript("onVoiceResult", json.toString());

                    sResultText.setLength(0);
                }
            } catch (Throwable t) {
                Log.e(TAG, "结果处理异常", t);
            }
        }

        @Override
        public void onError(SpeechError error) {
            sListening = false;
            sResultText.setLength(0);
            int code = (error != null) ? error.getErrorCode() : -1;
            String desc = (error != null && error.getErrorDescription() != null)
                    ? error.getErrorDescription() : "未知";
            Log.w(TAG, "识别错误 code=" + code + "（" + desc + "）");

            // 静音超时/无结果是持续聆听下的高频正常现象（映射 7，TS 会自动重启监听）
            dispatchToScript("onVoiceError", mapIflytekError(code));
        }

        @Override
        public void onEvent(int eventType, int arg1, int arg2, Bundle obj) {
            // 预留
        }
    };

    // ═════════════════════════════════════════
    // TS 事件处理
    // ═════════════════════════════════════════

    private static void handleTsReady() {
        Log.d(TAG, "收到 TS 就绪握手");
        sTsReady = true;
        try {
            JSONObject json = new JSONObject();
            json.put("engine", "iflytek-local");
            json.put("ready", !sUnavailable && sEngineReady.get());
            dispatchToScript("onVoiceReady", json.toString());
        } catch (Throwable t) {
            dispatchToScript("onVoiceReady", "{}");
        }
    }

    // ═════════════════════════════════════════
    // 监听控制
    // ═════════════════════════════════════════

    public static void startListening() {
        if (sUnavailable) {
            Log.w(TAG, "引擎不可用，忽略开始监听（检查 README_讯飞语音接入.md）");
            dispatchToScript("onVoiceError", "5");
            return;
        }
        if (sRecognizer == null) {
            Log.w(TAG, "识别器未创建，忽略开始监听");
            return;
        }
        if (sListening) {
            return; // 会话已在进行，防重入（TS 重启循环可能连发）
        }

        // 录音权限未授予：挂起等待授权回调（不报错，否则 TS 会永久停止监听）
        if (!hasRecordPermission()) {
            sPendingStart = true;
            Log.w(TAG, "录音权限未授予，监听请求挂起（等 AppActivity 授权回调）");
            return;
        }

        // 引擎异步初始化尚未完成：挂起，就绪后自动开始
        if (!sEngineReady.get()) {
            sPendingStart = true;
            Log.d(TAG, "引擎初始化中，监听请求挂起（就绪后自动开始）");
            return;
        }

        try {
            // ── 离线听写参数 ──
            sRecognizer.setParameter(SpeechConstant.ENGINE_TYPE, SpeechConstant.TYPE_LOCAL);
            sRecognizer.setParameter(SpeechConstant.LANGUAGE, "zh_cn");
            sRecognizer.setParameter(SpeechConstant.ACCENT, "mandarin");
            // 注：音频来源不设置，SDK 默认就是麦克风（"-1" 才是写音频流）。
            //     不用 ASR_AUDIO_SOURCE 常量——部分 SDK 版本里不存在该符号，编译不过。
            // VAD 静音超时（毫秒）：前端 4s（多久没开始说话算超时）/ 后端 2s（说完多久收尾）
            sRecognizer.setParameter(SpeechConstant.VAD_BOS, "4000");
            sRecognizer.setParameter(SpeechConstant.VAD_EOS, "2000");
            // 结果不加标点（语音指令匹配不需要标点干扰）
            sRecognizer.setParameter(SpeechConstant.ASR_PTT, "0");

            int ret = sRecognizer.startListening(mRecognizerListener);
            if (ret != 0) {
                Log.e(TAG, "开始监听失败 code=" + ret + "（" + iflytekCodeDesc(ret) + "）");
                dispatchToScript("onVoiceError", mapIflytekError(ret));
                return;
            }
            sListening = true;
            Log.d(TAG, "开始监听（讯飞离线引擎）");
        } catch (Throwable t) {
            Log.e(TAG, "startListening 异常", t);
            sListening = false;
            dispatchToScript("onVoiceError", "5");
        }
    }

    public static void stopListening() {
        sPendingStart = false;
        if (!sListening) {
            return;
        }
        try {
            if (sRecognizer != null) {
                sRecognizer.stopListening();
            }
        } catch (Throwable t) {
            Log.w(TAG, "stopListening 异常（忽略）", t);
        }
        sListening = false;
        Log.d(TAG, "停止监听");
    }

    // ═════════════════════════════════════════
    // 工具：讯飞结果 JSON → 纯文本
    // ═════════════════════════════════════════

    /**
     * 讯飞听写结果格式：
     * {"sn":1,"ls":false,"bg":0,"ed":0,"ws":[{"bg":0,"cw":[{"sc":0,"w":"迪迦"}]},...]}
     * 拼接每个 ws 里分数最高（第一个）候选词。
     */
    private static String parseIflytekText(String resultJson) {
        try {
            JSONObject root = new JSONObject(resultJson);
            JSONArray ws = root.optJSONArray("ws");
            if (ws == null || ws.length() == 0) {
                return "";
            }
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < ws.length(); i++) {
                JSONArray cw = ws.optJSONObject(i) != null
                        ? ws.optJSONObject(i).optJSONArray("cw") : null;
                if (cw == null || cw.length() == 0) {
                    continue;
                }
                String w = cw.optJSONObject(0) != null
                        ? cw.optJSONObject(0).optString("w", "") : "";
                if (w != null) {
                    sb.append(w);
                }
            }
            return sb.toString();
        } catch (Throwable t) {
            Log.w(TAG, "解析讯飞结果 JSON 失败: " + resultJson);
            return "";
        }
    }

    // ═════════════════════════════════════════
    // 工具：讯飞错误码 → 安卓标准错误码（TS 层 VoiceError 枚举不变）
    // ═════════════════════════════════════════

    /**
     * 映射原则：
     *  - 可恢复（无结果/忙）→ 7 / 8，TS 端自动重启监听，持续聆听不中断
     *  - 致命（appid/授权/离线资源/客户端）→ 5，TS 端停止自动重启（避免死循环刷屏）
     *  - 网络类 → 2（离线模式一般不出现，出现说明引擎配置异常）
     */
    private static String mapIflytekError(int code) {
        switch (code) {
            // 无匹配结果 / 无语音输入 —— 持续聆听下的正常现象
            case 20001:
            case 20002:
                return "7";  // ERROR_NO_MATCH

            // 识别器忙 / 会话冲突 —— 稍后自动重启即可
            case 20006:
            case 10801:
            case 10802:
                return "8";  // ERROR_RECOGNIZER_BUSY

            // 网络问题（离线模式下出现 = 引擎配置异常）
            case 20004:
                return "2";  // ERROR_NETWORK

            // 服务端错误
            case 20003:
                return "4";  // ERROR_SERVER

            // appid 无效 / 未授权 / 包名不匹配
            case 10109:
            case 10110:
            case 10111:
            // 离线资源缺失 / 未安装 / 不支持
            case 23004:
            case 23005:
            case 23006:
            case 23008:
            // 客户端 / 引擎初始化失败
            case 20005:
            default:
                return "5";  // ERROR_CLIENT（致命，TS 停止自动重启）
        }
    }

    /** 常见讯飞错误码中文速查（仅用于日志） */
    private static String iflytekCodeDesc(int code) {
        switch (code) {
            case 10109: return "appid 无效";
            case 10110: return "appid 与包名不匹配（讯飞后台创建应用时填的包名要和 APK 包名一致）";
            case 10111: return "appid 未授权/无服务";
            case 20001: return "无识别结果（正常，静音超时）";
            case 20004: return "网络问题";
            case 20005: return "客户端错误";
            case 23004: return "离线资源不存在（检查 assets/iflytek 是否已放入）";
            case 23005: return "离线资源未安装/版本不符";
            case 23006: return "离线资源不支持";
            case 23008: return "离线引擎初始化失败";
            case 10801: return "会话已存在";
            case 10802: return "会话不存在";
            default: return "讯飞码 " + code;
        }
    }

    // ═════════════════════════════════════════
    // Java → TS 派发（v6 防闪退闸门逻辑保留）
    // ═════════════════════════════════════════

    private static void dispatchToScript(String event, String data) {
        // 闸门：TS 未握手 = JS 引擎未就绪 = 发事件必 SIGABRT 闪退
        if (!sTsReady) {
            Log.w(TAG, "跳过向 TS 发送 " + event + "（引擎未就绪，发送会闪退）");
            return;
        }
        try {
            JsbBridgeWrapper.getInstance().dispatchEventToScript(event, data);
        } catch (Throwable t) {
            // 引擎桥异常，静默失败，绝不拖崩 APP
        }
    }
}
