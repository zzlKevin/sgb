import { _decorator, Component, Node, input, Input, EventTouch, Camera, find, PhysicsSystem } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ClickToActivate')
export class ClickToActivate extends Component {
    @property(Node)
    public targetNode: Node = null;           // 主体节点
    @property(Node)
    public leftWingNode: Node = null;         // 左翼节点（带碰撞体）
    @property(Node)
    public rightWingNode: Node = null;        // 右翼节点（带碰撞体）
    @property(Component)
    public wingToggle: any = null;            // WingToggle 组件

    private camera: Camera = null;

    onLoad() {
        this.camera = find('Main Camera')?.getComponent(Camera);
        if (!this.camera) console.warn('未找到 Main Camera');
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    }

    onTouchStart(event: EventTouch) {
        if (!this.camera || !this.targetNode) return;

        const touchPos = event.getLocation();
        const ray = this.camera.screenPointToRay(touchPos.x, touchPos.y);

        // 射线检测
        const hit = PhysicsSystem.instance.raycast(ray);
        if (hit) {
            const results = PhysicsSystem.instance.raycastResults;
            if (results.length > 0) {
                const hitNode = results[0].collider.node;
                // 判断点击到的是主体还是双翼
                if (hitNode === this.targetNode || hitNode.parent === this.targetNode) {
                    console.log('点击主体 → 展开');
                    this.wingToggle.setOpen(true);
                } else if (hitNode === this.leftWingNode || hitNode === this.rightWingNode ||
                        hitNode === this.leftWingNode?.parent || hitNode === this.rightWingNode?.parent) {
                    // 如果点击的是左右翼组的父节点（飞翼组中心），也触发收回
                    console.log('点击双翼 → 合拢');
                    this.wingToggle.setOpen(false);
                }
            }
        }
    }
}