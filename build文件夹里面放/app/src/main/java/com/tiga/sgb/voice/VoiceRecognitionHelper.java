package com.tiga.sgb.voice;

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
import java.util.Locale;

/**
 * VoiceRecognitionHelper
 * 神光棒 TV6 - 安卓语音识别辅助类
 *
 * 通过 Cocos Creator 3.x 的 JsbBridgeWrapper 与 TS 层通信
 *
 * 使用方式：
 *   1. 在 MainActivity.onCreate 中调用 VoiceRecognitionHelper.init(this)
 *   2. TS 层通过 nativeBridge.sendToNative("startVoiceRecognition", "") 启动识别
 *   3. 识别结果通过 JsbBridgeWrapper.eventListener.emit("onVoiceResult", json) 回调
 *
 * 权限需求：
 *   <uses-permission android:name="android.permission.RECORD_AUDIO"/>
 *   <uses-permission android:name="android.permission.INTERNET"/>
 *
 * 离线识别：
 *   如需离线语音识别，可集成 Vosk 或 Snowboy 等开源方案替换 SpeechRecognizer
 */
public class VoiceRecognitionHelper {
    private static final String TAG = "VoiceRecognition";

    /** JSB Bridge 事件名（需与 TS 层一致） */
    private static final String EVENT_RESULT = "onVoiceResult";
    private static final String EVENT_ERROR = "onVoiceError";
    private static final String EVENT_READY = "onVoiceReady";

    private static Context sContext;
    private static SpeechRecognizer sRecognizer;
    private static boolean sIsListening = false;
    private static boolean sInitialized = false;

    /** 识别监听器 */
    private static final RecognitionListener sListener = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {
            Log.d(TAG, "准备接收语音");
        }

        @Override
        public void onBeginningOfSpeech() {
            Log.d(TAG, "开始说话");
        }

        @Override
        public void onRmsChanged(float rmsdB) {
            // 音量变化（可用于 UI 动画）
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
            // 音频缓冲
        }

        @Override
        public void onEndOfSpeech() {
            Log.d(TAG, "说话结束");
            sIsListening = false;
        }

        @Override
        public void onError(int error) {
            sIsListening = false;
            String errorMsg;
            switch (error) {
                case SpeechRecognizer.ERROR_NO_MATCH:
                    errorMsg = "未识别到语音";
                    break;
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                    errorMsg = "语音输入超时";
                    break;
                case SpeechRecognizer.ERROR_AUDIO:
                    errorMsg = "音频错误";
                    break;
                case SpeechRecognizer.ERROR_NETWORK:
                    errorMsg = "网络错误";
                    break;
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                    errorMsg = "网络超时";
                    break;
                case SpeechRecognizer.ERROR_CLIENT:
                    errorMsg = "客户端错误";
                    break;
                case SpeechRecognizer.ERROR_SERVER:
                    errorMsg = "服务器错误";
                    break;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                    errorMsg = "权限不足";
                    break;
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                    errorMsg = "识别器忙碌";
                    break;
                default:
                    errorMsg = "未知错误: " + error;
                    break;
            }
            Log.w(TAG, "识别错误: " + errorMsg);

            // 通过 JSB Bridge 通知 TS 层
            try {
                JsbBridgeWrapper.eventListener.emit(EVENT_ERROR, String.valueOf(error));
            } catch (Exception e) {
                Log.e(TAG, "JSB 回调失败", e);
            }
        }

        @Override
        public void onResults(Bundle results) {
            sIsListening = false;

            ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            float[] scores = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);

            if (matches == null || matches.isEmpty()) {
                Log.w(TAG, "识别结果为空");
                return;
            }

            String text = matches.get(0);
            float confidence = (scores != null && scores.length > 0) ? scores[0] : 1.0f;

            Log.d(TAG, "识别结果: " + text + " (置信度: " + confidence + ")");

            // 通过 JSB Bridge 通知 TS 层
            try {
                JSONObject json = new JSONObject();
                json.put("text", text);
                json.put("confidence", confidence);
                json.put("isFinal", true);
                JsbBridgeWrapper.eventListener.emit(EVENT_RESULT, json.toString());
            } catch (Exception e) {
                Log.e(TAG, "JSON 构建失败", e);
                // 降级：直接发送文本
                JsbBridgeWrapper.eventListener.emit(EVENT_RESULT, text);
            }
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            // 部分识别结果（实时）
            ArrayList<String> partial = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (partial != null && !partial.isEmpty()) {
                Log.d(TAG, "部分结果: " + partial.get(0));
                try {
                    JSONObject json = new JSONObject();
                    json.put("text", partial.get(0));
                    json.put("confidence", 0.5f);
                    json.put("isFinal", false);
                    JsbBridgeWrapper.eventListener.emit(EVENT_RESULT, json.toString());
                } catch (Exception e) {
                    Log.e(TAG, "部分结果 JSON 构建失败", e);
                }
            }
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
            // 预留事件
        }
    };

    /**
     * 初始化语音识别
     * 在 MainActivity.onCreate 中调用
     */
    public static void init(Context context) {
        sContext = context.getApplicationContext();

        // 检查 SpeechRecognizer 是否可用
        if (!SpeechRecognizer.isRecognitionAvailable(sContext)) {
            Log.e(TAG, "语音识别服务不可用");
            return;
        }

        // 创建 SpeechRecognizer
        sRecognizer = SpeechRecognizer.createSpeechRecognizer(sContext);
        sRecognizer.setRecognitionListener(sListener);

        // 注册 JSB Bridge 回调
        try {
            JsbBridgeWrapper.eventListener.on("initVoiceRecognition", args -> {
                Log.d(TAG, "JSB: initVoiceRecognition");
                sInitialized = true;
                JsbBridgeWrapper.eventListener.emit(EVENT_READY, "");
            });

            JsbBridgeWrapper.eventListener.on("startVoiceRecognition", args -> {
                Log.d(TAG, "JSB: startVoiceRecognition");
                startListening();
            });

            JsbBridgeWrapper.eventListener.on("stopVoiceRecognition", args -> {
                Log.d(TAG, "JSB: stopVoiceRecognition");
                stopListening();
            });

            sInitialized = true;
            Log.d(TAG, "语音识别初始化完成");
            JsbBridgeWrapper.eventListener.emit(EVENT_READY, "");

        } catch (Exception e) {
            Log.e(TAG, "JSB Bridge 注册失败", e);
        }
    }

    /**
     * 开始语音识别
     */
    public static void startListening() {
        if (sRecognizer == null) {
            Log.e(TAG, "SpeechRecognizer 未初始化");
            return;
        }

        if (sIsListening) {
            Log.d(TAG, "正在识别中，忽略重复调用");
            return;
        }

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        // 使用中文识别
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        // 支持部分结果
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        // 最大识别时间 10 秒
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 3000);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 500);

        try {
            sRecognizer.startListening(intent);
            sIsListening = true;
            Log.d(TAG, "开始语音识别");
        } catch (Exception e) {
            Log.e(TAG, "启动语音识别失败", e);
            sIsListening = false;
        }
    }

    /**
     * 停止语音识别
     */
    public static void stopListening() {
        if (sRecognizer != null && sIsListening) {
            sRecognizer.stopListening();
            sIsListening = false;
            Log.d(TAG, "停止语音识别");
        }
    }

    /**
     * 销毁
     * 在 MainActivity.onDestroy 中调用
     */
    public static void destroy() {
        if (sRecognizer != null) {
            sRecognizer.destroy();
            sRecognizer = null;
        }
        sInitialized = false;
        Log.d(TAG, "语音识别已销毁");
    }

    /**
     * 是否已初始化
     */
    public static boolean isInitialized() {
        return sInitialized;
    }
}
