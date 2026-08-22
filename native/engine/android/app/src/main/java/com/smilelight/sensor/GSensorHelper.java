package com.smilelight.sensor;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.cocos.lib.JsbBridgeWrapper;

/**
 * GSensorHelper - 神光棒 TV6 重力感应直连模块 v1（2026-08-22）
 *
 * 为什么存在：
 *   引擎的传感器链路（CocosSensorHandler → JNI → jsb.device → DEVICEMOTION 事件）
 *   在部分真机上「初始几秒有数据后冻结」（现象：调试面板 g 值恒定不变，
 *   晃动手机无变化）。逐层核查引擎源码无果后，改为 Java 层直连
 *   SensorManager——Android 最基础的传感器 API，可靠性等同于原生 App。
 *
 * 工作方式：
 *   TS 通过 JsbBridge 命令启动（initGSensor / stopGSensor），
 *   数据以 "x,y,z" 字符串推送到 TS（事件名 onGSensorData），
 *   换算口径与引擎一致（g 单位：values × 0.1，安卓 x/y 取反），
 *   TS 侧 GSensorController 现有动作检测阈值无需改动。
 *
 * 事件流：
 *   TS: jsbBridgeWrapper.dispatchEventToNative('initGSensor', '')
 *   Java: JsbBridgeWrapper.dispatchEventToScript('onGSensorData', "0.12,-0.98,0.05")
 *   TS: GSensorController 解析后走 handleMotion（与引擎事件链同入口）
 */
public final class GSensorHelper {

    private static final String TAG = "GSensorHelper";

    /** 推送事件名（TS 侧 addNativeEventListener 监听这个名字） */
    private static final String BRIDGE_EVENT_DATA = "onGSensorData";
    /** 桥命令：启动传感器 */
    private static final String CMD_START = "initGSensor";
    /** 桥命令：停止传感器 */
    private static final String CMD_STOP = "stopGSensor";

    /** 最小推送间隔（毫秒）：限制在 ~50Hz，防止部分设备 200Hz 刷爆桥 */
    private static final long MIN_INTERVAL_MS = 20;

    private static SensorManager sSensorManager = null;
    private static Sensor sAccelerometer = null;
    private static Handler sMainHandler = null;
    private static boolean sRunning = false;
    private static boolean sInited = false;
    private static long sLastPushTime = 0;

    /** 收到首帧数据的日志只打一次 */
    private static boolean sFirstDataLogged = false;

    private GSensorHelper() {}

    /** 初始化（由 VoiceRecognitionHelper.init 调用，AppActivity 零改动） */
    public static void init(Context appContext) {
        if (sInited) return;
        try {
            sSensorManager = (SensorManager) appContext.getSystemService(Context.SENSOR_SERVICE);
            if (sSensorManager != null) {
                sAccelerometer = sSensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            }
            sMainHandler = new Handler(Looper.getMainLooper());

            // 挂桥命令监听：TS 按需启停（引擎就绪后再启动，安全）
            JsbBridgeWrapper.getInstance().addScriptEventListener(CMD_START, (arg) -> start());
            JsbBridgeWrapper.getInstance().addScriptEventListener(CMD_STOP, (arg) -> stop());

            sInited = true;
            boolean hasSensor = (sAccelerometer != null);
            Log.d(TAG, "初始化完成，加速度计" + (hasSensor
                    ? "可用(" + sAccelerometer.getName() + ")"
                    : "✗不存在（TV盒子/模拟器？重力感应功能不可用）"));
        } catch (Throwable t) {
            Log.e(TAG, "初始化异常（不影响其他功能）", t);
        }
    }

    /** 启动传感器监听（必须在主线程注册） */
    public static void start() {
        if (!sInited || sRunning) return;
        if (sSensorManager == null || sAccelerometer == null || sMainHandler == null) {
            Log.w(TAG, "start 失败：SensorManager/传感器/Handler 未就绪");
            return;
        }
        sMainHandler.post(() -> {
            try {
                boolean ok = sSensorManager.registerListener(sListener, sAccelerometer,
                        SensorManager.SENSOR_DELAY_GAME);
                sRunning = ok;
                Log.d(TAG, "传感器监听已启动（SENSOR_DELAY_GAME ≈50Hz）" + (ok ? "✓" : "✗注册失败"));
            } catch (Throwable t) {
                Log.e(TAG, "registerListener 异常", t);
            }
        });
    }

    /** 停止传感器监听 */
    public static void stop() {
        if (!sInited || !sRunning) return;
        if (sSensorManager == null || sMainHandler == null) return;
        sMainHandler.post(() -> {
            try {
                sSensorManager.unregisterListener(sListener, sAccelerometer);
                Log.d(TAG, "传感器监听已停止");
            } catch (Throwable t) {
                Log.w(TAG, "unregisterListener 异常", t);
            }
        });
        sRunning = false;
    }

    /** 传感器数据监听器 */
    private static final SensorEventListener sListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            if (event == null || !sRunning) return;
            // 节流：限制推送频率上限 ~50Hz
            long now = System.currentTimeMillis();
            if (now - sLastPushTime < MIN_INTERVAL_MS) return;
            sLastPushTime = now;

            // ── 换算为引擎口径（g 单位）──
            // Android SensorEvent.values：m/s²，设备坐标系（x 右 y 上 z 出屏）
            // 引擎口径（pal/input/native/accelerometer-input.ts）：×0.1（≈g）+ 安卓 x/y 取反
            float x = -event.values[0] * 0.1f;
            float y = -event.values[1] * 0.1f;
            float z = event.values[2] * 0.1f;

            if (!sFirstDataLogged) {
                sFirstDataLogged = true;
                Log.d(TAG, "首帧数据: " + fmt(x) + "," + fmt(y) + "," + fmt(z)
                        + "（Java 直连链路已通，后续不再打印）");
            }

            try {
                JsbBridgeWrapper.getInstance().dispatchEventToScript(
                        BRIDGE_EVENT_DATA, fmt(x) + "," + fmt(y) + "," + fmt(z));
            } catch (Throwable t) {
                // 引擎未就绪等场景：静默跳过（下一次数据马上就来）
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
            // 精度变化不影响功能
        }
    };

    /** 保留 3 位小数的字符串（减少桥传输量） */
    private static String fmt(float v) {
        return String.format(java.util.Locale.US, "%.3f", v);
    }
}
