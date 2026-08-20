/**
 * AudioManager.ts
 * 神光棒 TV6 - 音频管理器
 *
 * 基于「神光棒 TV6.txt」第二节 BGM 播放系统
 *
 * 音频加载方式：
 *   - 将 Music 文件夹配置为 Asset Bundle（在 Cocos 编辑器中选中 Music 文件夹 → 属性检查器 → 勾选「配置为 Bundle」）
 *   - 运行时通过 assetManager.loadBundle('Music', ...) 加载
 *   - 加载完成后用 bundle.load() 加载具体音频文件
 */

import { _decorator, Component, AudioSource, AudioClip, assetManager, tween, Node } from 'cc';
import {
    GameMode,
    BGMPlayMode,
    BGM_MODE_VOICE_MAP,
    MODE_BGM_FOLDERS,
    MODE_SFX_FOLDERS,
    GameEvents,
} from './GameModeTypes';

const { ccclass, property } = _decorator;

@ccclass('AudioManager')
export class AudioManager extends Component {

    // ═════════════════════════════════════════
    // 编辑器属性
    // ═════════════════════════════════════════

    /** BGM AudioSource */
    @property(AudioSource)
    public bgmSource: AudioSource = null;

    /** 音效 AudioSource（可多个，做混播） */
    @property([AudioSource])
    public sfxSources: AudioSource[] = [];

    // ═════════════════════════════════════════
    // 内部状态
    // ═════════════════════════════════════════

    /** 当前游戏模式 */
    private _currentMode: GameMode = GameMode.DEFAULT;

    /** BGM 播放模式 */
    private _bgmPlayMode: BGMPlayMode = BGMPlayMode.SINGLE;

    /** 当前播放的 BGM 编号 */
    private _currentBGMTrack: number = 0;

    /** 预约的 BGM 编号 */
    private _reservedBGMTrack: number = 0;

    /** 是否在等待用户说出曲号（播放/预约后的10秒窗口） */
    private _waitingForTrack: boolean = false;

    /** 等待曲号的定时器ID */
    private _waitTimerId: number = 0;

    /** 等待类型：'play' | 'reserve' */
    private _waitType: string = '';

    /** Music bundle 引用 */
    private _musicBundle: any = null;

    /** bundle 是否已加载 */
    private _bundleLoaded: boolean = false;

    /** bundle 加载中的回调队列（防止重复加载） */
    private _pendingCallbacks: ((success: boolean) => void)[] = [];

    // ═════════════════════════════════════════
    // 生命周期
    // ═════════════════════════════════════════

    start() {
        // 预加载 Music bundle
        this.ensureBundleLoaded((success) => {
            if (success) {
                console.log('[AudioManager] Music bundle 加载成功');
            } else {
                console.warn('[AudioManager] Music bundle 加载失败，音效将无法播放');
            }
        });
    }

    // ═════════════════════════════════════════
    // Bundle 加载
    // ═════════════════════════════════════════

    /**
     * 确保 Music bundle 已加载
     * 如果还没加载，自动加载；如果正在加载，排队等待
     */
    private ensureBundleLoaded(callback: (success: boolean) => void): void {
        if (this._bundleLoaded && this._musicBundle) {
            callback(true);
            return;
        }

        // 排队等待
        this._pendingCallbacks.push(callback);

        // 如果已经在加载中，不重复发起
        if (this._pendingCallbacks.length > 1) {
            return;
        }

        console.log('[AudioManager] 开始加载 Music bundle...');

        assetManager.loadBundle('Music', (err, bundle) => {
            if (err || !bundle) {
                console.error('[AudioManager] Music bundle 加载失败:', err);
                // 通知所有等待的回调
                this._pendingCallbacks.forEach(cb => cb(false));
                this._pendingCallbacks = [];
                return;
            }

            this._musicBundle = bundle;
            this._bundleLoaded = true;
            console.log('[AudioManager] Music bundle 加载成功');

            // 通知所有等待的回调
            this._pendingCallbacks.forEach(cb => cb(true));
            this._pendingCallbacks = [];
        });
    }

    // ═════════════════════════════════════════
    // 模式设置
    // ═════════════════════════════════════════

    /** 设置当前模式（由 GameManager 调用） */
    public setMode(mode: GameMode): void {
        this._currentMode = mode;
        // 停止当前 BGM
        this.stopBGM();
    }

    // ═════════════════════════════════════════
    // 音效播放
    // ═════════════════════════════════════════

    /**
     * 播放音效
     * @param name 音效文件名（不含扩展名，如 '001.开机'）
     * @param mode 指定模式（默认用当前模式）
     * @param onComplete 播放完成回调
     */
    public playSFX(name: string, mode?: GameMode, onComplete?: Function): void {
        if (!name) {
            console.warn('[AudioManager] playSFX: name 为空');
            return;
        }

        const useMode = mode ?? this._currentMode;
        this.loadAndPlaySFX(useMode, name, onComplete);
    }

    /**
     * 加载并播放音效
     */
    private loadAndPlaySFX(mode: GameMode, name: string, onComplete?: Function): void {
        this.ensureBundleLoaded((success) => {
            if (!success || !this._musicBundle) {
                console.warn(`[AudioManager] bundle 未加载，无法播放音效: ${name}`);
                return;
            }

            const folder = MODE_SFX_FOLDERS[mode];
            if (!folder) {
                console.warn(`[AudioManager] 模式 ${mode} 无音效文件夹`);
                return;
            }

            // bundle 内路径是相对 Music 文件夹的，去掉 'Music/' 前缀
            const relativeFolder = folder.replace(/^Music\//, '');
            const path = `${relativeFolder}/${name}`;

            this._musicBundle.load(path, AudioClip, (err, clip) => {
                if (err || !clip) {
                    console.warn(`[AudioManager] 音效加载失败: ${path}`, err?.message || '');
                    return;
                }

                const sfxSource = this.getAvailableSFXSource();
                if (sfxSource) {
                    sfxSource.clip = clip;
                    sfxSource.loop = false;
                    sfxSource.play();

                    if (onComplete) {
                        // 等音效播完后回调
                        const duration = clip.getDuration();
                        this.scheduleOnce(() => {
                            onComplete();
                        }, Math.max(duration, 0.1));
                    }
                } else if (onComplete) {
                    onComplete();
                }
            });
        });
    }

    /**
     * 获取可用的音效 AudioSource
     */
    private getAvailableSFXSource(): AudioSource | null {
        if (this.sfxSources && this.sfxSources.length > 0) {
            // 找一个没在播放的
            for (const s of this.sfxSources) {
                if (s && !s.playing) {
                    return s;
                }
            }
            // 都在播放就用第一个
            return this.sfxSources[0];
        }
        return null;
    }

    // ═════════════════════════════════════════
    // BGM 播放系统
    // ═════════════════════════════════════════

    /**
     * 播放 BGM
     * @param track BGM 编号（1~10）
     */
    public playBGM(track: number): void {
        this.ensureBundleLoaded((success) => {
            if (!success || !this._musicBundle) {
                console.warn('[AudioManager] bundle 未加载，无法播放 BGM');
                return;
            }

            const folder = MODE_BGM_FOLDERS[this._currentMode];
            if (!folder) return;

            const relativeFolder = folder.replace(/^Music\//, '');
            const path = `${relativeFolder}/${String(track).padStart(2, '0')}`;

            this._musicBundle.load(path, AudioClip, (err, clip) => {
                if (err || !clip) {
                    console.warn(`[AudioManager] BGM 加载失败: ${path}`);
                    return;
                }

                this._currentBGMTrack = track;
                this.playBGMClip(clip);
            });
        });
    }

    /**
     * 播放 BGM AudioClip
     */
    private playBGMClip(clip: AudioClip): void {
        if (!this.bgmSource || !clip) return;

        this.bgmSource.clip = clip;

        // 根据播放模式设置循环
        switch (this._bgmPlayMode) {
            case BGMPlayMode.SINGLE_LOOP:
                this.bgmSource.loop = true;
                break;
            case BGMPlayMode.LOOP:
            case BGMPlayMode.SINGLE:
            default:
                this.bgmSource.loop = false;
                break;
        }

        this.bgmSource.play();
        console.log(`[AudioManager] BGM 播放: 第${this._currentBGMTrack}首`);
    }

    /** 停止 BGM */
    public stopBGM(): void {
        if (this.bgmSource) {
            this.bgmSource.stop();
        }
    }

    /** 暂停 BGM */
    public pauseBGM(): void {
        if (this.bgmSource) {
            this.bgmSource.pause();
        }
    }

    /** 恢复 BGM */
    public resumeBGM(): void {
        if (this.bgmSource) {
            this.bgmSource.play();
        }
    }

    // ═════════════════════════════════════════
    // 语音 BGM 控制
    // ═════════════════════════════════════════

    /**
     * 语音「播放」指令
     * 如果10秒内说出曲号，播放对应 BGM
     */
    public voicePlay(): void {
        this._waitType = 'play';
        this.startWaitTimer();
        console.log('[AudioManager] 等待曲号（播放）...10秒');
    }

    /**
     * 语音「预约」指令
     * 如果10秒内说出曲号，预载入对应 BGM
     */
    public voiceReserve(): void {
        this._waitType = 'reserve';
        this.startWaitTimer();
        console.log('[AudioManager] 等待曲号（预约）...10秒');
    }

    /**
     * 语音说出曲号
     */
    public voiceTrackNumber(track: number): void {
        if (!this._waitingForTrack) {
            console.log('[AudioManager] 未在等待曲号状态，忽略');
            return;
        }

        this.clearWaitTimer();
        this._waitingForTrack = false;

        if (this._waitType === 'play') {
            this.playBGM(track);
        } else if (this._waitType === 'reserve') {
            this._reservedBGMTrack = track;
            console.log(`[AudioManager] 已预约 BGM: 第${track}首`);
        }

        this._waitType = '';
    }

    /**
     * 设置 BGM 播放模式
     */
    public setBGMPlayMode(mode: BGMPlayMode): void {
        this._bgmPlayMode = mode;
        console.log(`[AudioManager] BGM 播放模式: ${BGM_MODE_VOICE_MAP[mode] || mode}`);

        // 如果正在播放，更新循环设置
        if (this.bgmSource && this.bgmSource.playing) {
            this.bgmSource.loop = (mode === BGMPlayMode.SINGLE_LOOP);
        }
    }

    // ═════════════════════════════════════════
    // 打断控制
    // ═════════════════════════════════════════

    /**
     * 打断所有音频（向下方向触发）
     */
    public interruptAll(): void {
        // 停止 BGM
        this.stopBGM();

        // 停止所有音效
        if (this.sfxSources) {
            for (const s of this.sfxSources) {
                if (s) s.stop();
            }
        }

        console.log('[AudioManager] 打断所有音频');
    }

    // ═════════════════════════════════════════
    // 内部工具
    // ═════════════════════════════════════════

    /**
     * 开始等待曲号的10秒定时器
     */
    private startWaitTimer(): void {
        this.clearWaitTimer();
        this._waitingForTrack = true;

        this._waitTimerId = this.scheduleOnce(() => {
            console.log('[AudioManager] 等待曲号超时，请重新说出"播放"或"预约"');
            this._waitingForTrack = false;
            this._waitType = '';
        }, 10) as any;
    }

    /**
     * 清除等待定时器
     */
    private clearWaitTimer(): void {
        if (this._waitTimerId) {
            this.unscheduleAllCallbacks(this);
            this._waitTimerId = 0;
        }
    }
}
