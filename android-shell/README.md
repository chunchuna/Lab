# 打成 APK（面向 TapPlay 上架）

> 这个目录只放外壳需要的几个文件，不是完整的 Android Studio 工程。
> **本机没有 JDK，所以下面的构建步骤我没有实际跑过验证**，代码按 Android
> WebView 的标准用法写的，第一次编译如果报错请把错误贴给我。

## 为什么用 WebView 外壳

TapTap 小游戏的运行环境没有 BOM/DOM，整套 HTML/CSS 的 HUD、背包、人脸识别
终端都得重写成 Canvas 绘制。走 APK 则是标准 Android WebView，DOM、CSS 动画、
WebAudio 全部原样保留，改造量只有触屏操作和移动端排版。

纯 WebView 应用不包含任何 `.so`，天然同时兼容 32/64 位，正好满足
TapPlay「必须上传 32/64 位均兼容的 APK」的要求。

## 需要先装

本机当前缺这两样：

- **JDK 17**（`brew install openjdk@17`，Android Gradle Plugin 8.x 要求）
- **Android Studio**（自带 SDK Platform 34/35 与 Gradle）

已有的 `~/Library/Android/sdk` 只装了 platform 33 与 build-tools 32.0.0，版本偏旧，
装 Android Studio 时一并更新。

## 步骤

1. **打包游戏产物**

   ```bash
   npm run build       # 生成 dist/：index.html + game.js + style.css，约 108 KB
   npm run serve:dist  # 可选，本地先验一遍打包产物
   ```

2. **建工程**：Android Studio → New Project → **Empty Views Activity**
   （不要选 Compose），语言 Java，包名例如 `com.yourcompany.lab7`，
   minSdk 建议 23。

3. **放游戏文件**：把 `dist/` 里的三个文件复制到
   `app/src/main/assets/`（`assets` 目录需要自己新建）。

   ```
   app/src/main/assets/index.html
   app/src/main/assets/game.js
   app/src/main/assets/style.css
   ```

4. **替换代码**：把本目录的 `MainActivity.java` 覆盖到
   `app/src/main/java/<你的包路径>/MainActivity.java`，并把文件第一行的
   `package` 改成你的实际包名。

5. **合并清单**：参考本目录 `AndroidManifest.xml`，关键项是
   `screenOrientation="sensorLandscape"`（横屏）、`hardwareAccelerated="true"`
   （Canvas 性能）、`configChanges`（旋转不重建 Activity）。

6. **全屏主题**：在 `app/src/main/res/values/themes.xml` 加

   ```xml
   <style name="Theme.Lab7" parent="Theme.AppCompat.NoActionBar">
       <item name="android:windowFullscreen">true</item>
       <item name="android:windowContentOverlay">@null</item>
       <item name="android:windowBackground">@android:color/black</item>
       <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
   </style>
   ```

7. **出包**：`Build → Generate Signed Bundle / APK → APK`，自己建一个
   keystore 并**务必备份**（换 keystore 就没法更新已上架的版本）。

## 已经在代码里处理掉的移动端坑

| 坑 | 处理方式 |
| --- | --- |
| ES module 在 `file://` 下被 CORS 拦 | 打包成 IIFE 单文件，不用 module |
| WebAudio 需要用户手势才能出声 | `setMediaPlaybackRequiresUserGesture(false)` + 首次触摸时 `initAudio()` |
| 系统字体放大把 HUD 撑坏 | `setTextZoom(100)` 锁死；HUD 全部用 em 跟随舞台缩放 |
| 双指缩放 / 下拉回弹 / 长按选中 | `touch-action:none`、`overscroll-behavior:none`、`OVER_SCROLL_NEVER`、`setLongClickable(false)` |
| 返回键退出到 WebView 空白页 | `onBackPressed` 直接 `moveTaskToBack` |
| 探索时长时间无输入导致息屏 | `FLAG_KEEP_SCREEN_ON` |
| 刘海遮挡 | `windowLayoutInDisplayCutoutMode=shortEdges` + `notch_support` |

## 上架 TapPlay 要做的事

- 开发者中心创建游戏，**游玩提供方式**按需要勾选，APK 设置里勾上
  **TapPlay 模式授权**（零代码接入）。
- 资质：免费无内购 → 只需**防沉迷**与**隐私合规**；防沉迷由 TapPlay 沙箱代劳，
  不用自己接 SDK、也不用交录屏证明。**不需要版号，也不需要软著。**
- 登录方式只能是 TapTap 登录 / 手机号 / 游客，**不能有微信、QQ 等第三方登录**（当前没有登录，无影响）。
- 上架形式只能是「正式上线（试玩版）」，因为没有版号。
- 加固：官方推荐网易易盾；用别的方案要提工单报备。
- 建议先用 TapCanary 控制台的**沙盒测试**确认 WebView + Canvas 在 TapPlay 环境跑得动。

## 还没确认的事

**TapPlay 沙箱里能不能正常跑 TapADN 广告 SDK，官方文档没有任何说明。**
接广告前先提工单问清楚：沙箱环境对广告 SDK 的设备标识获取和收益归因有无影响。
