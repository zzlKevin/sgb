/**
 * VoiceCommandManager.ts
 * 神光棒 TV6 - 语音指令解析与分发
 *
 * 基于「神光棒 TV6.txt」第二节「语音交互（声控系统）」
 *
 * 功能：
 *   - 监听 AndroidVoiceBridge 的识别结果
 *   - 解析语音文本，匹配指令
 *   - 分发到对应的子系统（模式切换/BGM/灯光/重力感应/声控开关）
 *
 * 指令列表：
 *   模式切换：迪迦 / 由我来守护 / 我缺的 / 等身模式 / 黑暗迪迦 / 卡蜜拉
 *   退出模式：再见奥特曼
 *   声控开关：开启声控 / 关闭声控
 *   重力感应开关：开启感应 / 关闭感应
 *   BGM控制：播放 / 预约 / 第N首 / 循环播放 / 单曲循环 / 单曲播放
 *   灯光控制：白光 / 黄光 / 蓝光 / ...（13种颜色）
 *   方向模拟（调试）：左 / 右 / 上 / 下 / 前 / 拉回
 */

import { _decorator, Component, Node } from 'cc';
import {
    GameMode,
    MODE_VOICE_TRIGGERS,
    VOICE_COLOR_MAP,
    BGM_MODE_VOICE_MAP,
    GDirection,
    GameEvents,
} from './GameModeTypes';

const { ccclass, property } = _decorator;

@ccclass('VoiceCommandManager')
export class VoiceCommandManager extends Component {

    // ═════════════════════════════════════════
    // 编辑器属性
    // ═════════════════════════════════════════

    /** AndroidVoiceBridge 所在节点 */
    @property(Node)
    public voiceBridgeNode: Node = null;

    /** GameManager 所在节点（用于调用模式切换） */
    @property(Node)
    public gameManagerNode: Node = null;

    // ═════════════════════════════════════════
    // 内部状态
    // ═════════════════════════════════════════

    /** 声控是否开启 */
    private _voiceEnabled: boolean = true;

    /** 当前模式（用于判断退出指令和同名唤醒） */
    private _currentMode: GameMode = GameMode.DEFAULT;

    /** 模式名称（用于判断同名唤醒无效） */
    private _modeVoiceNames: Record<number, string[]> = MODE_VOICE_TRIGGERS;

    // ═════════════════════════════════════════
    // 生命周期
    // ═════════════════════════════════════════

    onLoad() {
        // 延迟到 start 中绑定，确保 voiceBridgeNode 已被 GameManager 设置
    }

    start() {
        if (this.voiceBridgeNode) {
            this.voiceBridgeNode.on('onVoiceResult', this.onVoiceResult, this);
            this.voiceBridgeNode.on('onVoiceError', this.onVoiceError, this);
        } else {
            console.warn('[VoiceCmd] voiceBridgeNode 未设置');
        }
    }

    onDestroy() {
        if (this.voiceBridgeNode) {
            this.voiceBridgeNode.off('onVoiceResult', this.onVoiceResult, this);
            this.voiceBridgeNode.off('onVoiceError', this.onVoiceError, this);
        }
    }

    // ═════════════════════════════════════════
    // 语音结果处理
    // ═════════════════════════════════════════

    private onVoiceResult(result: { text: string; confidence: number; isFinal: boolean }): void {
        if (!this._voiceEnabled) {
            // 声控关闭后，仅响应「开启声控」指令
            if (result.text.includes('开启声控')) {
                this._voiceEnabled = true;
                console.log('[VoiceCmd] 声控已开启');
                this.node.emit(GameEvents.VOICE_CONTROL_TOGGLE, true);
            }
            return;
        }

        const text = result.text.trim();
        console.log(`[VoiceCmd] 解析: "${text}"`);

        // 1. 检查退出指令
        if (this.checkExitCommand(text)) return;

        // 2. 检查声控开关
        if (this.checkVoiceToggle(text)) return;

        // 3. 检查重力感应开关
        if (this.checkGSensorToggle(text)) return;

        // 4. 检查模式切换
        if (this.checkModeSwitch(text)) return;

        // 5. 检查 BGM 控制
        if (this.checkBGMControl(text)) return;

        // 6. 检查灯光控制
        if (this.checkLightControl(text)) return;

        // 7. 调试：方向模拟
        if (this.checkDebugDirection(text)) return;

        console.log(`[VoiceCmd] 未匹配指令: "${text}"`);
    }

    private onVoiceError(errorCode: number): void {
        console.warn(`[VoiceCmd] 语音识别错误: ${errorCode}`);
    }

    // ═════════════════════════════════════════
    // 指令匹配
    // ═════════════════════════════════════════

    /**
     * 检查退出指令：「再见奥特曼」
     * 文档：在任何非默认模式下，说出"再见奥特曼"退出当前模式
     * 注意：在当前模式下用该模式名称语音唤醒无效
     */
    private checkExitCommand(text: string): boolean {
        if (text.includes('再见奥特曼') || text.includes('再见 奥特曼')) {
            if (this._currentMode !== GameMode.DEFAULT) {
                console.log('[VoiceCmd] 退出当前模式');
                this.node.emit(GameEvents.MODE_CHANGE, GameMode.DEFAULT);
                return true;
            }
        }
        return false;
    }

    /**
     * 检查声控开关
     * 「开启声控」/「关闭声控」
     */
    private checkVoiceToggle(text: string): boolean {
        if (text.includes('关闭声控')) {
            this._voiceEnabled = false;
            console.log('[VoiceCmd] 声控已关闭');
            this.node.emit(GameEvents.VOICE_CONTROL_TOGGLE, false);
            return true;
        }
        if (text.includes('开启声控')) {
            this._voiceEnabled = true;
            console.log('[VoiceCmd] 声控已开启');
            this.node.emit(GameEvents.VOICE_CONTROL_TOGGLE, true);
            return true;
        }
        return false;
    }

    /**
     * 检查重力感应开关
     * 「开启感应」/「关闭感应」
     */
    private checkGSensorToggle(text: string): boolean {
        if (text.includes('开启感应')) {
            console.log('[VoiceCmd] 重力感应已开启');
            this.node.emit(GameEvents.GSENSOR_TOGGLE, true);
            return true;
        }
        if (text.includes('关闭感应')) {
            console.log('[VoiceCmd] 重力感应已关闭');
            this.node.emit(GameEvents.GSENSOR_TOGGLE, false);
            return true;
        }
        return false;
    }

    /**
     * 检查模式切换
     * 文档注意：在当前模式下用该模式名称语音唤醒无效（如"卡蜜拉"模式下喊"卡蜜拉"无反应）
     */
    private checkModeSwitch(text: string): boolean {
        for (const modeStr of Object.keys(this._modeVoiceNames)) {
            const mode = parseInt(modeStr);
            const triggers = this._modeVoiceNames[mode];

            for (const trigger of triggers) {
                if (text.includes(trigger)) {
                    // 检查是否在当前模式（同名唤醒无效）
                    if (mode === this._currentMode) {
                        console.log(`[VoiceCmd] 当前已在 ${trigger} 模式，唤醒无效`);
                        return true;
                    }

                    console.log(`[VoiceCmd] 模式切换 → ${trigger} (mode=${mode})`);
                    this._currentMode = mode;
                    this.node.emit(GameEvents.MODE_CHANGE, mode);
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 检查 BGM 控制
     * 「播放」「预约」「第N首」「循环播放」「单曲循环」「单曲播放」
     */
    private checkBGMControl(text: string): boolean {
        // BGM 播放模式
        for (const [key, mode] of Object.entries(BGM_MODE_VOICE_MAP)) {
            if (text.includes(key)) {
                console.log(`[VoiceCmd] BGM 模式: ${key}`);
                this.node.emit('onBGMModeChange', mode);
                return true;
            }
        }

        // 播放/预约 + 第N首
        const trackMatch = text.match(/第(\d+)首/);
        if (trackMatch) {
            const track = parseInt(trackMatch[1]);
            if (text.includes('预约')) {
                console.log(`[VoiceCmd] 预约第${track}首`);
                this.node.emit('onBGMReserve', track);
            } else if (text.includes('播放')) {
                console.log(`[VoiceCmd] 播放第${track}首`);
                this.node.emit('onBGMPlay', track);
            } else {
                // 只有数字，可能是播放/预约后的补充指令
                console.log(`[VoiceCmd] 选择第${track}首`);
                this.node.emit('onBGMTrack', track);
            }
            return true;
        }

        // 单独的「播放」或「预约」
        if (text.includes('播放')) {
            console.log('[VoiceCmd] BGM 播放（等待轨道号）');
            this.node.emit('onBGMPlay', 0); // 0 表示等待轨道号
            return true;
        }
        if (text.includes('预约')) {
            console.log('[VoiceCmd] BGM 预约（等待轨道号）');
            this.node.emit('onBGMReserve', 0);
            return true;
        }

        return false;
    }

    /**
     * 检查灯光控制
     * 「白光」「黄光」「蓝光」...（13种颜色）
     */
    private checkLightControl(text: string): boolean {
        for (const [colorName, color] of Object.entries(VOICE_COLOR_MAP)) {
            if (text.includes(colorName)) {
                console.log(`[VoiceCmd] 灯光: ${colorName}`);
                this.node.emit(GameEvents.LED_COLOR_CHANGE, color);
                return true;
            }
        }
        return false;
    }

    /**
     * 调试：方向模拟
     * 语音「左」「右」「上」「下」「前」「拉回」
     */
    private checkDebugDirection(text: string): boolean {
        const dirMap: Record<string, GDirection> = {
            '左': GDirection.LEFT,
            '右': GDirection.RIGHT,
            '上': GDirection.UP,
            '下': GDirection.DOWN,
            '前': GDirection.FORWARD,
            '拉回': GDirection.PULL_BACK,
        };

        for (const [key, dir] of Object.entries(dirMap)) {
            if (text === key || text.includes(key)) {
                console.log(`[VoiceCmd] 调试方向: ${key}`);
                this.node.emit(GameEvents.G_DIRECTION, dir);
                return true;
            }
        }
        return false;
    }

    // ═════════════════════════════════════════
    // 公开方法
    // ═════════════════════════════════════════

    /** 设置当前模式（由 GameManager 调用） */
    public setCurrentMode(mode: GameMode): void {
        this._currentMode = mode;
    }

    /** 声控是否开启 */
    public isVoiceEnabled(): boolean {
        return this._voiceEnabled;
    }
}
