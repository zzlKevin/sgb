import { _decorator, Component, Node, tween, Vec3 , easing} from 'cc';
const { ccclass, property } = _decorator;

@ccclass('WingToggle')
export class WingToggle extends Component {
    @property
    public openDuration: number = 0.20;          // 展开动画时长（秒）
    @property
    public closeDuration: number = 0.4;          // 合拢动画时长（秒）
    @property
    public overshoot: number = 2.5;              // 回弹幅度（默认 1.70158，2.5 弹力更强）
    // 引用左右翼的轴心节点（即你调好轴心的 LeftWingPivot 和 RightWingPivot）
    @property(Node)
    public leftWingPivot: Node = null;
    @property(Node)
    public rightWingPivot: Node = null;

    // 角度配置（度）
    @property
    public leftCloseAngle: number = -23.47;   // 左翼闭合时的 Z 旋转
    @property
    public rightCloseAngle: number = 23.47;   // 右翼闭合时的 Z 旋转
    @property
    public openAngle: number = 0;             // 展开时的 Z 旋转（两侧都为 0）

    @property
    public duration: number = 0.5;            // 动画过渡时间（秒）

    private isOpen: boolean = false;

    // 切换开合（供按钮/语音/重力感应调用）
    public toggle() {
        this.isOpen = !this.isOpen;
        this.applyWingState(this.isOpen);
    }

    // 直接设置开合状态（供外部调用）
    public setOpen(open: boolean) {
        if (this.isOpen === open) return;
        this.isOpen = open;
        this.applyWingState(open);
    }

    private applyWingState(open: boolean) {
        const leftAngle = open ? this.openAngle : this.leftCloseAngle;
        const rightAngle = open ? this.openAngle : this.rightCloseAngle;

        if (open) {
            // 展开：使用自定义弹性回弹
            this.playWingOpenWithBounce(leftAngle, rightAngle);
        } else {
            // 合拢：直接线性过渡
            tween(this.leftWingPivot)
                .to(this.closeDuration, { eulerAngles: new Vec3(0, 0, leftAngle) }, { easing: easing.linear })
                .start();
            tween(this.rightWingPivot)
                .to(this.closeDuration, { eulerAngles: new Vec3(0, 0, rightAngle) }, { easing: easing.linear })
                .start();
        }
    }

    private playWingOpenWithBounce(targetLeft: number, targetRight: number) {
        // 先快速弹开到目标角度（稍微过头一点）
        const overshoot = 10; // 过冲角度，数值越大弹力越强
        const duration = 0.06; // 弹开速度，数值越小弹开越快

        // 左翼：先弹开到 targetLeft - overshoot（过头），再回弹到 targetLeft
        tween(this.leftWingPivot)
            .to(duration, { eulerAngles: new Vec3(0, 0, targetLeft - overshoot) }, { easing: easing.linear })
            .to(duration * 0.6, { eulerAngles: new Vec3(0, 0, targetLeft + overshoot * 0.4) }, { easing: easing.linear })
            .to(duration * 0.4, { eulerAngles: new Vec3(0, 0, targetLeft) }, { easing: easing.linear })
            .start();

        // 右翼：同理，方向相反
        tween(this.rightWingPivot)
            .to(duration, { eulerAngles: new Vec3(0, 0, targetRight + overshoot) }, { easing: easing.linear })
            .to(duration * 0.6, { eulerAngles: new Vec3(0, 0, targetRight - overshoot * 0.4) }, { easing: easing.linear })
            .to(duration * 0.4, { eulerAngles: new Vec3(0, 0, targetRight) }, { easing: easing.linear })
            .start();
    }
}