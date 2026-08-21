/**
 * GSensorController.ts
 * 神光棒 TV6 - 重力感应控制器
 *
 * 基于文档第三节「重力感应动作映射定义」
 * 基准姿态：光棒提至水平线，摆正
 * 6个方向：上、下、左、右、前、拉回
 *
 * 使用 Cocos Creator 的 acceleration API（accelerometer）
 * 在安卓设备上通过 devicemotion 事件获取加速度数据
 */

import { _decorator, Component, sys, input, Input, EventAcceleration, Vec3 } from 'cc';
import { GDirection, DIRECTION_NAMES, GameEvents } from './GameModeTypes';

const { ccclass, property } = _decorator;

@ccclass('GSensorController')
export class GSensorController extends Component {

    // ═════════════════════════════════════════
    // 编辑器属性
    // ═════════════════════════════════════════

    /** 触发方向检测的加速度阈值（m/s² 或 g） */
    @property
    public threshold: number = 0.8;

    /** 触发后的冷却时间（秒），防止连续误触发 */
    @property
    public cooldown: number = 0.6;

    /** 拉回检测阈值（相对静止时间，秒） */
    @property
    public pullBackTime: number = 0.15;

    /** 是否在编辑器中启用模拟（键盘调试用） */
    @property
    public enableDebugKeys: boolean = true;

    // ═════════════════════════════════════════
    // 内部状态
    // ═════════════════════════════════════════

    /** 重力感应是否启用 */
    private _enabled_sensor: boolean = true;

    /** 当前冷却剩余时间 */
    private _cooldownTimer: number = 0;

    /** 基准加速度（水平摆正时的读数） */
    private _baseline: Vec3 = new Vec3(0, 0, 0);

    /** 是否处于校准中 */
    private _calibrating: boolean = false;

    /** 校准计时 */
    private _calibrateTimer: number = 0;

    /** 校准累计读数 */
    private _calibrateSum: Vec3 = new Vec3(0, 0, 0);

    /** 校准采样次数 */
    private _calibrateCount: number = 0;

    /** 拉回动作累计静止时间 */
    private _stillTimer: number = 0;

    /** 拉回检测是否激活（前一个动作后进入待机） */
    private _pullBackReady: boolean = false;

    // ═════════════════════════════════════════
    // 生命周期
    // ═════════════════════════════════════════

    onLoad() {
        // 开启加速度计
        input.setAccelerometerEnabled(true);
        input.setAccelerometerInterval(60); // 60Hz 采样

        input.on(Input.EventType.DEVICEMOTION, this.onAcceleration, this);

        // 开始校准
        this.startCalibration();

        // 调试按键
        if (this.enableDebugKeys && sys.platform === sys.Platform.EDITOR_PAGE) {
            this.setupDebugKeys();
        }
    }

    onDestroy() {
        input.off(Input.EventType.DEVICEMOTION, this.onAcceleration, this);
    }

    update(dt: number) {
        // 冷却倒计时
        if (this._cooldownTimer > 0) {
            this._cooldownTimer -= dt;
            if (this._cooldownTimer < 0) this._cooldownTimer = 0;
        }

        // 校准中
        if (this._calibrating) {
            this._calibrateTimer += dt;
            // 校准 1 秒
            if (this._calibrateTimer >= 1.0) {
                this.finishCalibration();
            }
        }

        // 拉回检测：如果加速度几乎为0且持续时间足够，触发拉回
        if (this._pullBackReady && this._cooldownTimer <= 0) {
            const mag = this._baseline.length();
            const currentMag = this._lastAccel.length();
            if (Math.abs(currentMag - mag) < this.threshold * 0.4) {
                this._stillTimer += dt;
                if (this._stillTimer >= this.pullBackTime) {
                    this.triggerDirection(GDirection.PULL_BACK);
                    this._pullBackReady = false;
                    this._stillTimer = 0;
                }
            } else {
                this._stillTimer = 0;
            }
        }
    }

    // ═════════════════════════════════════════
    // 公开方法
    // ═════════════════════════════════════════

    /** 启用/禁用重力感应 */
    public setEnabled(enabled: boolean): void {
        this._enabled_sensor = enabled;
    }

    /** 重力感应是否启用 */
    public isEnabled(): boolean {
        return this._enabled_sensor;
    }

    /** 最近一次加速度读数（调试面板/外部监测用） */
    public get lastAccel(): Readonly<Vec3> {
        return this._lastAccel;
    }

    /** 基准加速度（校准后的水平姿态读数，调试面板用） */
    public get baseline(): Readonly<Vec3> {
        return this._baseline;
    }

    /** 是否正在校准基准姿态（调试面板用） */
    public get isCalibrating(): boolean {
        return this._calibrating;
    }

    /** 重新校准基准（用户重新摆正姿态时调用） */
    public startCalibration(): void {
        this._calibrating = true;
        this._calibrateTimer = 0;
        this._calibrateSum.set(0, 0, 0);
        this._calibrateCount = 0;
        console.log('[GSensor] 开始校准基准姿态...');
    }

    /**
     * 手动触发方向（外部模拟用）
     * @param direction 方向枚举
     */
    public triggerDirection(direction: GDirection): void {
        if (this._cooldownTimer > 0) return;
        if (!this._enabled_sensor) return;

        this._cooldownTimer = this.cooldown;
        console.log(`[GSensor] 方向触发: ${DIRECTION_NAMES[direction]}`);

        // 触发拉回准备：前/左/右/上 后启用拉回检测
        if ([GDirection.FORWARD, GDirection.LEFT, GDirection.RIGHT, GDirection.UP].includes(direction)) {
            this._pullBackReady = true;
            this._stillTimer = 0;
        } else if (direction === GDirection.PULL_BACK) {
            this._pullBackReady = false;
        }

        // 发送全局事件
        this.node.emit(GameEvents.G_DIRECTION, direction);
    }

    // ═════════════════════════════════════════
    // 加速度数据处理
    // ═════════════════════════════════════════

    private _lastAccel: Vec3 = new Vec3(0, 0, 0);

    private onAcceleration(event: EventAcceleration): void {
        if (!this._enabled_sensor) return;

        const accel = event.acceleration;
        if (!accel) return;

        const x = accel.x;
        const y = accel.y;
        const z = accel.z;
        this._lastAccel.set(x, y, z);

        // 校准中，累计读数
        if (this._calibrating) {
            this._calibrateSum.x += x;
            this._calibrateSum.y += y;
            this._calibrateSum.z += z;
            this._calibrateCount++;
            return;
        }

        // 与基准比较
        const dx = x - this._baseline.x;
        const dy = y - this._baseline.y;
        const dz = z - this._baseline.z;

        // 冷却中不处理方向检测
        if (this._cooldownTimer > 0) return;

        // 判断方向（水平面摆动 vs 垂直面摆动）
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const absDz = Math.abs(dz);

        if (absDx > this.threshold && absDx >= absDy && absDx >= absDz) {
            // 水平左右摆动
            if (dx > 0) {
                this.triggerDirection(GDirection.RIGHT);
            } else {
                this.triggerDirection(GDirection.LEFT);
            }
        } else if (absDy > this.threshold && absDy >= absDx && absDy >= absDz) {
            // 垂直上下摆动
            if (dy > 0) {
                this.triggerDirection(GDirection.UP);
            } else {
                this.triggerDirection(GDirection.DOWN);
            }
        } else if (absDz > this.threshold && absDz >= absDx && absDz >= absDy) {
            // 前后摆动
            if (dz > 0) {
                this.triggerDirection(GDirection.FORWARD);
            }
            // 向后不算独立方向，文档只定义了「拉回」
            // 拉回由 update 中的静止检测实现
        }
    }

    /** 完成校准 */
    private finishCalibration(): void {
        if (this._calibrateCount > 0) {
            this._baseline.x = this._calibrateSum.x / this._calibrateCount;
            this._baseline.y = this._calibrateSum.y / this._calibrateCount;
            this._baseline.z = this._calibrateSum.z / this._calibrateCount;
            console.log(`[GSensor] 校准完成，基准: (${this._baseline.x.toFixed(2)}, ${this._baseline.y.toFixed(2)}, ${this._baseline.z.toFixed(2)})`);
        }
        this._calibrating = false;
    }

    // ═════════════════════════════════════════
    // 调试：键盘模拟（编辑器内）
    // ═════════════════════════════════════════

    private setupDebugKeys(): void {
        if (sys.platform !== sys.Platform.EDITOR_PAGE) return;

        input.on(Input.EventType.KEY_DOWN, (event: any) => {
            if (!event || event.keyCode === undefined) return;
            switch (event.keyCode) {
                case 37: // ←
                case 65: // A
                    this.triggerDirection(GDirection.LEFT);
                    break;
                case 39: // →
                case 68: // D
                    this.triggerDirection(GDirection.RIGHT);
                    break;
                case 38: // ↑
                case 87: // W
                    this.triggerDirection(GDirection.UP);
                    break;
                case 40: // ↓
                case 83: // S
                    this.triggerDirection(GDirection.DOWN);
                    break;
                case 70: // F
                    this.triggerDirection(GDirection.FORWARD);
                    break;
                case 66: // B
                    this.triggerDirection(GDirection.PULL_BACK);
                    break;
            }
        }, this);
    }
}
