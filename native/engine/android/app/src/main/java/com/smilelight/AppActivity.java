package com.smilelight;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.cocos.lib.CocosActivity;
import com.smilelight.voice.VoiceRecognitionHelper;

/**
 * AppActivity - 神光棒 TV6 主 Activity（语音增强版 v5）
 *
 * ⚠️ 正确放置位置（官方原生工程目录，构建自动打包，不要用 build-templates）：
 *   native/engine/android/app/src/main/java/com/smilelight/AppActivity.java
 *
 * 原理：Cocos 每次构建会把 native/engine/android/ 下的内容合并进
 *   build/android/proj/，Java 文件随标准 gradle 源集编译进 APK。
 *
 * 基类：com.cocos.lib.CocosActivity（Cocos 3.8.8 引擎源码核实，
 *       不要写成 GameActivity，那个类不在 com.cocos.lib 里）
 */
public class AppActivity extends CocosActivity {

    private static final String TAG = "SGBAppActivity";
    private static final int REQUEST_RECORD_AUDIO = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 标记日志：logcat 过滤 SGBAppActivity，出现这行 = 本文件确实打进了 APK
        Log.d(TAG, "SGB AppActivity 启动（语音增强版 v5）");

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},
                            REQUEST_RECORD_AUDIO);
                } else {
                    VoiceRecognitionHelper.init(this);
                }
            } else {
                VoiceRecognitionHelper.init(this);
            }
        } catch (Throwable t) {
            // 语音模块绝不拖崩主 APP
            Log.e(TAG, "语音初始化流程异常（APP 继续运行）", t);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_RECORD_AUDIO) return;

        try {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "录音权限已授予，初始化语音识别");
                VoiceRecognitionHelper.init(this);
            } else {
                Log.w(TAG, "录音权限被拒绝，语音识别不可用");
                VoiceRecognitionHelper.notifyPermissionDenied();
            }
        } catch (Throwable t) {
            Log.e(TAG, "权限回调异常", t);
        }
    }

    @Override
    protected void onDestroy() {
        try {
            VoiceRecognitionHelper.destroy();
        } catch (Throwable t) {
            // 忽略
        }
        super.onDestroy();
    }
}
