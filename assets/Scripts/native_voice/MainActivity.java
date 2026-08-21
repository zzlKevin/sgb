package com.tiga.sgb;

import android.os.Build;
import android.os.Bundle;
import android.Manifest;
import android.content.pm.PackageManager;

import com.smilelight.GameActivity;
import com.tiga.sgb.voice.VoiceRecognitionHelper;

/**
 * MainActivity
 * 神光棒 TV6 - 主 Activity
 *
 * 功能：
 *   1. 申请录音权限
 *   2. 初始化语音识别
 *   3. 在销毁时释放资源
 *
 * 放置位置：build-templates/MainActivity.java（覆盖 Cocos 默认）
 */
public class MainActivity extends GameActivity {

    private static final int REQUEST_RECORD_AUDIO = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 申请录音权限
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
            } else {
                // 已有权限，初始化语音识别
                VoiceRecognitionHelper.init(this);
            }
        } else {
            // Android 6.0 以下不需要动态权限
            VoiceRecognitionHelper.init(this);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQUEST_RECORD_AUDIO) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // 权限已授予，初始化语音识别
                VoiceRecognitionHelper.init(this);
            } else {
                // 权限被拒绝
                android.util.Log.w("MainActivity", "录音权限被拒绝，语音识别功能不可用");
            }
        }
    }

    @Override
    protected void onDestroy() {
        VoiceRecognitionHelper.destroy();
        super.onDestroy();
    }
}
