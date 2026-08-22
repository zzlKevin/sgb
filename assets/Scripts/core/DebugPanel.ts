/**
 * DebugPanel.ts
 * 神光棒 TV6 - 调试信息显示板
 *
 * 使用方法：把本组件挂到 Canvas（或场景任意常驻节点）上，无需任何其他配置。
 * UI 全部代码自动创建（背景/标签/布局），不占场景结构。
 *
 * 功能分区：
 *   ┌──────────────────────────────┐
 *   │ 调试面板 60fps [点底座隐藏]    │
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
 * 操作：点击神光棒底座 → 显示/隐藏切换（三指点屏幕为备用）
 */

import { _decorator, Component, Node, Label, UITransform, Color,
         view, input, Input, EventTouch, find, Layers, Canvas, Camera,
         director, Sprite, SpriteFrame, builtinResMgr } from 'cc';
// 注：引擎 3.8 的 cc 模块不导出 ClearFlag 枚举（import 进来是 undefined，
//     运行时报 "Cannot read properties of undefined (reading 'DEPTH_ONLY')"）。
//     正确用法是 Camera.ClearFlag.XXX（引擎把该枚举挂在了 Camera 类上）。
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

    /** 全局单例（GameManager 点击底座切换面板用） */
    private static _instance: DebugPanel = null;
    public static get instance(): DebugPanel {
        return DebugPanel._instance;
    }

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
        DebugPanel._instance = this; // 注册单例（GameManager 点击底座切换用）
        // 防御：调试面板自身绝不允许炸掉整个场景的激活流程
        // （黑屏教训：onLoad 抛异常会中断场景剩余节点的激活）
        try {
            this.findReferences();
            this.buildUI();
            this.hookConsole();
            this.bindEvents();
            console.log('[DebugPanel] 初始化完成 layer=UI_2D root=' +
                (this._root ? this._root.name : '无') +
                ' GM=' + (this._gameManager ? '√' : '×') +
                ' GS=' + (this._gSensor ? '√' : '×') +
                ' VB=' + (this._voiceBridge ? '√' : '×'));
        } catch (e) {
            console.error('[DebugPanel] 初始化失败（不影响游戏本体）', e);
        }
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    onDestroy() {
        if (DebugPanel._instance === this) {
            DebugPanel._instance = null;
        }
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

    /**
     * 获取或自动创建画布（全自动驾驶）。
     * 1. 场景已有 Canvas → 复用，并顺手修正其 UI 相机的黑屏隐患
     * 2. 没有 → 自建 Canvas + 专用 UI 相机（正交/DEPTH_ONLY/只看UI层/后渲染）
     *    （黑屏教训：手动新建的 Canvas 自带相机默认 SOLID_COLOR 清屏，
     *     渲染顺序在主 3D 相机之后，会把整个 3D 画面刷成黑色）
     */
    private getOrCreateCanvas(): Node {
        // ① 全场景找 Canvas
        const existing = find('Canvas');
        if (existing && existing.getComponent(Canvas)) {
            this.fixUICameras(existing);
            return existing;
        }

        // ② 自建（挂到场景根，不受本组件所在节点变换影响）
        const scene = director.getScene();
        if (!scene) {
            console.warn('[DebugPanel] 场景未就绪，面板挂到本组件节点');
            return this.node;
        }

        // 防御：任何一步失败都要清掉已创建的节点——
        // 否则会留下一个「默认黑色清屏 + 最高渲染优先级」的孤儿相机，
        // 它会把整个 3D 画面刷黑（本次安卓真机黑屏的直接原因）
        let canvasNode: Node = null;
        try {
            canvasNode = new Node('DebugCanvas');
            canvasNode.layer = Layers.Enum.UI_2D;
            scene.addChild(canvasNode);
            canvasNode.addComponent(UITransform);
            canvasNode.addComponent(Canvas);

            // 专用 UI 相机（引擎注释：DEPTH_ONLY 常用于 UI 相机——不清颜色，叠加渲染）
            const camNode = new Node('DebugUICamera');
            camNode.layer = Layers.Enum.UI_2D;
            canvasNode.addChild(camNode);
            camNode.setPosition(0, 0, 1000);
            const cam = camNode.addComponent(Camera);
            cam.projection = Camera.ProjectionType.ORTHO;
            cam.orthoHeight = 1000;
            cam.visibility = Layers.Enum.UI_2D;
            cam.priority = 1000;           // 大于主 3D 相机（默认0），后渲染叠加
            // ★ Camera.ClearFlag（不是顶层 ClearFlag——那个在 3.8 的 cc 模块里不存在！）
            cam.clearFlags = Camera.ClearFlag.DEPTH_ONLY;  // ★不清颜色，3D 画面得以保留
            cam.near = 1;
            cam.far = 2001;

            // Canvas 与 UI 相机关联
            canvasNode.getComponent(Canvas).cameraComponent = cam;
        } catch (e) {
            console.error('[DebugPanel] 自建画布失败，清理残留节点', e);
            if (canvasNode && canvasNode.isValid) canvasNode.destroy();
            return this.node;
        }

        console.log('[DebugPanel] 自动创建画布+UI相机完成（DEPTH_ONLY 不黑屏）');
        return canvasNode;
    }

    /**
     * 修正已有 Canvas 下 UI 相机的黑屏隐患：
     * SOLID_COLOR 清屏相机在 3D 场景里会刷黑画面 → 改为 DEPTH_ONLY。
     * 同时确保相机只看 UI_2D 层、渲染顺序在主相机之后。
     */
    private fixUICameras(canvasNode: Node): void {
        try {
            const cams = canvasNode.getComponentsInChildren(Camera);
            for (const cam of cams) {
                if (cam.clearFlags === Camera.ClearFlag.SOLID_COLOR) {
                    cam.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
                    console.log(`[DebugPanel] 已修正 UI 相机 ${cam.node.name}: 清屏→只清深度（防黑屏）`);
                }
                if (cam.priority < 100) {
                    cam.priority = 1000;
                }
            }
        } catch (e) {
            console.warn('[DebugPanel] UI 相机修正失败', e);
        }
    }

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

        // 根节点（自动找/建画布，保证全屏 UI 层）
        const canvasNode = this.getOrCreateCanvas();
        const root = new Node('DebugPanelRoot');
        // ⚠️ 关键：代码创建的节点默认层是 DEFAULT(3D层)，UI 相机看不到！
        // 必须显式设为 UI_2D，否则面板整体隐形（v6 黑屏排查时发现的 bug）
        root.layer = Layers.Enum.UI_2D;
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
        // ⚠️ 修复史：
        //   v4：bgNode 没设锚点（默认居中）→ 一半跑到屏幕外（超界根因）
        //   v5：Graphics 在节点树 inactive→active 后不重绘（背景消失不恢复 bug），
        //       改用 Sprite + 引擎内置白色贴图（default-sprite-splash）着色，
        //       Sprite 是标准渲染组件，重激活 100% 恢复。
        // 边框：外层青色 Sprite 稍大一圈，内层深色 Sprite 盖住中间
        const borderNode = new Node('bgBorder');
        borderNode.layer = Layers.Enum.UI_2D;
        root.addChild(borderNode);
        const borderUt = borderNode.addComponent(UITransform);
        borderUt.setAnchorPoint(0, 1);
        borderUt.setContentSize(width, height);
        borderNode.setPosition(0, 0);
        const borderSprite = borderNode.addComponent(Sprite);
        borderSprite.spriteFrame = builtinResMgr.get<SpriteFrame>('default-sprite-splash');
        borderSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        borderSprite.color = new Color(80, 200, 255, 90);   // 青色描边效果

        const bgNode = new Node('bg');
        bgNode.layer = Layers.Enum.UI_2D;
        root.addChild(bgNode);
        const bgUt = bgNode.addComponent(UITransform);
        bgUt.setAnchorPoint(0, 1);              // 锚点左上，与 root 对齐
        bgUt.setContentSize(width - 4, height - 4);
        bgNode.setPosition(2, -2);              // 四周留 2px 露出边框色
        const bgSprite = bgNode.addComponent(Sprite);
        bgSprite.spriteFrame = builtinResMgr.get<SpriteFrame>('default-sprite-splash');
        bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        bgSprite.color = new Color(8, 10, 18, 178);          // 半透明深色底

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
        n.layer = Layers.Enum.UI_2D;
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
        this._titleLabel.string = `调试面板 ${this._fps}fps [点底座隐藏]`;

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
            voiceStr = `语音: 握手中 ${this._voiceBridge.getHandshakeCount()}/10` +
                `（Java桥未就绪可能是原生代码没进APK）\n检查 native/engine/android/app/src/main/java/`;
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
            // ⚠️ 修复：getTouches() 只含"本次变动的触点"（引擎源码注释），
            //    三指先后按下时每次回调只有 1 根 → length>=3 永远不成立（三指隐藏失效的根因）。
            //    必须用 getAllTouches()（当前屏幕上的全部触点）。此路径保留作备用，
            //    主交互已改为「点击神光棒底座」切换面板（见 GameManager.isBaseNode）。
            const all = event.getAllTouches ? event.getAllTouches() : [];
            if (all.length >= 3) {
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
