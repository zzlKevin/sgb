/**
 * LEDController.ts
 * 神光棒 TV6 - LED 双灯珠控制器
 *
 * 支持13种颜色切换（白、黄、蓝、红、绿、紫、橙、青、粉、棕、蓝白、黄白、紫白）
 * 支持闪烁/渐变效果，双灯珠同步控制
 *
 * 使用方式：
 *   1. 将此脚本挂到灯珠节点上（或任意管理节点）
 *   2. 在编辑器中指定两个灯珠的 MeshRenderer（带发光材质）
 *   3. 调用 setColor() / flash() / breathe() 等方法
 */

import { _decorator, Component, MeshRenderer, Material, Color, tween, Vec3 } from 'cc';
import { LEDColor, LED_COLOR_VALUES, LED_COLOR_NAMES, GameEvents } from './GameModeTypes';

const { ccclass, property } = _decorator;

@ccclass('LEDController')
export class LEDController extends Component {

    // ═════════════════════════════════════════
    // 编辑器属性
    // ═════════════════════════════════════════

    /** 灯珠1 MeshRenderer（主灯珠） */
    @property(MeshRenderer)
    public ledRenderer1: MeshRenderer = null;

    /** 灯珠2 MeshRenderer（副灯珠） */
    @property(MeshRenderer)
    public ledRenderer2: MeshRenderer = null;

    /** 闪烁时灯灭的亮度倍率 */
    @property
    public offIntensity: number = 0.0;

    /** 闪烁时灯亮的亮度倍率 */
    @property
    public onIntensity: number = 3.0;

    /** 默认亮度倍率（ setColor 时使用） */
    @property
    public defaultIntensity: number = 2.0;

    /**
     * 发光倍率（emissiveScale 的基础值）
     * 越大越有过曝的"灯泡感"。配合场景 Bloom 后处理会产生光晕。
     * 纯色（如红255,0,0）× 高倍率 → 亮红光而非白光，颜色不会丢失。
     */
    @property({ tooltip: '发光倍率，越大越亮，配合Bloom有光晕。默认20' })
    public emissiveBoost: number = 20.0;

    // ═════════════════════════════════════════
    // 内部状态
    // ═════════════════════════════════════════

    private _currentColor: LEDColor = LEDColor.WHITE;
    private _currentIntensity: number = 2.0;
    private _flashTween: any = null;
    private _breatheTween: any = null;

    /** 已修复过 USE_EMISSIVE_MAP 问题的材质集合（避免重复 recompile） */
    private _fixedMaterials: Set<any> = new Set();

    // ═════════════════════════════════════════
    // 生命周期
    // ═════════════════════════════════════════

    /**
     * 使用 start 而非 onLoad，确保 GameManager 在 onLoad 中设置完 ledRenderer 后才初始化颜色。
     * 如果 ledRenderer 尚未就绪，延迟到首次 setColor 时应用。
     */
    start() {
        // 初始化为白色（如果 ledRenderer 已就绪）
        this._applyColor(LEDColor.WHITE, this.defaultIntensity);
    }

    // ═════════════════════════════════════════
    // 颜色控制
    // ═════════════════════════════════════════

    /**
     * 设置灯珠颜色
     * @param color LEDColor 枚举值
     * @param intensity 亮度倍率（可选，默认 defaultIntensity）
     */
    public setColor(color: LEDColor, intensity?: number): void {
        this._stopEffects();
        this._currentColor = color;
        this._currentIntensity = intensity ?? this.defaultIntensity;
        this._applyColor(color, this._currentIntensity);
    }

    /** 获取当前颜色 */
    public get currentColor(): LEDColor {
        return this._currentColor;
    }

    /** 获取当前颜色名称 */
    public get currentColorName(): string {
        return LED_COLOR_NAMES[this._currentColor] || '未知';
    }

    /**
     * 按颜色名称设置（语音指令调用）
     * @param name 如 "白光"、"红光" 等
     * @returns 是否设置成功
     */
    public setColorByName(name: string): boolean {
        const colorMap: Record<string, LEDColor> = {
            '白光': LEDColor.WHITE,
            '黄光': LEDColor.YELLOW,
            '蓝光': LEDColor.BLUE,
            '红光': LEDColor.RED,
            '绿光': LEDColor.GREEN,
            '紫光': LEDColor.PURPLE,
            '橙光': LEDColor.ORANGE,
            '青光': LEDColor.CYAN,
            '粉光': LEDColor.PINK,
            '棕光': LEDColor.BROWN,
            '蓝白光': LEDColor.BLUE_WHITE,
            '黄白光': LEDColor.YELLOW_WHITE,
            '紫白光': LEDColor.PURPLE_WHITE,
        };
        if (colorMap[name] !== undefined) {
            this.setColor(colorMap[name]);
            return true;
        }
        return false;
    }

    /** 关闭灯珠 */
    public turnOff(): void {
        this._stopEffects();
        this._currentIntensity = this.offIntensity;
        this._applyColor(this._currentColor, this.offIntensity);
    }

    // ═════════════════════════════════════════
    // 灯效
    // ═════════════════════════════════════════

    /**
     * 闪烁效果
     * @param color 灯珠颜色
     * @param duration 持续时间（秒），到时自动停止
     * @param interval 闪烁间隔（秒）
     * @param times 闪烁次数（0=持续到duration结束）
     */
    public flash(color: LEDColor, duration: number = 10, interval: number = 0.3, times: number = 0): void {
        this._stopEffects();
        this._currentColor = color;

        let count = 0;
        let isOn = false;

        const tick = () => {
            isOn = !isOn;
            this._applyColor(color, isOn ? this.onIntensity : this.offIntensity);
            count++;

            // 到达指定次数时停止
            if (times > 0 && count >= times * 2) {
                this._applyColor(color, this.defaultIntensity);
                return;
            }
        };

        // 使用 tween 实现定时闪烁
        this._flashTween = tween(this.node)
            .call(tick)
            .delay(interval)
            .union()
            .repeatForever()
            .start();

        // duration 后自动停止
        if (duration > 0) {
            tween(this.node)
                .delay(duration)
                .call(() => {
                    this.stopFlash();
                    this._applyColor(color, this.defaultIntensity);
                })
                .start();
        }
    }

    /** 停止闪烁 */
    public stopFlash(): void {
        if (this._flashTween) {
            this._flashTween.stop();
            this._flashTween = null;
        }
    }

    /**
     * 呼吸灯效果（渐亮渐灭）
     * @param color 灯珠颜色
     * @param duration 持续时间（秒）
     * @param cycle 呼吸周期（秒，从暗到亮再到暗）
     */
    public breathe(color: LEDColor, duration: number = 3, cycle: number = 2): void {
        this._stopEffects();
        this._currentColor = color;

        const halfCycle = cycle * 0.5;

        const breatheAction = () => {
            this._applyColor(color, this.offIntensity);
            tween(this.node)
                .to(halfCycle, {}, {
                    onUpdate: () => {
                        // 渐亮
                    },
                    onProgress: (t: number) => {
                        const intensity = this.offIntensity + (this.onIntensity - this.offIntensity) * t;
                        this._applyColor(color, intensity);
                    }
                })
                .to(halfCycle, {}, {
                    onProgress: (t: number) => {
                        const intensity = this.onIntensity - (this.onIntensity - this.offIntensity) * t;
                        this._applyColor(color, intensity);
                    }
                })
                .start();
        };

        breatheAction();
        this._breatheTween = tween(this.node)
            .delay(cycle)
            .call(breatheAction)
            .union()
            .repeatForever()
            .start();

        if (duration > 0) {
            tween(this.node)
                .delay(duration)
                .call(() => {
                    this.stopBreathe();
                    this._applyColor(color, this.defaultIntensity);
                })
                .start();
        }
    }

    /** 停止呼吸灯 */
    public stopBreathe(): void {
        if (this._breatheTween) {
            this._breatheTween.stop();
            this._breatheTween = null;
        }
    }

    /** 停止所有特效 */
    public stopAllEffects(): void {
        this._stopEffects();
    }

    // ═════════════════════════════════════════
    // 内部方法
    // ═════════════════════════════════════════

    private _stopEffects(): void {
        this.stopFlash();
        this.stopBreathe();
    }

    /**
     * 将颜色应用到灯珠材质
     *
     * CrystalMat 的问题：材质开启了 USE_EMISSIVE_MAP 宏但没绑定贴图，
     * 未绑定的贴图采样结果为黑色 → emissive × 黑色 = 0，自发光永远不显示，
     * 灯珠呈现的白色其实是 mainColor（漫反射）+ 高光。
     *
     * 修复：运行时关闭 USE_EMISSIVE_MAP 宏（emissive 颜色直接生效），
     * 同时设置 mainColor 让漫反射部分也染色，双保险。
     */
    private _applyColor(color: LEDColor, intensity: number): void {
        const c = LED_COLOR_VALUES[color];
        if (!c) return;

        const renderers: MeshRenderer[] = [];
        if (this.ledRenderer1) renderers.push(this.ledRenderer1);
        if (this.ledRenderer2) renderers.push(this.ledRenderer2);

        if (renderers.length === 0) {
            return;
        }

        // 颜色值 0-255
        const r = Math.min(c.r * 255, 255);
        const g = Math.min(c.g * 255, 255);
        const b = Math.min(c.b * 255, 255);

        // 发光倍率：emissiveBoost × intensity 联动
        // 高倍率 HDR 过曝产生"灯泡感"，纯色 × 高倍率依然是纯色调（红×50=亮红）
        const scale = this.emissiveBoost * intensity;

        console.log(`[LEDController] setColor → ${LED_COLOR_NAMES[color]} (r=${r.toFixed(0)},g=${g.toFixed(0)},b=${b.toFixed(0)},scale=${scale})`);

        for (let i = 0; i < renderers.length; i++) {
            const renderer = renderers[i];
            const mat = renderer.getSharedMaterial(0);
            if (!mat) {
                console.warn(`[LEDController] renderer[${i}] "${renderer.node.name}" 没有材质`);
                continue;
            }

            // ── 关键修复：关闭未绑定贴图的 USE_EMISSIVE_MAP 宏 ──
            if (!this._fixedMaterials.has(mat)) {
                try {
                    mat.recompileShaders({ USE_EMISSIVE_MAP: false });
                    console.log(`[LEDController] 已关闭 "${renderer.node.name}" 材质的 USE_EMISSIVE_MAP 宏`);
                } catch (e) {
                    console.warn(`[LEDController] recompileShaders 失败（可能宏不存在，忽略）`, e);
                }
                this._fixedMaterials.add(mat);
            }

            // 设置 emissive 自发光颜色
            try {
                mat.setProperty('emissive', new Color(r, g, b, 255));
            } catch (e) {
                console.warn(`[LEDController] 设置 emissive 失败`, e);
            }

            // 设置 emissiveScale 亮度倍率
            try {
                mat.setProperty('emissiveScale', new Vec3(scale, scale, scale));
            } catch (e2) {
                // emissiveScale 不存在则忽略
            }

            // 同时设置 mainColor，让漫反射体也染色（双保险）
            try {
                mat.setProperty('mainColor', new Color(r, g, b, 255));
            } catch (e3) {
                // mainColor 不存在则忽略
            }
        }
    }
}
