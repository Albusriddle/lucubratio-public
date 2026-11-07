package com.lucubratio.reader;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 最小 WebView 壳。
 *
 * 关键点 1：所有页面都通过 WebViewAssetLoader 以
 *   https://appassets.androidplatform.net/... 的 secure origin 加载，
 *   绝不使用 file://（file:// 下 IndexedDB / localStorage 不可持久，FSRS 数据会丢）。
 *
 * 关键点 2：自定义 PathHandler 把「站点根」直接映射到 assets/web/。
 *
 * 关键点 3：备份导出/导入走 SAF（ACTION_CREATE_DOCUMENT / ACTION_OPEN_DOCUMENT），
 *   不需要任何存储权限，也不需要 INTERNET。
 */
public class MainActivity extends Activity {

    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/";

    private static final int REQ_EXPORT = 1001;
    private static final int REQ_IMPORT = 1002;
    private static final int MAX_BACKUP_BYTES = 16 * 1024 * 1024;

    private WebView webView;
    private long lastBackAt = 0L;
    private String pendingExportJson = null;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 冷启动首帧：按系统夜间模式选底色，避免深色下先闪一片白
        boolean nightMode = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int bg = Color.parseColor(nightMode ? "#0F1115" : "#FBFBFD");
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(bg));
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);

        webView = new WebView(this);
        webView.setBackgroundColor(bg);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // 允许双指缩放（长表格/宽图需要），但不要系统那对 +/- 按钮
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        // 所有资源都来自 APK 内的 assets（无网络），走缓存只会带来"升级后还跑旧 JS"的幽灵问题
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // 字号跟随系统设置（不做 setTextZoom 硬编码）；应用内字号调节见 docs/BACKLOG.md P2

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new RootAssetsHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.addJavascriptInterface(new Bridge(), "AndroidSA");

        boolean restored = false;
        if (savedInstanceState != null) {
            // restoreState 在没有可恢复历史时返回 null —— 此时必须回落到首页，否则白屏
            restored = webView.restoreState(savedInstanceState) != null;
        }
        if (!restored) {
            webView.loadUrl(START_URL);
        }
    }

    /* ================= 备份：JS ↔ 原生 ================= */

    public class Bridge {
        @JavascriptInterface
        public void exportBackup(final String json, final String filename) {
            runOnUiThread(() -> startExport(json, filename));
        }

        @JavascriptInterface
        public void importBackup() {
            runOnUiThread(MainActivity.this::startImport);
        }

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, String.valueOf(msg), Toast.LENGTH_SHORT).show());
        }

        /** 网页切换深浅色时同步状态栏 / 导航栏（否则深色页面配亮色状态栏很割裂） */
        @JavascriptInterface
        public void setTheme(final String mode) {
            final boolean dark = "dark".equalsIgnoreCase(mode);
            runOnUiThread(() -> applyTheme(dark));
        }
    }

    private void applyTheme(boolean dark) {
        int bg = Color.parseColor(dark ? "#0F1115" : "#FBFBFD");
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        if (webView != null) webView.setBackgroundColor(bg);

        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (c != null) {
            c.setAppearanceLightStatusBars(!dark);
            c.setAppearanceLightNavigationBars(!dark);
        }
    }

    private void startExport(String json, String filename) {
        pendingExportJson = json;
        try {
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, filename == null ? "lucubratio-backup.json" : filename);
            startActivityForResult(i, REQ_EXPORT);
        } catch (Exception e) {
            pendingExportJson = null;
            Toast.makeText(this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
        }
    }

    private void startImport() {
        try {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            startActivityForResult(i, REQ_IMPORT);
        } catch (Exception e) {
            Toast.makeText(this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            pendingExportJson = null;
            if (requestCode == REQ_EXPORT || requestCode == REQ_IMPORT) {
                Toast.makeText(this, "已取消", Toast.LENGTH_SHORT).show();
            }
            return;
        }

        Uri uri = data.getData();
        if (requestCode == REQ_EXPORT) writeBackup(uri);
        else if (requestCode == REQ_IMPORT) readBackup(uri);
    }

    private void writeBackup(Uri uri) {
        String json = pendingExportJson;
        pendingExportJson = null;
        if (json == null) {
            Toast.makeText(this, "没有可导出的数据", Toast.LENGTH_SHORT).show();
            return;
        }
        try (OutputStream os = getContentResolver().openOutputStream(uri, "wt")) {
            if (os == null) throw new IOException("openOutputStream 返回 null");
            os.write(json.getBytes(StandardCharsets.UTF_8));
            os.flush();
            Toast.makeText(this, "已导出备份", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "导出失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void readBackup(Uri uri) {
        new Thread(() -> {
            try (InputStream is = getContentResolver().openInputStream(uri)) {
                if (is == null) throw new IOException("openInputStream 返回 null");
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) {
                    bos.write(buf, 0, n);
                    if (bos.size() > MAX_BACKUP_BYTES) throw new IOException("备份文件过大");
                }
                String text = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                final String js = "window.__saOnImport && window.__saOnImport(" + JSONObject.quote(text) + ");";
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript(js, null);
                });
            } catch (Exception e) {
                runOnUiThread(() ->
                        Toast.makeText(this, "读取失败：" + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }, "backup-import").start();
    }

    /* ================= 资源映射 / 生命周期 ================= */

    /** 站点根 → assets/web */
    private static final class RootAssetsHandler implements WebViewAssetLoader.PathHandler {
        private final Context context;

        RootAssetsHandler(Context ctx) {
            this.context = ctx.getApplicationContext();
        }

        @Override
        public WebResourceResponse handle(String path) {
            String rel = path == null ? "" : path;
            while (rel.startsWith("/")) rel = rel.substring(1);
            if (rel.isEmpty() || rel.endsWith("/")) rel = rel + "index.html";

            String assetPath = "web/" + rel;
            try {
                InputStream is = context.getAssets().open(assetPath);
                String mime = guessMime(assetPath);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                boolean textual = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json");
                return new WebResourceResponse(mime, textual ? "utf-8" : null, 200, "OK", headers, is);
            } catch (IOException e) {
                return null; // 资源不存在 → 由 WebView 自行处理（离线环境会显示错误页）
            }
        }

        private static String guessMime(String p) {
            String lower = p.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
            if (lower.endsWith(".css")) return "text/css";
            if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
            if (lower.endsWith(".json")) return "application/json";
            if (lower.endsWith(".svg")) return "image/svg+xml";
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
            if (lower.endsWith(".webp")) return "image/webp";
            if (lower.endsWith(".gif")) return "image/gif";
            if (lower.endsWith(".woff2")) return "font/woff2";
            if (lower.endsWith(".woff")) return "font/woff";
            if (lower.endsWith(".ttf")) return "font/ttf";
            return "application/octet-stream";
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /**
     * 返回键：优先网页历史，其次两次返回退出。
     * TODO(P7): targetSdk 升到 36 前迁移到 OnBackPressedDispatcher（manifest 已显式关闭预测返回）。
     */
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackAt > 2000L) {
            lastBackAt = now;
            Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
            return;
        }
        super.onBackPressed();
    }
}
