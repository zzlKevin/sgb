/**
 * GameManager.ts
 * 神光棒 TV6 - 核心状态机管理器
 *
 * 统一管理：
 *   - 模式切换（0~6）
 *   - 变身状态（变身前/变身后）
 *   - 形态切换（复合/强力/空中、黑暗迪迦5形态等）
 *   - A键短按/长按、B键短按
 *   - 重力感应方向映射
 *   - LED灯珠颜色映射
 *   - 子系统协调（AudioManager + LEDController + GSensorController + VoiceCommandManager）
 *
 * 基于文档「神光棒 TV6.txt」完整状态机定义
 */

import { _decorator, Component, Node, input, Input, EventKeyboard, KeyCode, sys, MeshRenderer, AudioSource, find, Camera, PhysicsSystem, EventTouch } from 'cc';
import {
    GameMode,
    TigaForm,
    DarkTigaForm,
    TransformState,
    GDirection,
    LEDColor,
    BGMPlayMode,
    DEFAULT_FORM_CYCLE,
    DARK_FORM_CYCLE,
    GameEvents,
    MODE_NAMES,
} from './GameModeTypes';
import { LEDController } from './LEDController';
import { GSensorController } from './GSensorController';
import { DebugPanel } from './DebugPanel';
import { AudioManager } from './AudioManager';
import { VoiceCommandManager } from './VoiceCommandManager';
import { AndroidVoiceBridge } from './AndroidVoiceBridge';

const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {

    // ═════════════════════════════════════════
    // 编辑器属性（只需拖这一个）
    // ═════════════════════════════════════════

    /** 神光棒模型根节点（留空则自动查找场景中名为"神光棒"的节点） */
    @property(Node)
    public modelRoot: Node = null;

    /** WingToggle 组件引用（留空则自动查找） */
    @property(Component)
    public wingToggle: any = null;

    /** 神光棒中心节点（A键碰撞体所在节点，留空自动查找"神光棒中心"或"神光棒中心（A键）"） */
    @property(Node)
    public aKeyNode: Node = null;

    /** B键节点（留空自动查找名为"B键"的节点） */
    @property(Node)
    public bKeyNode: Node = null;

    /** 左翼节点（留空自动查找） */
    @property(Node)
    public leftWingNode: Node = null;

    /** 右翼节点（留空自动查找） */
    @property(Node)
    public rightWingNode: Node = null;

    // ═════════════════════════════════════════
    // 子系统引用（自动创建，不需要手动拖）
    // ═════════════════════════════════════════

    private _ledController: LEDController = null;
    private _gSensorController: GSensorController = null;
    private _audioManager: AudioManager = null;
    private _voiceCommandManager: VoiceCommandManager = null;

    /** 访问器（外部只读） */
    public get ledController() { return this._ledController; }
    public get gSensorController() { return this._gSensorController; }
    public get audioManager() { return this._audioManager; }
    public get voiceCommandManager() { return this._voiceCommandManager; }

    // ═════════════════════════════════════════
    // 内部状态
    // ═════════════════════════════════════════

    private _currentMode: GameMode = GameMode.DEFAULT;
    private _transformState: TransformState = TransformState.PRE_TRANSFORM;
    private _currentForm: TigaForm = TigaForm.MULTI;
    private _currentDarkForm: DarkTigaForm = DarkTigaForm.TORNADO;
    private _gSensorEnabled: boolean = true;
    private _aKeyDownTime: number = 0;
    private _aKeyPressed: boolean = false;
    private readonly LONG_PRESS_THRESHOLD: number = 1.0;

    /** 触摸A键的开始时间（用于长按检测） */
    private _touchStartTime: number = 0;
    /** 触摸A键中 */
    private _touchingAKey: boolean = false;
    /** 主相机引用 */
    private _mainCamera: Camera = null;

    // ═════════════════════════════════════════
    // 生命周期
    // ═════════════════════════════════════════

    onLoad() {
        this.autoSetupSubsystems();
        this.setupEventListeners();
        this.setupKeyboardInput();
        this.setupTouchInput();
    }

    start() {
        // 进入默认模式
        this.enterMode(GameMode.DEFAULT);
    }

    onDestroy() {
        this.removeEventListeners();
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    // ═════════════════════════════════════════
    // 自动配置子系统（核心：用户不需要手动拖任何组件）
    // ═════════════════════════════════════════

    private autoSetupSubsystems(): void {
        // ── 1. 查找模型根节点 ──
        if (!this.modelRoot) {
            // 自动查找场景中名为"神光棒"的节点
            this.modelRoot = find('神光棒') || find('神光棒中心（A键）') || this.node;
            console.log(`[GameManager] 自动查找模型根节点: ${this.modelRoot?.name}`);
        }

        // ── 2. 查找 WingToggle ──
        if (!this.wingToggle) {
            // 在模型根节点及其子节点中查找 WingToggle 组件
            this.wingToggle = this.findComponentInTree(this.modelRoot, 'WingToggle');
            if (this.wingToggle) {
                console.log('[GameManager] 自动找到 WingToggle');
            }
        }

        // ── 3. 创建 AudioSource 组件 ──
        // BGM AudioSource
        let bgmSource = this.node.getComponent(AudioSource);
        if (!bgmSource) {
            bgmSource = this.node.addComponent(AudioSource);
        }
        bgmSource.volume = 1.0;
        bgmSource.loop = false;

        // SFX AudioSource
        let sfxSource: AudioSource = null;
        const allAudioSources = this.node.getComponents(AudioSource);
        if (allAudioSources.length >= 2) {
            sfxSource = allAudioSources[1];
        } else {
            sfxSource = this.node.addComponent(AudioSource);
        }
        sfxSource.volume = 1.0;
        sfxSource.loop = false;

        // ── 4. 添加 AudioManager ──
        this._audioManager = this.node.getComponent(AudioManager) || this.node.addComponent(AudioManager);
        this._audioManager.bgmSource = bgmSource;
        this._audioManager.sfxSources = [sfxSource];

        // ── 5. 查找灯珠 MeshRenderer 并添加 LEDController ──
        this._ledController = this.node.getComponent(LEDController) || this.node.addComponent(LEDController);
        const ledRenderers = this.findLEDRenderers(this.modelRoot);
        if (ledRenderers.length > 0) {
            this._ledController.ledRenderer1 = ledRenderers[0];
            console.log(`[GameManager] 找到灯珠1: ${ledRenderers[0].node.name}`);
        }
        if (ledRenderers.length > 1) {
            this._ledController.ledRenderer2 = ledRenderers[1];
            console.log(`[GameManager] 找到灯珠2: ${ledRenderers[1].node.name}`);
        }
        if (ledRenderers.length === 0) {
            console.warn('[GameManager] 未找到灯珠 MeshRenderer！请检查模型中是否有名为"灯珠"的节点');
        }

        // ── 6. 添加 GSensorController ──
        this._gSensorController = this.node.getComponent(GSensorController) || this.node.addComponent(GSensorController);

        // ── 7. 添加 AndroidVoiceBridge ──
        //    touchToStart / debugMode 保持各自默认值(false)，
        //    不在编辑器/浏览器中自动模拟语音指令，避免点击双翼时误触发。
        //    如需调试，在编辑器属性检查器中手动勾选 debugMode。
        const voiceBridge = this.node.getComponent(AndroidVoiceBridge) || this.node.addComponent(AndroidVoiceBridge);

        // ── 8. 添加 VoiceCommandManager ──
        this._voiceCommandManager = this.node.getComponent(VoiceCommandManager) || this.node.addComponent(VoiceCommandManager);
        this._voiceCommandManager.voiceBridgeNode = this.node;
        this._voiceCommandManager.gameManagerNode = this.node;

        // ── 9. 自动查找 A键节点（神光棒中心碰撞体） ──
        if (!this.aKeyNode) {
            this.aKeyNode = this.findNodeByName(this.modelRoot, '神光棒中心')
                || this.findNodeByName(this.modelRoot, '神光棒中心（A键）')
                || this.findNodeByName(find('神光棒'), '神光棒中心');
            if (this.aKeyNode) {
                console.log(`[GameManager] 自动找到 A键节点: ${this.aKeyNode.name}`);
            } else {
                console.warn('[GameManager] 未找到神光棒中心节点，触摸A键功能不可用');
            }
        }

        // ── 10. 自动查找左右翼节点 ──
        if (!this.leftWingNode) {
            this.leftWingNode = this.findNodeByName(this.modelRoot, '左翼组')
                || this.findNodeByName(this.modelRoot, '左翼');
        }
        if (!this.rightWingNode) {
            this.rightWingNode = this.findNodeByName(this.modelRoot, '右翼组')
                || this.findNodeByName(this.modelRoot, '右翼');
        }

        // ── 10.5 自动查找 B键节点 ──
        if (!this.bKeyNode) {
            // 先在模型根节点下找，再在整个场景找
            this.bKeyNode = this.findNodeByName(this.modelRoot, 'B键')
                || this.findNodeByName(find('神光棒'), 'B键');
            if (this.bKeyNode) {
                console.log(`[GameManager] 自动找到 B键节点: ${this.bKeyNode.name}`);
            } else {
                console.warn('[GameManager] 未找到名为"B键"的节点，B键功能不可用');
            }
        }

        // ── 11. 查找主相机 ──
        this._mainCamera = find('Main Camera')?.getComponent(Camera);

        console.log('[GameManager] 子系统自动配置完成');
    }

    /**
     * 在节点树中查找名为"灯珠"的节点，返回其 MeshRenderer
     * 支持 FBX 预制体内部的子节点
     */
    private findLEDRenderers(root: Node): MeshRenderer[] {
        const results: MeshRenderer[] = [];

        const walk = (node: Node) => {
            // 检查节点名是否包含灯珠相关关键词
            const name = node.name || '';
            if (name.includes('灯') || name.includes('LED') || name.includes('珠') || name.includes('灯珠')) {
                const mr = node.getComponent(MeshRenderer);
                if (mr) {
                    results.push(mr);
                    console.log(`[GameManager] 在节点 "${name}" 上找到 MeshRenderer`);
                }
            }
            // 递归子节点
            for (const child of node.children) {
                walk(child);
            }
        };

        if (root) walk(root);

        return results;
    }

    /**
     * 在节点树中查找指定类名的组件
     */
    private findComponentInTree(root: Node, className: string): any {
        if (!root) return null;

        // 先检查根节点
        const comp = root.getComponent(className);
        if (comp) return comp;

        // 递归子节点
        for (const child of root.children) {
            const found = this.findComponentInTree(child, className);
            if (found) return found;
        }
        return null;
    }

    /**
     * 在节点树中按名称查找节点（支持部分匹配）
     */
    private findNodeByName(root: Node, namePart: string): Node | null {
        if (!root) return null;
        if (root.name && root.name.includes(namePart)) return root;
        for (const child of root.children) {
            const found = this.findNodeByName(child, namePart);
            if (found) return found;
        }
        return null;
    }

    // ═════════════════════════════════════════
    // 触摸输入（安卓/浏览器通用）
    // 点神光棒中心(A键) → 始终展开双翼 + A键短按/长按
    // 点双翼 → 始终收回双翼
    // 点B键节点 → B键短按（切换灯光颜色）
    // ═════════════════════════════════════════

    private setupTouchInput(): void {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    private onTouchStart(event: EventTouch): void {
        if (!this._mainCamera) {
            this._mainCamera = find('Main Camera')?.getComponent(Camera);
        }
        if (!this._mainCamera) return;

        const screenPos = event.getLocation();
        const ray = this._mainCamera.screenPointToRay(screenPos.x, screenPos.y);

        if (!PhysicsSystem.instance.raycast(ray)) return;

        const results = PhysicsSystem.instance.raycastResults;
        if (results.length === 0) return;

        const hitNode = results[0].collider.node;
        const hitNodeName = hitNode.name || '';

        // 检查是否点到了底座 → 切换调试面板显示/隐藏（用户指定的新交互）
        // 必须放在 B键/A键 之前：底座紧邻 A键，且名字互不重叠，先行判断最安全
        if (this.isBaseNode(hitNode)) {
            console.log('[GameManager] 触摸底座 → 切换调试面板');
            if (DebugPanel.instance) {
                DebugPanel.instance.toggle();
            } else {
                console.warn('[GameManager] DebugPanel 实例不存在（未挂载或初始化失败）');
            }
            return;
        }

        // 检查是否点到了 B键节点
        if (this.bKeyNode && (hitNode === this.bKeyNode || hitNode.parent === this.bKeyNode
            || hitNodeName.includes('B键'))) {
            console.log('[GameManager] 触摸B键 → 切换灯光颜色');
            this.node.emit(GameEvents.SHORT_PRESS_B, null);
            return;
        }

        // 检查是否点到了双翼 → 始终收回双翼
        const isLeftWing = this.leftWingNode && (hitNode === this.leftWingNode
            || hitNode.parent === this.leftWingNode || hitNodeName.includes('左翼'));
        const isRightWing = this.rightWingNode && (hitNode === this.rightWingNode
            || hitNode.parent === this.rightWingNode || hitNodeName.includes('右翼'));

        if (isLeftWing || isRightWing) {
            console.log('[GameManager] 触摸双翼 → 收回双翼');
            if (this.wingToggle) {
                this.wingToggle.setOpen(false);
            }
            return;
        }

        // 检查是否点到了 A键节点（神光棒中心）→ 始终展开双翼 + 触发A键
        if (this.aKeyNode && (hitNode === this.aKeyNode || hitNode.parent === this.aKeyNode
            || hitNodeName.includes('神光棒中心') || hitNodeName.includes('A键'))) {
            // A键：始终展开双翼（物理结构，按了就弹开）
            if (this.wingToggle) {
                this.wingToggle.setOpen(true);
            }
            this._touchingAKey = true;
            this._touchStartTime = Date.now();
            console.log('[GameManager] 触摸A键（神光棒中心）→ 展开双翼');
            return;
        }
    }

    /**
     * 判断节点（含祖先链，最多 20 层）是否为神光棒底座节点。
     * 名字宽松匹配：底座 / 基座 / base —— 兼容模型内部节点命名与英文模型
     * （用户的底座碰撞体挂在神光棒 prefab 内部节点上，名字可能带前缀）。
     */
    private isBaseNode(node: Node): boolean {
        let cur: Node = node;
        let depth = 0;
        while (cur && depth < 20) {
            const nm = (cur.name || '').toLowerCase();
            if (nm.includes('底座') || nm.includes('基座')
                || nm === 'base' || nm.endsWith('_base') || nm.startsWith('base_')) {
                return true;
            }
            cur = cur.parent;
            depth++;
        }
        return false;
    }

    private onTouchEnd(_event: EventTouch): void {
        if (this._touchingAKey) {
            const duration = (Date.now() - this._touchStartTime) / 1000;
            this._touchingAKey = false;

            if (duration >= this.LONG_PRESS_THRESHOLD) {
                console.log(`[GameManager] A键长按 ${duration.toFixed(2)}s`);
                this.node.emit(GameEvents.LONG_PRESS_A, null);
            } else {
                console.log(`[GameManager] A键短按 ${duration.toFixed(2)}s`);
                this.node.emit(GameEvents.SHORT_PRESS_A, null);
            }
        }
    }

    // ═════════════════════════════════════════
    // 事件监听
    // ═════════════════════════════════════════

    private setupEventListeners(): void {
        // 模式切换
        this.node.on(GameEvents.MODE_CHANGE, this.onModeChange, this);

        // 重力感应方向
        this.node.on(GameEvents.G_DIRECTION, this.onGDirection, this);

        // LED 颜色变化
        this.node.on(GameEvents.LED_COLOR_CHANGE, this.onLEDColorChange, this);

        // 声控开关
        this.node.on(GameEvents.VOICE_CONTROL_TOGGLE, this.onVoiceControlToggle, this);

        // 重力感应开关
        this.node.on(GameEvents.GSENSOR_TOGGLE, this.onGSensorToggle, this);

        // BGM 控制
        this.node.on('onBGMPlay', this.onBGMPlay, this);
        this.node.on('onBGMReserve', this.onBGMReserve, this);
        this.node.on('onBGMTrack', this.onBGMTrack, this);
        this.node.on('onBGMModeChange', this.onBGMModeChange, this);

        // 短按/长按 A/B
        this.node.on(GameEvents.SHORT_PRESS_A, this.onShortPressA, this);
        this.node.on(GameEvents.LONG_PRESS_A, this.onLongPressA, this);
        this.node.on(GameEvents.SHORT_PRESS_B, this.onShortPressB, this);
    }

    private removeEventListeners(): void {
        this.node.off(GameEvents.MODE_CHANGE, this.onModeChange, this);
        this.node.off(GameEvents.G_DIRECTION, this.onGDirection, this);
        this.node.off(GameEvents.LED_COLOR_CHANGE, this.onLEDColorChange, this);
        this.node.off(GameEvents.VOICE_CONTROL_TOGGLE, this.onVoiceControlToggle, this);
        this.node.off(GameEvents.GSENSOR_TOGGLE, this.onGSensorToggle, this);
        this.node.off('onBGMPlay', this.onBGMPlay, this);
        this.node.off('onBGMReserve', this.onBGMReserve, this);
        this.node.off('onBGMTrack', this.onBGMTrack, this);
        this.node.off('onBGMModeChange', this.onBGMModeChange, this);
        this.node.off(GameEvents.SHORT_PRESS_A, this.onShortPressA, this);
        this.node.off(GameEvents.LONG_PRESS_A, this.onLongPressA, this);
        this.node.off(GameEvents.SHORT_PRESS_B, this.onShortPressB, this);
    }

    /** 键盘模拟 A/B 键 */
    private setupKeyboardInput(): void {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
    }

    private onKeyDown(event: EventKeyboard): void {
        if (event.keyCode === KeyCode.KEY_A) {
            if (!this._aKeyPressed) {
                this._aKeyPressed = true;
                this._aKeyDownTime = Date.now();
            }
        }
        if (event.keyCode === KeyCode.KEY_B) {
            // B键短按：切换灯光颜色
            this.node.emit(GameEvents.SHORT_PRESS_B, null);
        }
    }

    private onKeyUp(event: EventKeyboard): void {
        if (event.keyCode === KeyCode.KEY_A) {
            if (this._aKeyPressed) {
                const duration = (Date.now() - this._aKeyDownTime) / 1000;
                if (duration >= this.LONG_PRESS_THRESHOLD) {
                    this.node.emit(GameEvents.LONG_PRESS_A, null);
                } else {
                    this.node.emit(GameEvents.SHORT_PRESS_A, null);
                }
                this._aKeyPressed = false;
            }
        }
    }

    // ═════════════════════════════════════════
    // 模式切换
    // ═════════════════════════════════════════

    private onModeChange(mode: GameMode): void {
        this.enterMode(mode);
    }

    /** 进入模式 */
    private enterMode(mode: GameMode): void {
        // 退出旧模式
        this.exitMode(this._currentMode);

        this._currentMode = mode;
        this._transformState = TransformState.PRE_TRANSFORM;
        this._currentForm = TigaForm.MULTI;
        this._currentDarkForm = DarkTigaForm.TORNADO;

        console.log(`[GameManager] 进入模式: ${MODE_NAMES[mode]}`);

        // 通知子系统
        if (this.audioManager) {
            this.audioManager.setMode(mode);
        }
        if (this.voiceCommandManager) {
            this.voiceCommandManager.setCurrentMode(mode);
        }

        // 模式进入时的默认行为
        switch (mode) {
            case GameMode.DEFAULT:
                this.onEnterDefaultMode();
                break;
            case GameMode.SHINING_TIGA:
                this.onEnterShiningTigaMode();
                break;
            case GameMode.ULTRA_BROTHERS:
                this.onEnterUltraBrothersMode();
                break;
            case GameMode.EVIL_TIGA:
                this.onEnterEvilTigaMode();
                break;
            case GameMode.HUMAN_SIZE_TIGA:
                this.onEnterHumanSizeTigaMode();
                break;
            case GameMode.DARK_TIGA:
                this.onEnterDarkTigaMode();
                break;
            case GameMode.CAMEERA:
                this.onEnterCameeraMode();
                break;
        }
    }

    /** 退出模式 */
    private exitMode(mode: GameMode): void {
        // 停止所有音效
        if (this.audioManager) {
            this.audioManager.stopBGM();
        }
        // 重置灯珠
        if (this.ledController) {
            this.ledController.stopAllEffects();
        }
        // 合拢双翼
        if (this.wingToggle) {
            this.wingToggle.setOpen(false);
        }
    }

    // ═════════════════════════════════════════
    // A键处理
    // ═════════════════════════════════════════

    /** 短按 A 键 */
    private onShortPressA(): void {
        console.log(`[GameManager] 短按A (模式=${this._currentMode}, 变身=${this._transformState})`);

        switch (this._currentMode) {
            case GameMode.DEFAULT:
                this.shortPressA_Default();
                break;
            case GameMode.SHINING_TIGA:
                this.shortPressA_ShiningTiga();
                break;
            case GameMode.ULTRA_BROTHERS:
                this.shortPressA_UltraBrothers();
                break;
            case GameMode.EVIL_TIGA:
                this.shortPressA_EvilTiga();
                break;
            case GameMode.HUMAN_SIZE_TIGA:
                this.shortPressA_HumanSizeTiga();
                break;
            case GameMode.DARK_TIGA:
                this.shortPressA_DarkTiga();
                break;
            case GameMode.CAMEERA:
                this.shortPressA_Cameera();
                break;
        }
    }

    /** 长按 A 键（1秒） */
    private onLongPressA(): void {
        console.log(`[GameManager] 长按A (模式=${this._currentMode})`);

        switch (this._currentMode) {
            case GameMode.DEFAULT:
                this.longPressA_Default();
                break;
            case GameMode.SHINING_TIGA:
                this.longPressA_ShiningTiga();
                break;
            case GameMode.ULTRA_BROTHERS:
                this.longPressA_UltraBrothers();
                break;
            case GameMode.EVIL_TIGA:
                this.longPressA_EvilTiga();
                break;
            case GameMode.HUMAN_SIZE_TIGA:
                this.longPressA_HumanSizeTiga();
                break;
            case GameMode.DARK_TIGA:
                this.longPressA_DarkTiga();
                break;
            case GameMode.CAMEERA:
                this.longPressA_Cameera();
                break;
        }
    }

    /** 短按 B 键：切换灯光颜色 */
    private onShortPressB(): void {
        console.log('[GameManager] 短按B：切换灯光颜色');
        // 循环切换颜色（只取数值枚举，过滤字符串键）
        const colors = Object.values(LEDColor).filter(v => typeof v === 'number') as LEDColor[];
        const currentIndex = colors.indexOf(this.ledController?.currentColor ?? LEDColor.WHITE);
        const nextColor = colors[(currentIndex + 1) % colors.length];
        if (this.ledController) {
            this.ledController.setColor(nextColor);
        }
    }

    // ═════════════════════════════════════════
    // 重力感应方向处理
    // ═════════════════════════════════════════

    private onGDirection(direction: GDirection): void {
        if (!this._gSensorEnabled) {
            console.log('[GameManager] 重力感应已关闭，忽略方向');
            return;
        }

        // 向下：打断点（所有模式通用）
        if (direction === GDirection.DOWN) {
            this.onDirectionDown();
            return;
        }

        console.log(`[GameManager] 重力方向: ${direction} (模式=${this._currentMode})`);

        // 按模式分发
        switch (this._currentMode) {
            case GameMode.DEFAULT:
                this.handleDirection_Default(direction);
                break;
            case GameMode.SHINING_TIGA:
                this.handleDirection_ShiningTiga(direction);
                break;
            case GameMode.ULTRA_BROTHERS:
                this.handleDirection_UltraBrothers(direction);
                break;
            case GameMode.EVIL_TIGA:
                this.handleDirection_EvilTiga(direction);
                break;
            case GameMode.HUMAN_SIZE_TIGA:
                this.handleDirection_HumanSizeTiga(direction);
                break;
            case GameMode.DARK_TIGA:
                this.handleDirection_DarkTiga(direction);
                break;
            case GameMode.CAMEERA:
                this.handleDirection_Cameera(direction);
                break;
        }
    }

    /** 向下方向：打断点（所有模式通用） */
    private onDirectionDown(): void {
        console.log('[GameManager] 向下打断：停止所有音频');
        if (this.audioManager) {
            this.audioManager.interruptAll();
        }
        // 重置重力感应状态
        if (this.gSensorController) {
            // 触发重置
        }
    }

    // ═════════════════════════════════════════
    // LED 颜色变化
    // ═════════════════════════════════════════

    private onLEDColorChange(color: LEDColor): void {
        if (this.ledController) {
            this.ledController.setColor(color);
        }
    }

    // ═════════════════════════════════════════
    // 声控/重力感应开关
    // ═════════════════════════════════════════

    private onVoiceControlToggle(enabled: boolean): void {
        console.log(`[GameManager] 声控 ${enabled ? '开启' : '关闭'}`);
    }

    private onGSensorToggle(enabled: boolean): void {
        this._gSensorEnabled = enabled;
        if (this.gSensorController) {
            this.gSensorController.setEnabled(enabled);
        }
        console.log(`[GameManager] 重力感应 ${enabled ? '开启' : '关闭'}`);
    }

    // ═════════════════════════════════════════
    // BGM 控制
    // ═════════════════════════════════════════

    private onBGMPlay(track: number): void {
        if (this.audioManager) {
            if (track > 0) {
                this.audioManager.playBGM(track);
            } else {
                this.audioManager.voicePlay();
            }
        }
    }

    private onBGMReserve(track: number): void {
        if (this.audioManager) {
            if (track > 0) {
                this.audioManager.reserveBGM(track);
            } else {
                this.audioManager.voiceReserve();
            }
        }
    }

    private onBGMTrack(track: number): void {
        if (this.audioManager) {
            this.audioManager.voiceTrackNumber(track);
        }
    }

    private onBGMModeChange(mode: BGMPlayMode): void {
        if (this.audioManager) {
            this.audioManager.setBGMPlayMode(mode);
        }
    }

    // ═════════════════════════════════════════
    // 模式 0：默认复合模式
    // ═════════════════════════════════════════

    private onEnterDefaultMode(): void {
        // 默认白色灯珠
        if (this.ledController) {
            this.ledController.setColor(LEDColor.WHITE);
        }
    }

    /** 默认模式短按A */
    private shortPressA_Default(): void {
        if (this._transformState === TransformState.PRE_TRANSFORM) {
            // 变身前：变身音效（双翼已在触摸时展开）
            this._transformState = TransformState.POST_TRANSFORM;
            if (this.ledController) this.ledController.setColor(LEDColor.WHITE);
            // 同时播放挥棒声 + 变身音
            this.playSFX('004.默认举起,.使用');
            this.playSFX('015.迪迦纯变身音', undefined, () => {
                // 变身音播完后播放战吼
                this.playSFX('016.-迪迦叫声1');
            });
        } else {
            // 变身后：根据形态播放对应战吼
            this.playFormRoar(this._currentForm);
        }
    }

    /** 默认模式长按A：循环切换形态 */
    private longPressA_Default(): void {
        const idx = DEFAULT_FORM_CYCLE.indexOf(this._currentForm);
        this._currentForm = DEFAULT_FORM_CYCLE[(idx + 1) % DEFAULT_FORM_CYCLE.length];
        // 默认模式形态切换通用音
        this.playSFX('021.迪迦切换形态通用音');

        // 形态对应灯珠颜色
        const formColors: Record<number, LEDColor> = {
            [TigaForm.MULTI]: LEDColor.WHITE,
            [TigaForm.POWER]: LEDColor.RED,
            [TigaForm.SKY]: LEDColor.PURPLE,
        };
        if (this.ledController) {
            this.ledController.setColor(formColors[this._currentForm]);
        }

        this.node.emit(GameEvents.FORM_CHANGE, this._currentForm);
    }

    /** 重力感应方向映射 - 默认模式 */
    private handleDirection_Default(direction: GDirection): void {
        if (this._transformState !== TransformState.POST_TRANSFORM) {
            // 变身前重力感应无灯光
            if (!this._gSensorEnabled) return;
            this.playDirectionSfx(direction);
            return;
        }

        // 变身后：根据形态和方向触发不同技能
        switch (this._currentForm) {
            case TigaForm.MULTI:
                this.handleDirection_MultiForm(direction);
                break;
            case TigaForm.POWER:
                this.handleDirection_PowerForm(direction);
                break;
            case TigaForm.SKY:
                this.handleDirection_SkyForm(direction);
                break;
        }
    }

    /** 复合型重力感应映射 */
    private handleDirection_MultiForm(direction: GDirection): void {
        const actions: Record<number, { sfx: string; color: LEDColor }> = {
            [GDirection.LEFT]: { sfx: '009.-哉佩利敖光线', color: LEDColor.WHITE },
            [GDirection.RIGHT]: { sfx: '009.-哉佩利敖光线', color: LEDColor.WHITE },
            [GDirection.FORWARD]: { sfx: '007.小技能1', color: LEDColor.WHITE },
            [GDirection.UP]: { sfx: '009.-哉佩利敖光线', color: LEDColor.WHITE },
            [GDirection.PULL_BACK]: { sfx: '006.拉回神光棒', color: LEDColor.WHITE },
        };
        this.executeDirectionAction(actions[direction]);
    }

    /** 强力型重力感应映射 */
    private handleDirection_PowerForm(direction: GDirection): void {
        const actions: Record<number, { sfx: string; color: LEDColor }> = {
            [GDirection.LEFT]: { sfx: '012.-强力型必杀', color: LEDColor.RED },
            [GDirection.RIGHT]: { sfx: '012.-强力型必杀', color: LEDColor.RED },
            [GDirection.FORWARD]: { sfx: '011.强力型小技能1', color: LEDColor.RED },
            [GDirection.UP]: { sfx: '023.强力型哉佩利敖光线', color: LEDColor.RED },
            [GDirection.PULL_BACK]: { sfx: '006.拉回神光棒', color: LEDColor.RED },
        };
        this.executeDirectionAction(actions[direction]);
    }

    /** 空中型重力感应映射 */
    private handleDirection_SkyForm(direction: GDirection): void {
        const actions: Record<number, { sfx: string; color: LEDColor }> = {
            [GDirection.LEFT]: { sfx: '014.空中型必杀', color: LEDColor.PURPLE },
            [GDirection.RIGHT]: { sfx: '014.空中型必杀', color: LEDColor.PURPLE },
            [GDirection.FORWARD]: { sfx: '013.-空中型小技能1', color: LEDColor.PURPLE },
            [GDirection.UP]: { sfx: '024.-空中型小技能2', color: LEDColor.PURPLE },
            [GDirection.PULL_BACK]: { sfx: '006.拉回神光棒', color: LEDColor.PURPLE },
        };
        this.executeDirectionAction(actions[direction]);
    }

    /** 播放形态战吼 */
    private playFormRoar(form: TigaForm): void {
        const roars: Record<number, string> = {
            [TigaForm.MULTI]: '016.-迪迦叫声1',
            [TigaForm.POWER]: '017.迪迦叫声2',
            [TigaForm.SKY]: '018.迪迦叫声3',
        };
        this.playSFX(roars[form]);
    }

    // ═════════════════════════════════════════
    // 模式 1：闪耀迪迦模式
    // ═════════════════════════════════════════

    private onEnterShiningTigaMode(): void {
        if (this.ledController) {
            this.ledController.setColor(LEDColor.YELLOW);
        }
    }

    private shortPressA_ShiningTiga(): void {
        if (this._transformState === TransformState.PRE_TRANSFORM) {
            // 双翼已在触摸时展开 + 变身音
            this._transformState = TransformState.POST_TRANSFORM;
            if (this.ledController) this.ledController.flash(LEDColor.YELLOW, 10, 0.3);
            this.playSFX('007.闪耀迪迦模式-光芒涌现');
        } else {
            this.playSFX('010.迪迦叫声1');
        }
    }

    private longPressA_ShiningTiga(): void {
        // 文档：长按切换形态（同默认模式）
        this.longPressA_Default();
    }

    private handleDirection_ShiningTiga(direction: GDirection): void {
        // 闪耀迪迦：所有方向触发闪耀必杀(黄)
        const actions: Record<number, { sfx: string; color: LEDColor }> = {
            [GDirection.LEFT]: { sfx: '005.闪耀迪迦模式-闪耀栽佩利敖光线', color: LEDColor.YELLOW },
            [GDirection.RIGHT]: { sfx: '005.闪耀迪迦模式-闪耀栽佩利敖光线', color: LEDColor.YELLOW },
            [GDirection.FORWARD]: { sfx: '003.闪耀迪迦模式-闪耀爆裂', color: LEDColor.YELLOW },
            [GDirection.UP]: { sfx: '004.闪耀迪迦模式-闪耀型完整必杀', color: LEDColor.YELLOW },
            [GDirection.PULL_BACK]: { sfx: '006.神光棒消失', color: LEDColor.YELLOW },
        };
        this.executeDirectionAction(actions[direction]);
    }

    // ═════════════════════════════════════════
    // 模式 2：超奥特B兄弟模式
    // ═════════════════════════════════════════

    private onEnterUltraBrothersMode(): void {
        if (this.ledController) {
            this.ledController.setColor(LEDColor.WHITE);
        }
    }

    private shortPressA_UltraBrothers(): void {
        if (this._transformState === TransformState.PRE_TRANSFORM) {
            // 双翼已在触摸时展开 + 变身音
            this._transformState = TransformState.POST_TRANSFORM;
            this.playSFX('011.超八变身音(完整版)');
        } else {
            this.playSFX('012.超八模式-最终圣战叫声1');
        }
    }

    private longPressA_UltraBrothers(): void {
        // 循环切换奥特兄弟
        console.log('[GameManager] 超八模式：切换奥特兄弟');
        this.playSFX('017.模式进入音');
    }

    private handleDirection_UltraBrothers(direction: GDirection): void {
        // 超八模式重力感应：方向 → 对应兄弟必杀
        const actions: Record<number, { sfx: string; color: LEDColor }> = {
            [GDirection.LEFT]: { sfx: '007.超八模式-复合型必杀蓄力', color: LEDColor.WHITE },
            [GDirection.RIGHT]: { sfx: '009.超八模式-复合型必杀释放', color: LEDColor.WHITE },
            [GDirection.FORWARD]: { sfx: '008.超八模式-八奥合击', color: LEDColor.WHITE },
            [GDirection.UP]: { sfx: '008.超八模式-八奥合击', color: LEDColor.WHITE },
            [GDirection.PULL_BACK]: { sfx: '006.超八模式-拉回神光棒', color: LEDColor.WHITE },
        };
        this.executeDirectionAction(actions[direction]);
    }

    // ═════════════════════════════════════════
    // 模式 3：邪恶迪迦模式
    // ═════════════════════════════════════════

    private onEnterEvilTigaMode(): void {
        if (this.ledController) {
            this.ledController.setColor(LEDColor.RED);
        }
    }

    private shortPressA_EvilTiga(): void {
        if (this._transformState === TransformState.PRE_TRANSFORM) {
            // 双翼已在触摸时展开 + 变身音
            this._transformState = TransformState.POST_TRANSFORM;
            if (this.ledController) this.ledController.setColor(LEDColor.RED);
            this.playSFX('006.邪恶迪迦模式-邪恶迪迦变身音');
        } else {
            this.playSFX('004.邪恶迪迦模式-邪恶迪迦战吼');
        }
    }

    private longPressA_EvilTiga(): void {
        // 邪恶迪迦无形态切换
        console.log('[GameManager] 邪恶迪迦模式无长按切换');
    }

    private handleDirection_EvilTiga(direction: GDirection): void {
        const actions: Record<number, { sfx: string; color: LEDColor }> = {
            [GDirection.LEFT]: { sfx: '003.邪恶迪迦模式-邪恶迪迦完整必杀', color: LEDColor.RED },
            [GDirection.RIGHT]: { sfx: '003.邪恶迪迦模式-邪恶迪迦完整必杀', color: LEDColor.RED },
            [GDirection.FORWARD]: { sfx: '005.邪恶迪迦模式-邪恶迪迦闪灯', color: LEDColor.RED },
            [GDirection.UP]: { sfx: '003.邪恶迪迦模式-邪恶迪迦完整必杀', color: LEDColor.RED },
            [GDirection.PULL_BACK]: { sfx: '013.盖迪死亡', color: LEDColor.RED },
        };
        this.executeDirectionAction(actions[direction]);
    }

    // ═════════════════════════════════════════
    // 模式 4：等身迪迦模式
    // ═════════════════════════════════════════

    private onEnterHumanSizeTigaMode(): void {
        if (this.ledController) {
            this.ledController.setColor(LEDColor.WHITE);
        }
    }

    private shortPressA_HumanSizeTiga(): void {
        // 文档：等身模式短按A：变身音效 → 战吼
        if (this._transformState === TransformState.PRE_TRANSFORM) {
            // 双翼已在触摸时展开 + 变身音
            this._transformState = TransformState.POST_TRANSFORM;
            if (this.ledController) this.ledController.setColor(LEDColor.WHITE);
            this.playSFX('015.迪迦等身模式-等身迪迦变身音');
        } else {
            this.playFormRoar(this._currentForm);
        }
    }

    private longPressA_HumanSizeTiga(): void {
        // 文档：等身模式长按A：循环切换形态（同默认模式）
        this.longPressA_Default();
    }

    private handleDirection_HumanSizeTiga(direction: GDirection): void {
        // 同默认模式
        this.handleDirection_Default(direction);
    }

    // ═════════════════════════════════════════
    // 模式 5：黑暗迪迦模式
    // ═════════════════════════════════════════

    private onEnterDarkTigaMode(): void {
        if (this.ledController) {
            this.ledController.setColor(LEDColor.PURPLE);
        }
    }

    private shortPressA_DarkTiga(): void {
        // 灭灯状态：短按A功能关闭
        if (this._currentDarkForm === DarkTigaForm.DARK_OFF) {
            console.log('[GameManager] 灭灯状态，短按A无效');
            return;
        }

        if (this._transformState === TransformState.PRE_TRANSFORM) {
            // 双翼已在触摸时展开 + 变身音
            this._transformState = TransformState.POST_TRANSFORM;
            this.playSFX('013.大古黑迪变身音');
        } else {
            this.playSFX('008.汤姆叫');
        }
    }

    private longPressA_DarkTiga(): void {
        // 文档：循环切换形态（龙卷型→爆裂型→复合型→灭灯状态→闪耀型）
        const idx = DARK_FORM_CYCLE.indexOf(this._currentDarkForm);
        this._currentDarkForm = DARK_FORM_CYCLE[(idx + 1) % DARK_FORM_CYCLE.length];
        console.log(`[GameManager] 黑暗迪迦形态切换 → ${this._currentDarkForm}`);

        // 形态切换音效
        const formSfx: Record<number, string> = {
            [DarkTigaForm.TORNADO]: '019.黑暗迪迦模式-龙卷型',
            [DarkTigaForm.BLAST]: '020.黑暗迪迦模式-爆裂型',
            [DarkTigaForm.MULTI]: '021.黑暗迪迦模式-复合型',
            [DarkTigaForm.DARK_OFF]: '022.黑暗迪迦模式-战败音',
            [DarkTigaForm.GLITTER]: '023.黑暗迪迦模式-闪耀型',
        };
        this.playSFX(formSfx[this._currentDarkForm]);

        // 形态对应灯珠颜色
        const formColors: Record<number, LEDColor> = {
            [DarkTigaForm.TORNADO]: LEDColor.RED,
            [DarkTigaForm.BLAST]: LEDColor.BLUE,
            [DarkTigaForm.MULTI]: LEDColor.WHITE,
            [DarkTigaForm.DARK_OFF]: LEDColor.WHITE, // 灭灯
            [DarkTigaForm.GLITTER]: LEDColor.YELLOW,
        };

        if (this.ledController) {
            if (this._currentDarkForm === DarkTigaForm.DARK_OFF) {
                this.ledController.turnOff();
            } else {
                this.ledController.setColor(formColors[this._currentDarkForm]);
            }
        }

        this.node.emit(GameEvents.FORM_CHANGE, this._currentDarkForm);
    }

    private handleDirection_DarkTiga(direction: GDirection): void {
        // 灭灯状态：重力感应关闭
        if (this._currentDarkForm === DarkTigaForm.DARK_OFF) {
            console.log('[GameManager] 灭灯状态，重力感应关闭');
            return;
        }

        // 各形态：左/中/上/前皆触发对应必杀，拉回退场
        const formActions: Record<number, { sfx: string; color: LEDColor }> = {
            [DarkTigaForm.TORNADO]: { sfx: '009.黑暗迪迦模式-龙卷型必杀蓄力', color: LEDColor.RED },
            [DarkTigaForm.BLAST]: { sfx: '010.黑暗迪迦模式-爆裂型必杀蓄力', color: LEDColor.BLUE },
            [DarkTigaForm.MULTI]: { sfx: '011.黑暗迪迦模式-复合型必杀蓄力', color: LEDColor.WHITE },
            [DarkTigaForm.GLITTER]: { sfx: '012.黑暗迪迦模式-闪耀型完整必杀', color: LEDColor.YELLOW },
        };

        const action = formActions[this._currentDarkForm];
        if (!action) return;

        // 闪耀型：左/中/上/前/拉回皆触发
        if (this._currentDarkForm === DarkTigaForm.GLITTER) {
            this.executeDirectionAction({ sfx: action.sfx, color: action.color });
            return;
        }

        // 其他形态：左/右/上/前触发，拉回退场
        if (direction === GDirection.PULL_BACK) {
            this.executeDirectionAction({ sfx: '022.黑暗迪迦模式-战败音', color: action.color });
        } else {
            this.executeDirectionAction({ sfx: action.sfx, color: action.color });
        }
    }

    // ═════════════════════════════════════════
    // 模式 6：卡蜜拉模式
    // ═════════════════════════════════════════

    private onEnterCameeraMode(): void {
        if (this.ledController) {
            this.ledController.setColor(LEDColor.WHITE);
        }
    }

    private shortPressA_Cameera(): void {
        if (this._transformState === TransformState.PRE_TRANSFORM) {
            // 双翼已在触摸时展开 + 变身音
            this._transformState = TransformState.POST_TRANSFORM;
            this.playSFX('004.卡密拉变身音效');
        } else {
            this.playSFX('009.卡密拉模式-卡密拉叫声1');
        }
    }

    private longPressA_Cameera(): void {
        // 卡蜜拉模式无长按切换
        console.log('[GameManager] 卡蜜拉模式无长按切换');
    }

    private handleDirection_Cameera(direction: GDirection): void {
        // 文档：左/卡蜜拉台词1(白)、右/卡蜜拉台词2(白)、上/变身迪莫杰厄(白)、前/卡蜜拉鞭击(白)、拉回/迪莫杰厄必杀(白)
        const actions: Record<number, { sfx: string; color: LEDColor }> = {
            [GDirection.LEFT]: { sfx: '009.卡密拉模式-卡密拉叫声1', color: LEDColor.WHITE },
            [GDirection.RIGHT]: { sfx: '006.卡密拉模式-卡密拉叫声2', color: LEDColor.WHITE },
            [GDirection.UP]: { sfx: '016.迪洛杰厄变身音', color: LEDColor.WHITE },
            [GDirection.FORWARD]: { sfx: '002.卡密拉模式-卡密拉挥棒音效', color: LEDColor.WHITE },
            [GDirection.PULL_BACK]: { sfx: '018.迪洛杰厄大招', color: LEDColor.WHITE },
        };
        this.executeDirectionAction(actions[direction]);
    }

    // ═════════════════════════════════════════
    // 通用工具方法
    // ═════════════════════════════════════════

    /** 执行方向动作 */
    private executeDirectionAction(action: { sfx: string; color: LEDColor } | undefined): void {
        if (!action) return;

        // 设置灯珠颜色
        if (this.ledController) {
            this.ledController.flash(action.color, 2, 0.15, 3);
        }

        // 播放音效
        this.playSFX(action.sfx);
    }

    /** 播放音效 */
    private playSFX(name: string, mode?: GameMode, onComplete?: Function): void {
        if (this.audioManager) {
            this.audioManager.playSFX(name, mode, onComplete);
        }
    }

    /** 播放方向音效（变身前） */
    private playDirectionSfx(direction: GDirection): void {
        const sfxMap: Record<number, string> = {
            [GDirection.LEFT]: '002.向左',
            [GDirection.RIGHT]: '003.向右',
            [GDirection.UP]: '005.-举起',
            [GDirection.FORWARD]: '005.-举起',
            [GDirection.PULL_BACK]: '006.拉回神光棒',
        };
        this.playSFX(sfxMap[direction]);
    }

    // ═════════════════════════════════════════
    // 公开接口（外部调用）
    // ═════════════════════════════════════════

    /** 获取当前模式 */
    public get currentMode(): GameMode {
        return this._currentMode;
    }

    /** 获取变身状态 */
    public get transformState(): TransformState {
        return this._transformState;
    }

    /** 获取当前形态 */
    public get currentForm(): TigaForm {
        return this._currentForm;
    }

    /** 重力感应是否启用 */
    public isGSensorEnabled(): boolean {
        return this._gSensorEnabled;
    }
}
