/**
 * GameModeTypes.ts
 * 神光棒 TV6 - 全局枚举与常量定义
 *
 * 基于「神光棒 TV6.txt」编程文档
 */

// ═════════════════════════════════════════
// 模式枚举（对应文档中的模式 0~6）
// ═════════════════════════════════════════
export enum GameMode {
    /** 模式0：默认复合模式（开机默认） */
    DEFAULT = 0,
    /** 模式1：闪耀迪迦模式 */
    SHINING_TIGA = 1,
    /** 模式2：超奥特B兄弟模式 */
    ULTRA_BROTHERS = 2,
    /** 模式3：邪恶迪迦模式 */
    EVIL_TIGA = 3,
    /** 模式4：等身迪迦模式 */
    HUMAN_SIZE_TIGA = 4,
    /** 模式5：黑暗迪迦模式 */
    DARK_TIGA = 5,
    /** 模式6：卡蜜拉模式 */
    CAMEERA = 6,
}

/** 模式对应的语音唤醒词 */
export const MODE_VOICE_TRIGGERS: Record<number, string[]> = {
    [GameMode.DEFAULT]: [], // 默认模式，开机进入
    [GameMode.SHINING_TIGA]: ['迪迦'],
    [GameMode.ULTRA_BROTHERS]: ['由我来守护'],
    [GameMode.EVIL_TIGA]: ['我缺的', '就是这个'],
    [GameMode.HUMAN_SIZE_TIGA]: ['等身模式'],
    [GameMode.DARK_TIGA]: ['黑暗迪迦'],
    [GameMode.CAMEERA]: ['卡蜜拉'],
};

/** 模式名称（用于日志/UI显示） */
export const MODE_NAMES: Record<number, string> = {
    [GameMode.DEFAULT]: '默认复合模式',
    [GameMode.SHINING_TIGA]: '闪耀迪迦模式',
    [GameMode.ULTRA_BROTHERS]: '超奥特B兄弟模式',
    [GameMode.EVIL_TIGA]: '邪恶迪迦模式',
    [GameMode.HUMAN_SIZE_TIGA]: '等身迪迦模式',
    [GameMode.DARK_TIGA]: '黑暗迪迦模式',
    [GameMode.CAMEERA]: '卡蜜拉模式',
};

// ═════════════════════════════════════════
// 形态枚举（默认模式/等身模式/黑暗模式共用）
// ═════════════════════════════════════════
export enum TigaForm {
    /** 复合型（默认模式默认形态） */
    MULTI = 0,
    /** 强力型 */
    POWER = 1,
    /** 空中型 */
    SKY = 2,
}

/** 黑暗迪迦模式形态（文档模式5） */
export enum DarkTigaForm {
    /** 龙卷型 */
    TORNADO = 0,
    /** 爆裂型 */
    BLAST = 1,
    /** 复合型 */
    MULTI = 2,
    /** 灭灯状态 */
    DARK_OFF = 3,
    /** 闪耀型 */
    GLITTER = 4,
}

/** 默认模式/等身模式形态切换顺序 */
export const DEFAULT_FORM_CYCLE: TigaForm[] = [
    TigaForm.MULTI,
    TigaForm.POWER,
    TigaForm.SKY,
];

/** 黑暗迪迦模式形态切换顺序 */
export const DARK_FORM_CYCLE: DarkTigaForm[] = [
    DarkTigaForm.TORNADO,
    DarkTigaForm.BLAST,
    DarkTigaForm.MULTI,
    DarkTigaForm.DARK_OFF,
    DarkTigaForm.GLITTER,
];

// ═════════════════════════════════════════
// 重力感应方向（文档第三节）
// ═════════════════════════════════════════
export enum GDirection {
    /** 向左：水平线向左摆动 */
    LEFT = 0,
    /** 向右：水平线向右摆动 */
    RIGHT = 1,
    /** 向前：向前推 */
    FORWARD = 2,
    /** 拉回：沿圆心水平拉回 */
    PULL_BACK = 3,
    /** 向上：垂直向上摆动 */
    UP = 4,
    /** 向下：垂直向下摆动（通常用于重置/打断） */
    DOWN = 5,
}

/** 方向名称 */
export const DIRECTION_NAMES: Record<number, string> = {
    [GDirection.LEFT]: '向左',
    [GDirection.RIGHT]: '向右',
    [GDirection.FORWARD]: '向前',
    [GDirection.PULL_BACK]: '拉回',
    [GDirection.UP]: '向上',
    [GDirection.DOWN]: '向下',
};

// ═════════════════════════════════════════
// LED灯珠颜色（文档第一节：13种颜色）
// ═════════════════════════════════════════
export enum LEDColor {
    WHITE = 0,
    YELLOW = 1,
    BLUE = 2,
    RED = 3,
    GREEN = 4,
    PURPLE = 5,
    ORANGE = 6,
    CYAN = 7,
    PINK = 8,
    BROWN = 9,
    BLUE_WHITE = 10,
    YELLOW_WHITE = 11,
    PURPLE_WHITE = 12,
}

/** 颜色对应的标准 Color 值（r,g,b 0~1） */
export const LED_COLOR_VALUES: Record<number, { r: number; g: number; b: number; a: number }> = {
    [LEDColor.WHITE]:       { r: 1.0,  g: 1.0,  b: 1.0,  a: 1.0 },
    [LEDColor.YELLOW]:      { r: 1.0,  g: 0.85, b: 0.0,  a: 1.0 },
    [LEDColor.BLUE]:        { r: 0.0,  g: 0.3,  b: 1.0,  a: 1.0 },
    [LEDColor.RED]:         { r: 1.0,  g: 0.0,  b: 0.0,  a: 1.0 },
    [LEDColor.GREEN]:       { r: 0.0,  g: 1.0,  b: 0.2,  a: 1.0 },
    [LEDColor.PURPLE]:      { r: 0.6,  g: 0.0,  b: 0.8,  a: 1.0 },
    [LEDColor.ORANGE]:      { r: 1.0,  g: 0.5,  b: 0.0,  a: 1.0 },
    [LEDColor.CYAN]:        { r: 0.0,  g: 0.9,  b: 1.0,  a: 1.0 },
    [LEDColor.PINK]:        { r: 1.0,  g: 0.4,  b: 0.7,  a: 1.0 },
    [LEDColor.BROWN]:       { r: 0.5,  g: 0.25, b: 0.0,  a: 1.0 },
    [LEDColor.BLUE_WHITE]:  { r: 0.7,  g: 0.9,  b: 1.0,  a: 1.0 },
    [LEDColor.YELLOW_WHITE]:{ r: 1.0,  g: 0.95, b: 0.7,  a: 1.0 },
    [LEDColor.PURPLE_WHITE]:{ r: 0.8,  g: 0.7,  b: 1.0,  a: 1.0 },
};

/** 颜色中文名 */
export const LED_COLOR_NAMES: Record<number, string> = {
    [LEDColor.WHITE]: '白光',
    [LEDColor.YELLOW]: '黄光',
    [LEDColor.BLUE]: '蓝光',
    [LEDColor.RED]: '红光',
    [LEDColor.GREEN]: '绿光',
    [LEDColor.PURPLE]: '紫光',
    [LEDColor.ORANGE]: '橙光',
    [LEDColor.CYAN]: '青光',
    [LEDColor.PINK]: '粉光',
    [LEDColor.BROWN]: '棕光',
    [LEDColor.BLUE_WHITE]: '蓝白光',
    [LEDColor.YELLOW_WHITE]: '黄白光',
    [LEDColor.PURPLE_WHITE]: '紫白光',
};

/** 灯光控制指令 → 颜色映射（短按B键或语音） */
export const VOICE_COLOR_MAP: Record<string, LEDColor> = {
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

// ═════════════════════════════════════════
// BGM播放模式
// ═════════════════════════════════════════
export enum BGMPlayMode {
    /** 单曲播放（默认）：当前歌曲播完即暂停 */
    SINGLE = 0,
    /** 循环播放：当前歌曲结束后接着播放下一首 */
    SEQUENTIAL = 1,
    /** 单曲循环：当前歌曲循环播放 */
    SINGLE_LOOP = 2,
}

/** BGM播放模式语音指令映射 */
export const BGM_MODE_VOICE_MAP: Record<string, BGMPlayMode> = {
    '单曲播放': BGMPlayMode.SINGLE,
    '循环播放': BGMPlayMode.SEQUENTIAL,
    '单曲循环': BGMPlayMode.SINGLE_LOOP,
};

// ═════════════════════════════════════════
// 变身状态
// ═════════════════════════════════════════
export enum TransformState {
    /** 变身前 */
    PRE_TRANSFORM = 0,
    /** 变身后 */
    POST_TRANSFORM = 1,
}

// ═════════════════════════════════════════
// 事件名常量（事件总线用）
// ═════════════════════════════════════════
export const GameEvents = {
    // 模式切换
    MODE_CHANGE: 'onModeChange',
    // 变身状态变化
    TRANSFORM_CHANGE: 'onTransformChange',
    // 形态切换
    FORM_CHANGE: 'onFormChange',
    // 重力感应方向触发
    G_DIRECTION: 'onGDirection',
    // LED颜色变化
    LED_COLOR_CHANGE: 'onLEDColorChange',
    // BGM播放状态变化
    BGM_STATE_CHANGE: 'onBGMStateChange',
    // 声控开关
    VOICE_CONTROL_TOGGLE: 'onVoiceControlToggle',
    // 重力感应开关
    GSENSOR_TOGGLE: 'onGSensorToggle',
    // 短按A键
    SHORT_PRESS_A: 'onShortPressA',
    // 长按A键
    LONG_PRESS_A: 'onLongPressA',
    // 短按B键
    SHORT_PRESS_B: 'onShortPressB',
} as const;

// ═════════════════════════════════════════
// BGM库文件夹映射（模式 → BGM文件夹路径）
// ═════════════════════════════════════════
export const MODE_BGM_FOLDERS: Record<number, string> = {
    [GameMode.DEFAULT]:         'Music/050TV本篇BGM',
    [GameMode.SHINING_TIGA]:    'Music/050TV本篇BGM',
    [GameMode.ULTRA_BROTHERS]:  'Music/051超八BGM',
    [GameMode.EVIL_TIGA]:       'Music/050TV本篇BGM',
    [GameMode.HUMAN_SIZE_TIGA]: 'Music/050TV本篇BGM',
    [GameMode.DARK_TIGA]:       'Music/052最终圣战BGM',
    [GameMode.CAMEERA]:         'Music/052最终圣战BGM',
};

/** 模式音效文件夹（各模式变身音效、重力感应音效等） */
export const MODE_SFX_FOLDERS: Record<number, string> = {
    [GameMode.DEFAULT]:         'Music/001迪迦模式',
    [GameMode.SHINING_TIGA]:    'Music/002闪耀迪迦模式台词版',
    [GameMode.ULTRA_BROTHERS]:  'Music/003超八模式',
    [GameMode.EVIL_TIGA]:       'Music/004邪恶迪迦模式',
    [GameMode.HUMAN_SIZE_TIGA]: 'Music/005迪迦等身模式',
    [GameMode.DARK_TIGA]:       'Music/006黑暗迪迦模式',
    [GameMode.CAMEERA]:         'Music/007卡密拉模式',
};
