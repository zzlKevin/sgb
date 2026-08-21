/**
 * DebugPanel.ts
 * 神光棒 TV6 - 调试信息显示板
 *
 * 使用方法：把本组件挂到 Canvas（或场景任意常驻节点）上，无需任何其他配置。
 * UI 全部代码自动创建（背景/标签/布局），不占场景结构。
 *
 * 功能分区：
 *   ┌──────────────────────────────┐
 *   │ 调试面板 60fps [三指点击隐藏]  │
 *   │ 模式: 默认 | 感应: 开          │
 *   │ 加速度 x0.1 y0.9 z0.0 |g|0.9  │
 *   │ 语音: 监听中(看通知栏麦克风)    │
 *   │ 最新: "迪迦" | 错误: -         │
 *   │ [运行日志，最近 N 条]          │
 *   └──────────────────────────────┘
 *
 * 语音区的隐藏用途——"Java 打包检测器"：
 *   显示"Java桥未就绪" = 原生 Java 代码没打进 APK
 *   （检查 native/engine/android/app/src/main/java/ 下的文件）
 *
 * 操作：三指同时点屏幕 → 显示/隐藏切换
 */

import { _decorator, Component, Node, Label, UITransform, Graphics, Color,
         view, input, Input, EventTouch, find } from 'cc';
import { GSensorController } from './GSensorController';
import { AndroidVoiceBridge } from './AndroidVoiceBridge';
import { GameManager } from './GameManager';
import { GameMode, GameEvents, GDirection, DIRECTION_NAMES } from './GameModeTypes';

const { ccclass, property } = _decorator;

/** 模式名称映射 */
const MODE_NAMES: Record<number, string> = {
    [GameMode.DEFAULT]: '默认',
    [GameMode.SHINING_TIGA]: '闪耀迪迦',
    [GameMode.ULTRA_BROTHERS]: '超奥特B兄弟',
    [GameMode.EVIL_TIGA]: '邪恶迪迦',
    [GameMode.HUMAN_SIZE_TIGA]: '等身迪迦',
    [GameMode.DARK_TIGA]: '黑暗迪迦',
    [GameMode.CAMEERA]: '卡蜜拉',
};

/** 安卓 SpeechRecognizer 标准错误码（用于语音错误行显示） */
const VOICE_ERROR_NAMES: Record<number, string> = {
    1: '网络超时', 2: '网络错误', 3: '音频错误', 4: '服务端错误',
    5: '客户端错误', 6: '无语音超时', 7: '无匹配结果', 8: '识别器忙', 9: '权限不足',
};

@ccclass('DebugPanel')
export class DebugPanel extends Component {

    // ═════════════════════════════════════════
    // 编辑器属性
    // ═════════════════════════════════════════

    /** 是否显示调试面板 */
    @property({ tooltip: '是否显示调试面板' })
    public showPanel: boolean = true;

    /** 日志显示行数 */
    @property({ tooltip: '日志显示行数' })
    public maxLogLines: number = 12;

    /** 刷新间隔（秒） */
    @property({ tooltip: '数据刷新间隔（秒）' })
    public refreshInterval: number = 0.15;

    // ═════════════════════════════════════════
    // 内部状态
    // ═════════════════════════════════════════

    private _root: Node = null;
    private _titleLabel: Label = null;
    private _modeLabel: Label = null;
    private _accelLabel: Label = null;
    private _voiceLabel: Label = null;
    private _logLabel: Label = null;

    private _gameManager: GameManager = null;
    private _gSensor: GSensorController = null;
    private _voiceBridge: AndroidVoiceBridge = null;

    /** 最近触发的方向（中文） */
    private _lastDirection: string = '-';

    /** 最近语音识别文本 */
    private _lastVoiceText: string = '-';

    /** 最近语音错误描述 */
    private _lastVoiceError: string = '-';

    /** 日志行缓存 */
    private _logLines: string[] = [];

    /** console 原始方法（用于卸载时还原） */
    private static _hooked: boolean = false;
    private static _origLog: (...args: any[]) => void = null;
    private static _origWarn: (...args: any[]) => void = null;
    private static _origError: (...args: any[]) => void = null;

    /** 刷新计时 */
    private _refreshTimer: number = 0;

    /** FPS 统计 */
    private _frames: number = 0;
    private _fpsTimer: number = 0;
    private _fps: number = 0;

    // ═════════════════════════════════════════
    // 生命周期
    // ═════════════════════════════════════════

    onLoad() {
        this.findReferences();
        this.buildUI();
        this.hookConsole();
        this.bindEvents();
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);

        if (this._voiceBridge && this._voiceBridge.node && this._voiceBridge.node.isValid) {
            this._voiceBridge.node.off('onVoiceResult', this.onVoiceResultEvt, this);
            this._voiceBridge.node.off('onVoiceError', this.onVoiceErrorEvt, this);
        }
        if (this._gSensor && this._gSensor.node && this._gSensor.node.isValid) {
            this._gSensor.node.off(GameEvents.G_DIRECTION, this.onDirectionEvt, this);
        }

        this.unhookConsole();

        if (this._root && this._root.isValid) {
            this._root.destroy();
            this._root = null;
        }
    }

    update(dt: number) {
        // FPS 统计
        this._frames++;
        this._fpsTimer += dt;
        if (this._fpsTimer >= 1.0) {
            this._fps = Math.round(this._frames / this._fpsTimer);
            this._frames = 0;
            this._fpsTimer = 0;
        }

        if (!this._root || !this._root.active) return;

        // 节流刷新
        this._refreshTimer += dt;
        if (this._refreshTimer < this.refreshInterval) return;
        this._refreshTimer = 0;

        this.refresh();
    }

    // ═════════════════════════════════════════
    // 引用查找（全自动，无需拖引用）
    // ═════════════════════════════════════════

    private findReferences(): void {
        const scene = this.scene || (this.node && this.node.parent);
        if (!scene) return;

        const findFirst = (ctor: any): any => {
            try {
                const list = (scene as Node).getComponentsInChildren(ctor);
                return list && list.length > 0 ? list[0] : null;
            } catch (e) {
                return null;
            }
        };

        this._gameManager = findFirst(GameManager);
        this._gSensor = findFirst(GSensorController);
        this._voiceBridge = findFirst(AndroidVoiceBridge);
    }

    /** 订阅各控制器的事件 */
    private bindEvents(): void {
        if (this._voiceBridge && this._voiceBridge.node) {
            this._voiceBridge.node.on('onVoiceResult', this.onVoiceResultEvt, this);
            this._voiceBridge.node.on('onVoiceError', this.onVoiceErrorEvt, this);
        }
        if (this._gSensor && this._gSensor.node) {
            this._gSensor.node.on(GameEvents.G_DIRECTION, this.onDirectionEvt, this);
        }
    }

    private onVoiceResultEvt(result: { text: string; confidence: number }): void {
        this._lastVoiceText = `"${result.text}"(${result.confidence.toFixed(2)})`;
        this._lastVoiceError = '-';
    }

    private onVoiceErrorEvt(errorCode: number): void {
        const name = VOICE_ERROR_NAMES[errorCode] || '未知';
        this._lastVoiceError = `${errorCode}(${name})`;
    }

    private onDirectionEvt(direction: GDirection): void {
        this._lastDirection = DIRECTION_NAMES[direction] || String(direction);
    }

    // ═════════════════════════════════════════
    // UI 构建（纯代码，零场景配置）
    // ═════════════════════════════════════════

    private buildUI(): void {
        const vs = view.getVisibleSize();
        const margin = 6;
        const pad = 8;
        const width = Math.min(vs.width - margin * 2, 640);

        // 各区高度
        const titleH = 20;
        const lineH = 22;
        const voiceH = 44;   // 语音区两行
        const logLineH = 19;
        const logH = this.maxLogLines * logLineH;
        const height = pad * 2 + titleH + 2 + lineH + 2 + lineH + 2 + voiceH + 4 + logH + 4;

        // 根节点（挂到 Canvas 下，保证全屏 UI 层）
        const canvasNode = (find && find('Canvas')) || this.node.parent || this.node;
        const root = new Node('DebugPanelRoot');
        canvasNode.addChild(root);
        this._root = root;

        const ut = root.addComponent(UITransform);
        ut.setAnchorPoint(0, 1);
        ut.setContentSize(width, height);
        root.setPosition(-vs.width / 2 + margin, vs.height / 2 - margin);

        // 提到最上层渲染
        try {
            root.setSiblingIndex(canvasNode.children.length - 1);
        } catch (e) {}

        // 半透明背景
        const bgNode = new Node('bg');
        root.addChild(bgNode);
        const bgUt = bgNode.addComponent(UITransform);
        bgUt.setContentSize(width, height);
        bgNode.setPosition(0, -height / 2);
        const g = bgNode.addComponent(Graphics);
        g.fillColor = new Color(8, 10, 18, 178);
        g.rect(0, 0, width, height);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = new Color(80, 200, 255, 90);
        g.rect(1, 1, width - 2, height - 2);
        g.stroke();

        // 标签布局（从上往下）
        let cursor = pad;
        const labelW = width - pad * 2;

        this._titleLabel = this.makeLabel(root, 'title', 14,
            new Color(120, 220, 255, 255), pad, -(cursor), labelW, titleH);
        cursor += titleH + 2;

        this._modeLabel = this.makeLabel(root, 'mode', 16,
            new Color(255, 230, 120, 255), pad, -(cursor), labelW, lineH);
        cursor += lineH + 2;

        this._accelLabel = this.makeLabel(root, 'accel', 15,
            new Color(140, 255, 170, 255), pad, -(cursor), labelW, lineH);
        cursor += lineH + 2;

        this._voiceLabel = this.makeLabel(root, 'voice', 14,
            new Color(255, 170, 170, 255), pad, -(cursor), labelW, voiceH);
        this._voiceLabel.enableWrapText = true;
        this._voiceLabel.overflow = Label.Overflow.CLAMP;
        cursor += voiceH + 4;

        this._logLabel = this.makeLabel(root, 'log', 13,
            new Color(200, 200, 200, 235), pad, -(cursor), labelW, logH);
        this._logLabel.enableWrapText = true;
        this._logLabel.overflow = Label.Overflow.CLAMP;

        root.active = this.showPanel;
    }

    private makeLabel(parent: Node, name: string, fontSize: number,
                      color: Color, x: number, y: number, w: number, h: number): Label {
        const n = new Node(name);
        parent.addChild(n);
        const ut = n.addComponent(UITransform);
        ut.setAnchorPoint(0, 1);
        ut.setContentSize(w, h);
        n.setPosition(x, y);

        const label = n.addComponent(Label);
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 4;
        label.color = color;
        label.string = '';
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        return label;
    }

    // ═════════════════════════════════════════
    // 数据刷新
    // ═════════════════════════════════════════

    private refresh(): void {
        if (!this._titleLabel) return;

        // 标题
        this._titleLabel.string = `调试面板 ${this._fps}fps [三指点击隐藏]`;

        // 模式行
        let modeStr = '模式: -(未找到GameManager)';
        if (this._gameManager) {
            const mode = this._gameManager.currentMode;
            modeStr = `模式: ${MODE_NAMES[mode] !== undefined ? MODE_NAMES[mode] : mode}`;
        }
        if (this._gSensor) {
            modeStr += ` | 感应: ${this._gSensor.isEnabled() ? '开' : '关'}`;
        }
        this._modeLabel.string = modeStr;

        // 加速度行
        let accelStr = '加速度: -(未找到GSensor)';
        if (this._gSensor) {
            const a = this._gSensor.lastAccel;
            const b = this._gSensor.baseline;
            const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
            accelStr = `g x${a.x.toFixed(2)} y${a.y.toFixed(2)} z${a.z.toFixed(2)} |g|${mag.toFixed(2)}`;
            accelStr += ` 基准x${b.x.toFixed(2)}y${b.y.toFixed(2)}z${b.z.toFixed(2)}`;
            if (this._gSensor.isCalibrating) accelStr += ' [校准中]';
            accelStr += ` ${this._lastDirection}`;
        }
        this._accelLabel.string = accelStr;

        // 语音行（兼"Java打包检测器"）
        let voiceStr: string;
        if (!this._voiceBridge) {
            voiceStr = '语音: 未找到AndroidVoiceBridge组件（检查挂载）';
        } else if (!this._voiceBridge.isAndroid()) {
            voiceStr = `语音: 非安卓环境（编辑器） 模拟:${this._voiceBridge.debugMode ? '开' : '关'}`;
        } else if (!this._voiceBridge.isInitialized()) {
            voiceStr = '语音: Java桥未就绪 → 原生代码没进APK!\n检查 native/engine/android/app/src/main/java/';
        } else {
            voiceStr = `语音: ${this._voiceBridge.isListening()
                ? '监听中(通知栏有麦克风)' : '就绪·未监听'}`;
            voiceStr += `\n最新: ${this._lastVoiceText}`;
            if (this._lastVoiceError !== '-') {
                voiceStr += ` | 错误: ${this._lastVoiceError}`;
            }
        }
        this._voiceLabel.string = voiceStr;

        // 日志区
        const lines = this._logLines.slice(-this.maxLogLines);
        this._logLabel.string = lines.length > 0 ? lines.join('\n') : '（暂无日志）';
    }

    // ═════════════════════════════════════════
    // console 捕获
    // ═════════════════════════════════════════

    private hookConsole(): void {
        if (DebugPanel._hooked) return;
        DebugPanel._hooked = true;

        DebugPanel._origLog = console.log;
        DebugPanel._origWarn = console.warn;
        DebugPanel._origError = console.error;

        const self = this;

        const fmt = (args: any[]): string => {
            const parts: string[] = [];
            for (const a of args) {
                if (typeof a === 'string') {
                    parts.push(a);
                } else {
                    try {
                        parts.push(JSON.stringify(a));
                    } catch (e) {
                        parts.push(String(a));
                    }
                }
            }
            return parts.join(' ').replace(/\n/g, ' ');
        };

        try {
            console.log = (...args: any[]) => {
                DebugPanel._origLog.apply(console, args);
                self.pushLog('', fmt(args));
            };
            console.warn = (...args: any[]) => {
                DebugPanel._origWarn.apply(console, args);
                self.pushLog('[W]', fmt(args));
            };
            console.error = (...args: any[]) => {
                DebugPanel._origError.apply(console, args);
                self.pushLog('[E]', fmt(args));
            };
        } catch (e) {
            // 原生平台 console 不可覆写时，日志区静默不可用
            DebugPanel._hooked = false;
        }
    }

    private unhookConsole(): void {
        if (!DebugPanel._hooked || !DebugPanel._origLog) return;
        try {
            console.log = DebugPanel._origLog;
            console.warn = DebugPanel._origWarn;
            console.error = DebugPanel._origError;
        } catch (e) {}
        DebugPanel._hooked = false;
    }

    private pushLog(level: string, msg: string): void {
        const t = new Date();
        const ts = `${this.pad2(t.getHours())}:${this.pad2(t.getMinutes())}:${this.pad2(t.getSeconds())}`;
        let line = `[${ts}]${level} ${msg}`;
        if (line.length > 130) line = line.slice(0, 130) + '...';
        this._logLines.push(line);
        if (this._logLines.length > this.maxLogLines * 3) {
            this._logLines.splice(0, this.maxLogLines);
        }
    }

    private pad2(n: number): string {
        return n < 10 ? `0${n}` : `${n}`;
    }

    // ═════════════════════════════════════════
    // 交互
    // ═════════════════════════════════════════

    private onTouchStart(event: EventTouch): void {
        try {
            const touches = event.getTouches ? event.getTouches() : [];
            if (touches.length >= 3) {
                this.toggle();
            }
        } catch (e) {}
    }

    /** 切换显示/隐藏 */
    public toggle(): void {
        if (!this._root) return;
        this._root.active = !this._root.active;
    }
}
