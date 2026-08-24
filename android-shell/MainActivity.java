package com.yourcompany.lab7;

import android.annotation.SuppressLint;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

/**
 * LAB 7 的 WebView 外壳。
 *
 * 游戏本体是 dist/ 里打包好的 HTML5，放进 app/src/main/assets/ 后用
 * file:///android_asset/index.html 直接加载。因为打包产物是普通 script
 * （不是 ES module），file:// 下不会被 CORS 拦住，所以不需要
 * WebViewAssetLoader 之类的额外依赖。
 *
 * 纯 WebView 应用不含任何 .so，天然同时兼容 32/64 位 —— 正好满足
 * TapPlay 对「必须上传 32/64 位均兼容的 APK」的要求。
 */
public class MainActivity extends AppCompatActivity {

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 屏幕常亮：游戏有大段无输入的探索过程
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            WebView.setWebContentsDebuggingEnabled(false); // 调试期可临时改 true
        }

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);       // localStorage（存档用得到）
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false); // 否则 WebAudio 起不来
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // 关键：锁死字号缩放。HUD 全部用 em，跟随系统字体会把布局撑坏
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        // 去掉浏览器味道的交互
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHorizontalScrollBarEnabled(false);
        web.setVerticalScrollBarEnabled(false);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        web.setBackgroundColor(0xFF000000);
        web.setWebViewClient(new WebViewClient());

        web.loadUrl("file:///android_asset/index.html");
    }

    /** 沉浸式全屏：隐藏状态栏和导航栏，并允许内容延伸到刘海区 */
    private void goImmersive() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    @Override
    protected void onResume() {
        super.onResume();
        goImmersive();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    /** 返回键直接退出，不要走 WebView 的历史栈 */
    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
