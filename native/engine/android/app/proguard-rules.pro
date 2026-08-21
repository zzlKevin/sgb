# ─── 讯飞语音 SDK（混淆必须保留，否则 release 包初始化必挂）───
-keep class com.iflytek.** { *; }
-dontwarn com.iflytek.**

# ─── Cocos JsbBridge 回调（事件监听器通过反射/内部类持有，保险起见保留）───
-keep class com.cocos.lib.** { *; }
-dontwarn com.cocos.lib.**

# ─── 本工程类（含事件监听 Lambda）───
-keep class com.smilelight.** { *; }
-dontwarn com.smilelight.**
