/**
 * AndroidVoiceBridge.ts
 * 神光棒 TV6 - 安卓语音识别桥接（v5 重写版）
 *
 * 使用 Cocos Creator 3.8 官方 JsbBridgeWrapper 事件桥（引擎源码核实）：
 *   TS  → Java : native.jsbBridgeWrapper.dispatchEventToNative(event, arg)
 *                → Java 端 JsbBridgeWrapper.addScriptEventListener(event, listener) 收到
 *   Java → TS  : JsbBridgeWrapper.getInstance().dispatchEventToScript(event, arg)
 *                → TS 端 native.jsbBridgeWrapper.addNativeEventListener(event, cb) 收到
 *
 * 事件协议：
 *   initVoiceRecognition  (TS→Java)  TS 就绪握手，Java 收到后回发 onVoiceReady
 *   startVoiceRecognition (TS→Java)  开始监听
 *   stopVoiceRecognition  (TS→Java)  停止监听
 *   onVoiceReady          (Java→TS)  初始化完成（TS 收到后按需自动开始监听）
 *   onVoiceResult         (Java→TS)  识别结果 JSON: {text, confidence, isFinal}
 *   onVoiceError          (Java→TS)  安卓标准错误码 1~9
 *
 * 安卓端 Java 文件（放在项目 native/engine/android/ 下，构建自动打包）：
 *   native/engine/android/app/src/main/java/com/smilelight/AppActivity.java
 *   native/engine/android/app/src/main/java/com/smilelight/voice/VoiceRecognitionHelper.java
 *
 * ⚠️ 不要用 build-templates 放 Java 文件——官方文档确认原生平台模板目录名是
 *    native 而非 android，放 android 子目录不会被拷贝。
 */

import { _decorator, Component, sys, native, EventTouch, input, Input } from 'cc';

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

/** 语音识别错误码（与安卓 SpeechRecognizer 标准错误码对齐） */
export enum VoiceError {
    NONE = 0,
    /** 网络超时 */
    NETWORK_TIMEOUT = 1,
    /** 网络错误 */
    NETWORK = 2,
    /** 音频错误 */
    AUDIO_ERROR = 3,
    /** 服务端错误 */
    SERVER_ERROR = 4,
    /** 客户端错误 */
    CLIENT_ERROR = 5,
    /** 无语音输入超时 */
    SPEECH_TIMEOUT = 6,
    /** 无匹配结果 */
    NO_MATCH = 7,
    /** 识别器忙 */
    RECOGNIZER_BUSY = 8,
    /** 权限不足 */
    PERMISSION_DENIED = 9,
}

@ccclass('AndroidVoiceBridge')
export class AndroidVoiceBridge extends Component {

    // ═════════════════════════════════════════
    // 编辑器属性
    // ═════════════════════════════════════════

    /** Java 桥就绪后自动开始监听（通知栏会出现麦克风标识） */
    @property({ tooltip: 'Java桥就绪后自动开始监听，通知栏会出现麦克风标识' })
    public autoStart: boolean = true;

    /** 持续聆听：一次识别结束后自动重新开始（延时见 autoRestartDelay） */
    @property({ tooltip: '持续聆听：一次识别结束后自动重新开始' })
    public continuousListening: boolean = true;

    /** 自动重启延时（秒）。continuousListening 开启时默认 1 秒 */
    @property({ tooltip: '识别结束/出错后多久自动重启监听（秒）' })
    public autoRestartDelay: number = 1.0;

    /** 是否启用触摸触发语音识别（备用：自动启动失效时点屏幕启动） */
    @property({ tooltip: '触摸屏幕也可启动监听（备用手段）' })
    public touchToStart: boolean = false;

    /** 调试模式：非安卓环境下自动模拟语音指令（仅用于开发测试，默认关闭） */
    @property
    public debugMode: boolean = false;

    // ═════════════════════════════════════════
    // 内部状态
    // ═════════════════════════════════════════

    /** 是否正在监听 */
    private _isListening: boolean = false;

    /** Java 桥是否就绪（false = 原生代码没打进 APK） */
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

    /** 握手重试计数（防权限弹窗期间事件丢失的时序竞争） */
    private _handshakeCount: number = 0;
    private static readonly HANDSHAKE_MAX_RETRY: number = 10;
    private static readonly HANDSHAKE_INTERVAL: number = 2.0;

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
            console.log('[VoiceBridge] 非安卓环境，语音识别不可用（可勾选 debugMode 模拟测试）');
            return;
        }

        const wrapper = this.getWrapper();
        if (!wrapper || typeof wrapper.addNativeEventListener !== 'function') {
            console.error('[VoiceBridge] jsbBridgeWrapper 不可用（引擎异常？）');
            return;
        }

        try {
            // Java → TS 事件（Cocos 3.8 官方 API：native.jsbBridgeWrapper）
            wrapper.addNativeEventListener(this.BRIDGE_EVENT_RECEIVE, (arg: string) => {
                this.handleResult(arg);
            });

            wrapper.addNativeEventListener(this.BRIDGE_EVENT_ERROR, (arg: string) => {
                this.handleError(arg);
            });

            wrapper.addNativeEventListener(this.BRIDGE_EVENT_READY, () => {
                this.onBridgeReady();
            });

            // TS → Java 握手（带重试）：Java 收到后回发 onVoiceReady。
            // 必须由 TS 主动发起——onCreate 阶段 JS 引擎未启动，Java 主动发事件
            // 会触发 native 层 SIGABRT 直接闪退（真机堆栈实锤，v5 教训）
            this.sendHandshake();

            console.log('[VoiceBridge] 事件监听注册完成，开始握手（每2秒重试，最多10次）...');
        } catch (e) {
            console.error('[VoiceBridge] 初始化失败', e);
        }
    }

    /** 发送握手（带重试）：Java 端就绪前事件可能丢失，靠重试兜底 */
    private sendHandshake(): void {
        if (this._initialized) return;
        if (this._handshakeCount >= AndroidVoiceBridge.HANDSHAKE_MAX_RETRY) {
            console.warn('[VoiceBridge] 握手10次无响应，放弃（Java 侧未就绪或未打包）');
            return;
        }
        this._handshakeCount++;
        this.sendToNative('initVoiceRecognition', '');
        console.log(`[VoiceBridge] 握手 #${this._handshakeCount}/${AndroidVoiceBridge.HANDSHAKE_MAX_RETRY}`);
        // 2秒后无响应就重试
        this.scheduleOnce(() => this.sendHandshake(), AndroidVoiceBridge.HANDSHAKE_INTERVAL);
    }

    /** Java 桥就绪回调 */
    private onBridgeReady(): void {
        if (this._initialized) return;
        this._initialized = true;
        this._handshakeCount = AndroidVoiceBridge.HANDSHAKE_MAX_RETRY; // 停止重试
        console.log('[VoiceBridge] 安卓语音识别已就绪');
        this.node.emit('onVoiceReady');

        if (this.autoStart) {
            this.scheduleOnce(() => {
                this.startListening();
            }, 0.3);
        }
    }

    /** 获取 JsbBridgeWrapper（Cocos 3.8 官方事件桥） */
    private getWrapper(): any {
        try {
            const n: any = (typeof native !== 'undefined' && native) ? native
                : (globalThis as any).native;
            return n ? n.jsbBridgeWrapper : null;
        } catch (e) {
            return null;
        }
    }

    /** 是否是安卓环境 */
    public isAndroid(): boolean {
        return sys.platform === sys.Platform.ANDROID;
    }

    /** Java 桥是否已就绪（false = 原生 Java 代码没打进 APK） */
    public isInitialized(): boolean {
        return this._initialized;
    }

    /** 当前握手进度（0~10）——调试面板用 */
    public getHandshakeCount(): number {
        return this._handshakeCount;
    }

    /** 发送指令到原生层 */
    private sendToNative(method: string, arg: string): void {
        if (!this.isAndroid()) return;
        try {
            const wrapper = this.getWrapper();
            if (wrapper && typeof wrapper.dispatchEventToNative === 'function') {
                wrapper.dispatchEventToNative(method, arg);
            } else {
                console.warn(`[VoiceBridge] dispatchEventToNative 不可用: ${method}`);
            }
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
        console.log('[VoiceBridge] 开始语音识别（通知栏应出现麦克风标识）');
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

        this.scheduleRestart();
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

        // 握手期间收到致命错误（权限拒/服务不可用）：停止握手重试
        if (!this._initialized &&
            (errorCode === VoiceError.PERMISSION_DENIED || errorCode === VoiceError.CLIENT_ERROR)) {
            this._handshakeCount = AndroidVoiceBridge.HANDSHAKE_MAX_RETRY;
            this._lastError = errorCode;
            console.warn('[VoiceBridge] 握手阶段收到致命错误，停止重试');
            return;
        }

        // 权限不足不重启（重启也没用）；识别器忙则多等一会儿
        if (errorCode !== VoiceError.PERMISSION_DENIED) {
            this.scheduleRestart(errorCode === VoiceError.RECOGNIZER_BUSY ? 2.0 : 0);
        }
    }

    /** 自动重启监听 */
    private scheduleRestart(extraDelay: number = 0): void {
        if (!this.continuousListening && this.autoRestartDelay <= 0) return;

        const base = this.autoRestartDelay > 0 ? this.autoRestartDelay : 1.0;
        this.scheduleOnce(() => {
            this.startListening();
        }, base + extraDelay);
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
