package com.smilelight;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.cocos.lib.GameActivity;
import com.smilelight.voice.VoiceRecognitionHelper;

/**
 * AppActivity
 * 神光棒 TV6 - 主 Activity（替换 Cocos 默认生成的 AppActivity）
 *
 * 适配 Cocos Creator 3.8.x：继承 com.cocos.lib.GameActivity
 *
 * 通过 build-templates 自动生效：
 *   build-templates/android/proj/app/src/main/java/com/cocos/game/AppActivity.java
 *   → 构建时自动覆盖 build/android/proj/app/src/main/java/com/cocos/game/AppActivity.java
 *   （如果原构建文件里有你自己加的逻辑，把本文件的
 *     初始化/权限/销毁 三段代码合并进原文件即可）
 */
public class AppActivity extends GameActivity {

    private static final String TAG = "AppActivity";
    private static final int REQUEST_RECORD_AUDIO = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ── 申请录音权限 + 初始化语音识别 ──
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
            } else {
                VoiceRecognitionHelper.init(this);
            }
        } else {
            // Android 6.0 以下无需动态权限
            VoiceRecognitionHelper.init(this);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQUEST_RECORD_AUDIO) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "录音权限已授予，初始化语音识别");
                VoiceRecognitionHelper.init(this);
            } else {
                Log.w(TAG, "录音权限被拒绝，语音识别功能不可用");
            }
        }
    }

    @Override
    protected void onDestroy() {
        VoiceRecognitionHelper.destroy();
        super.onDestroy();
    }
}
