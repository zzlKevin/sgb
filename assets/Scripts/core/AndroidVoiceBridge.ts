/**
 * AndroidVoiceBridge.ts
 * 神光棒 TV6 - 安卓语音识别桥接
 *
 * 通过 Cocos Creator 的 JSB（JavaScript Binding）调用 Android 原生 SpeechRecognizer
 *
 * 工作原理：
 *   1. TS 层调用 startListening() → 通过 jsb.bridge 调用 Java 方法
 *   2. Java 层启动 SpeechRecognizer，识别结果通过 jsb.bridge 回调到 TS
 *   3. VoiceCommandManager 解析文本并分发指令
 *
 * 安卓端需要：
 *   - AndroidManifest.xml 添加 <uses-permission android:name="android.permission.RECORD_AUDIO"/>
 *   - 实现 VoiceRecognitionHelper.java（见项目 docs/AndroidVoiceBridge.java 参考）
 */

import { _decorator, Component, sys, nativeBridge, EventTouch, input, Input } from 'cc';

const { ccclass, property } = _decorator;

/** 语音识别回调类型 */
export interface VoiceRecognitionResult {
    /** 识别到的文本 */
    text: string;
    /** 识别置信度（0~1） */
    confidence: number;
    /** 是否是最终结果 */
    isFinal: boolean;
}

/** 语音识别错误码 */
export enum VoiceError {
    NONE = 0,
    NO_SPEECH = 1,
    AUDIO_ERROR = 2,
    NETWORK_ERROR = 3,
    PERMISSION_DENIED = 4,
    CLIENT_ERROR = 5,
    SERVER_ERROR = 6,
    NOT_AVAILABLE = 7,
}

@ccclass('AndroidVoiceBridge')
export class AndroidVoiceBridge extends Component {

    // ═════════════════════════════════════════
    // 编辑器属性
    // ═════════════════════════════════════════

    /** 是否启用触摸触发语音识别（仅安卓真机有效。编辑器/浏览器中点击不会模拟） */
    @property
    public touchToStart: boolean = false;

    /** 调试模式：非安卓环境下自动模拟语音指令（仅用于开发测试，默认关闭） */
    @property
    public debugMode: boolean = false;

    /** 自动重连间隔（秒），识别结束后自动重新启动 */
    @property
    public autoRestartDelay: number = 0;

    // ═════════════════════════════════════════
    // 内部状态
    // ═════════════════════════════════════════

    /** 是否正在监听 */
    private _isListening: boolean = false;

    /** 是否已初始化 */
    private _initialized: boolean = false;

    /** 安卓 JSB Bridge 的事件名 */
    private readonly BRIDGE_EVENT_RECEIVE = 'onVoiceResult';
    private readonly BRIDGE_EVENT_ERROR = 'onVoiceError';
    private readonly BRIDGE_EVENT_READY = 'onVoiceReady';

    /** 调试用模拟指令列表 */
    private _debugCommands: string[] = [
        '迪迦', '播放', '第1首', '白光', '开启感应',
        '左', '右', '上', '前', '拉回', '下',
        '黑暗迪迦', '卡蜜拉', '再见奥特曼',
    ];

    private _debugIndex: number = 0;

    // ═════════════════════════════════════════
    // 生命周期
    // ═════════════════════════════════════════

    onLoad() {
        this.initBridge();

        if (this.touchToStart) {
            input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        }
    }

    onDestroy() {
        this.stopListening();
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    // ═════════════════════════════════════════
    // 初始化 JSB Bridge
    // ═════════════════════════════════════════

    private initBridge(): void {
        // 检查是否在安卓环境
        if (!this.isAndroid()) {
            console.log('[VoiceBridge] 非安卓环境，启用调试模式');
            this._initialized = false;
            return;
        }

        try {
            // 使用 Cocos 3.x 的 nativeBridge
            // 注册回调
            nativeBridge.eventListener.on(this.BRIDGE_EVENT_RECEIVE, (arg: string) => {
                this.handleResult(arg);
            });

            nativeBridge.eventListener.on(this.BRIDGE_EVENT_ERROR, (arg: string) => {
                this.handleError(arg);
            });

            nativeBridge.eventListener.on(this.BRIDGE_EVENT_READY, () => {
                console.log('[VoiceBridge] 安卓语音识别已就绪');
                this._initialized = true;
            });

            // 调用 Java 初始化
            this.sendToNative('initVoiceRecognition', '');

            console.log('[VoiceBridge] JSB Bridge 初始化完成');
        } catch (e) {
            console.error('[VoiceBridge] 初始化失败', e);
        }
    }

    /** 是否是安卓环境 */
    public isAndroid(): boolean {
        return sys.platform === sys.Platform.ANDROID;
    }

    /** 发送指令到原生层 */
    private sendToNative(method: string, arg: string): void {
        if (!this.isAndroid()) return;
        try {
            // Cocos 3.x: 通过 nativeBridge.sendToNative 调用
            nativeBridge.sendToNative(method, arg);
        } catch (e) {
            console.error(`[VoiceBridge] sendToNative(${method}) 失败`, e);
        }
    }

    // ═════════════════════════════════════════
    // 语音识别控制
    // ═════════════════════════════════════════

    /** 开始监听 */
    public startListening(): boolean {
        if (this._isListening) return false;

        if (!this.isAndroid()) {
            // 调试模式：模拟返回结果
            if (this.debugMode) {
                this.simulateDebugResult();
            }
            return false;
        }

        this.sendToNative('startVoiceRecognition', '');
        this._isListening = true;
        console.log('[VoiceBridge] 开始语音识别');
        return true;
    }

    /** 停止监听 */
    public stopListening(): void {
        if (!this._isListening) return;

        if (this.isAndroid()) {
            this.sendToNative('stopVoiceRecognition', '');
        }
        this._isListening = false;
        console.log('[VoiceBridge] 停止语音识别');
    }

    /** 是否正在监听 */
    public isListening(): boolean {
        return this._isListening;
    }

    // ═════════════════════════════════════════
    // 回调处理
    // ═════════════════════════════════════════

    /** 处理识别结果 */
    private handleResult(arg: string): void {
        this._isListening = false;

        try {
            const result: VoiceRecognitionResult = JSON.parse(arg);
            console.log(`[VoiceBridge] 识别结果: "${result.text}" (置信度: ${result.confidence})`);

            // 发送事件，VoiceCommandManager 会监听
            this.node.emit('onVoiceResult', result);
        } catch (e) {
            // 如果不是 JSON，直接当文本处理
            console.log(`[VoiceBridge] 识别结果（纯文本）: "${arg}"`);
            this.node.emit('onVoiceResult', {
                text: arg,
                confidence: 1.0,
                isFinal: true,
            } as VoiceRecognitionResult);
        }

        // 自动重启
        if (this.autoRestartDelay > 0) {
            this.scheduleOnce(() => {
                this.startListening();
            }, this.autoRestartDelay);
        }
    }

    /** 处理错误 */
    private handleError(arg: string): void {
        this._isListening = false;

        let errorCode = VoiceError.CLIENT_ERROR;
        try {
            errorCode = parseInt(arg);
        } catch (e) {}

        console.warn(`[VoiceBridge] 语音识别错误: ${errorCode}`);

        this.node.emit('onVoiceError', errorCode);

        // 自动重启
        if (this.autoRestartDelay > 0 && errorCode !== VoiceError.PERMISSION_DENIED) {
            this.scheduleOnce(() => {
                this.startListening();
            }, this.autoRestartDelay);
        }
    }

    // ═════════════════════════════════════════
    // 触摸触发
    // ═════════════════════════════════════════

    private onTouchStart(_event: EventTouch): void {
        if (!this._isListening) {
            this.startListening();
        }
    }

    // ═════════════════════════════════════════
    // 调试模拟
    // ═════════════════════════════════════════

    /** 模拟调试识别结果 */
    public simulateDebugResult(text?: string): void {
        const resultText = text || this._debugCommands[this._debugIndex % this._debugCommands.length];
        this._debugIndex++;

        console.log(`[VoiceBridge] 模拟识别: "${resultText}"`);

        this.node.emit('onVoiceResult', {
            text: resultText,
            confidence: 0.95,
            isFinal: true,
        } as VoiceRecognitionResult);
    }
}
