package com.lucubratio.reader;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
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
    private static final int REQ_IMPORT_COURSE = 1003;
    private static final long MAX_COURSE_PKG_BYTES = 200L * 1024 * 1024;
    /** 批量导入合计上限（避免一次多选 N 个 200MB 包把 cache 写满） */
    private static final long MAX_BATCH_BYTES = 600L * 1024 * 1024;
    /** 批量导入时给系统留的余量：可用空间低于「已累计 + 这个值」就中止 */
    private static final long BATCH_FREE_MARGIN = 300L * 1024 * 1024;
    private static final int MAX_BACKUP_BYTES = 16 * 1024 * 1024;

    private WebView webView;
    private long lastBackAt = 0L;
    private String pendingExportJson = null;
    /** 已导入课程：注册表就是 filesDir/courses/ 目录本身 */
    private CourseStore courseStore;
    private CourseImporter courseImporter;
    /** 「文件管理器点开 .lcr」时先落到 cache 的临时文件；导入完/取消后删除 */
    private File incomingCourseFile = null;
    /** 当前确认框：再来一批 .lcr 时要先把它关掉，否则前一批临时文件会丢引用泄漏 */
    private android.app.AlertDialog importDialog = null;
    /** 批量导入时已暂存的文件（取消/完成都要删） */
    private final java.util.List<File> pendingBatchFiles = new java.util.ArrayList<>();
    /** 批量导入进度框（null = 没有正在进行的导入） */
    private android.app.AlertDialog progressDialog = null;
    /** 用户在进度框点了「取消」 */
    private volatile boolean batchCancelled = false;

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

        courseStore = new CourseStore(this);
        courseImporter = new CourseImporter(this, courseStore);
        // 清理上次异常退出留下的 .tmp-* / .trash-*（不阻塞 UI，几毫秒的事）
        courseStore.cleanupTemp();
        // 外部打开 .lcr 时落到 cache 的临时包：进程被杀会残留，启动时兜底清掉。
        // 必须**同步**执行：后面 handleIncomingIntent() 会把新包写进同一个目录，
        // 若清理在后台线程跑，可能把刚写进来的包删掉（偶发"读不了这个课程包"）。
        cleanupIncomingDir();
        // 顺序很重要：WebViewAssetLoader 按注册顺序匹配（不是最长前缀），
        // 所以 "/courses/"（用户导入课程）必须排在 "/"（内置 assets）之前。
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/courses/", new UserCoursesHandler(courseStore))
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

        // 「文件管理器点开 .lcr」→ 冷启动走的也是这里
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // singleTask：App 已在前台时，再点一个 .lcr 会走这里
        handleIncomingIntent(intent);
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

        /** 已导入课程清单（JSON 字符串，注册表即目录） */
        @JavascriptInterface
        public String listCourses() {
            return courseStore.indexJson();
        }

        /**
         * 删除一门已导入课程（只删磁盘文件；网页侧负责清该课程的进度/卡片）。
         * 返回 {"ok":bool,"id":"…","message":"…"}
         */
        @JavascriptInterface
        public String deleteCourse(final String id) {
            boolean ok = courseStore.delete(id);
            String msg = ok ? "已删除" : "删除失败（课程不存在或无法写入）";
            return "{\"ok\":" + ok + ",\"id\":" + JSONObject.quote(id == null ? "" : id)
                    + ",\"message\":" + JSONObject.quote(msg) + "}";
        }

        /** 打开系统文件选择器导入课程包（.lcr）；结果通过 window.__saOnCourseImport 回调 */
        @JavascriptInterface
        public void importCourse() {
            runOnUiThread(MainActivity.this::startCourseImport);
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

    /* ================= 课程包导入（.lcr） ================= */

    private void startCourseImport() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/zip", "application/octet-stream", "application/x-zip-compressed"
        });
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);   // 批量导入：一次选多个 .lcr
        try {
            startActivityForResult(i, REQ_IMPORT_COURSE);
        } catch (Exception e) {
            Toast.makeText(this, "打不开文件选择器：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void importCourseFrom(Uri uri) {
        new Thread(() -> {
            CourseImporter.Result r = null;
            String err = null;
            try (InputStream is = getContentResolver().openInputStream(uri)) {
                if (is == null) throw new IOException("openInputStream 返回 null");
                // 大小上限：先看文件描述符的尺寸（不可知时由解压器的总量上限兜底）
                long size = MAX_COURSE_PKG_BYTES + 1;
                try (android.content.res.AssetFileDescriptor afd = getContentResolver().openAssetFileDescriptor(uri, "r")) {
                    if (afd != null && afd.getLength() >= 0) size = afd.getLength();
                } catch (Exception ignored) { }
                if (size > MAX_COURSE_PKG_BYTES) throw new IOException("课程包超过 200MB");

                r = courseImporter.importZip(is, BuildConfig.VERSION_NAME);
            } catch (Exception e) {
                err = String.valueOf(e.getMessage());
            }
            if (r != null) showImportOutcome(r.ok, r.id, r.code, r.message, r.pages, r.replaced);
            else showImportOutcome(false, "", "E_IO", err, 0, false);
        }, "course-import").start();
    }

    /** 是否已导入过同 id 的课程（决定确认框要不要提示"覆盖"） */
    private boolean courseExists(String id) {
        try {
            for (CourseStore.Course c : courseStore.list()) {
                if (c.id != null && c.id.equals(id)) return true;
            }
        } catch (Exception ignored) { }
        return false;
    }

    /** 统一上报导入结果：网页 Toast + 原生 Toast（网页侧 home.js 的 __saOnCourseImport 会刷新首页） */
    private void showImportOutcome(boolean ok, String id, String code, String message, int pages, boolean replaced) {
        // org.json 的 JSONObject.quote 在 Android 上不抛受检异常，直接拼即可
        String json = "{\"ok\":" + ok + ",\"id\":" + JSONObject.quote(id == null ? "" : id)
                + ",\"code\":" + JSONObject.quote(code == null ? "" : code)
                + ",\"message\":" + JSONObject.quote(message == null ? "" : message)
                + ",\"pages\":" + pages + ",\"replaced\":" + replaced + "}";
        final String payload = json;
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.__saOnCourseImport && window.__saOnCourseImport(" + payload + ");", null);
            }
            Toast.makeText(this,
                    ok ? ((replaced ? "已更新" : "已导入") + "《" + id + "》" + pages + " 页")
                       : ("导入失败：" + message),
                    Toast.LENGTH_LONG).show();
        });
    }

    /* ================= 外部打开：文件管理器点开 .lcr ================= */

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();

        // 批量分享：多选 .lcr → 分享 → 本 App
        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            java.util.List<Uri> uris = collectStreamUris(intent);
            if (!uris.isEmpty()) stageBatch(uris);
            return;
        }

        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) uri = intent.getData();
        } else {
            return;
        }
        if (uri == null) return;

        String scheme = uri.getScheme();
        if (!"content".equals(scheme) && !"file".equals(scheme)) {
            Toast.makeText(this, "只支持本地课程包", Toast.LENGTH_LONG).show();
            return;
        }
        // 文件名必须像 .lcr：intent-filter 已按 pathPattern 过滤，这里再兜一层（防 */* 误入）。
        // 拿不到显示名时只放行"窄 MIME"（octet-stream / zip / x-lcr），
        // 否则任何 App 用 */* 打开未知文件都会被接住并弹「不是可用的课程包」。
        String name = displayName(uri);
        String lower = name == null ? null : name.toLowerCase(java.util.Locale.ROOT);
        if (lower != null) {
            if (!lower.endsWith(".lcr")) return;          // 有名字但不是 .lcr → 安静忽略
        } else {
            String type = intent.getType();
            boolean narrow = type != null && (
                    "application/octet-stream".equals(type)
                    || "application/zip".equals(type)
                    || "application/x-lcr".equals(type));
            if (!narrow) return;                          // 连名字都没有 + 宽 MIME → 忽略
        }
        // 上一份还在等确认（或残留）：先清掉，避免临时文件泄漏。
        // 但如果是用户主动又点了新文件把上一次顶掉，得给一句提示（否则像"点没反应"）
        if (hasPendingImport()) {
            Toast.makeText(this, "已取消上一次导入", Toast.LENGTH_SHORT).show();
        }
        discardIncoming();
        stageAndConfirm(uri);
    }

    /** 取 content URI 的显示名（取不到就退回路径末段） */
    private String displayName(Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) name = c.getString(idx);
                }
            } catch (Exception ignored) { }
        }
        if (name == null) {
            name = uri.getLastPathSegment();
            if (name != null) {
                int slash = name.lastIndexOf('/');
                if (slash >= 0) name = name.substring(slash + 1);
                int colon = name.lastIndexOf(':');
                if (colon >= 0) name = name.substring(colon + 1);
            }
        }
        return name;
    }

    /**
     * 把 URI 落到 cache 再预检，然后问用户要不要导入。
     * 为什么要落盘：① content URI 的读权限只在本次会话有效，且 peek 与 import 要读两次；
     * ② ZipFile 需要随机访问，流式读会慢很多。
     */
    /** 把 content:// / file:// 的流复制到目标文件（带 200MB 上限）；返回复制的字节数 */
    private long copyUriTo(Uri uri, File dst) throws IOException {
        try (java.io.InputStream is = getContentResolver().openInputStream(uri);
             FileOutputStream fos = new FileOutputStream(dst)) {
            if (is == null) throw new IOException("打不开文件（可能没有读取权限）");
            byte[] buf = new byte[65536];
            long total = 0;
            int n;
            while ((n = is.read(buf)) > 0) {
                total += n;
                if (total > MAX_COURSE_PKG_BYTES) throw new IOException("课程包超过 200MB");
                fos.write(buf, 0, n);
            }
            return total;
        }
    }

    /** 从 SEND_MULTIPLE 的 Intent 里取出所有流 URI（ParcelableArrayList 优先，String[] 兜底） */
    private java.util.List<Uri> collectStreamUris(Intent intent) {
        java.util.List<Uri> out = new java.util.ArrayList<>();
        try {
            java.util.ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) for (Uri u : list) if (u != null) out.add(u);
        } catch (Exception ignored) { }
        if (out.isEmpty()) {
            // 某些分享方（以及 adb --esa 构造的 intent）传的是 String[]，兜底解析一下
            try {
                java.util.ArrayList<String> strs = intent.getStringArrayListExtra(Intent.EXTRA_STREAM);
                if (strs != null) for (String str : strs) {
                    try { out.add(Uri.parse(str)); } catch (Exception ignored) { }
                }
            } catch (Exception ignored) { }
        }
        if (out.isEmpty()) {
            // 还有的调用方传 String[]（adb --esa 就是这样）或 ArrayList<String>
            try {
                java.io.Serializable ser = intent.getSerializableExtra(Intent.EXTRA_STREAM);
                if (ser instanceof String[]) {
                    for (String str : (String[]) ser) {
                        try { out.add(Uri.parse(str)); } catch (Exception ignored) { }
                    }
                } else if (ser instanceof java.util.ArrayList) {
                    for (Object o : (java.util.ArrayList<?>) ser) {
                        if (o == null) continue;
                        try { out.add(Uri.parse(String.valueOf(o))); } catch (Exception ignored) { }
                    }
                } else if (ser instanceof String) {
                    out.add(Uri.parse((String) ser));
                }
            } catch (Exception ignored) { }
        }
        if (out.isEmpty()) {
            Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (single != null) out.add(single);
        }
        return out;
    }

    /* ================= 批量导入 ================= */

    /** 逐个落盘 + 预检，然后弹一个"批量确认"框 */
    private void stageBatch(java.util.List<Uri> uris) {
        if (uris == null || uris.isEmpty()) return;
        if (hasPendingImport()) {
            Toast.makeText(this, "已取消上一次导入", Toast.LENGTH_SHORT).show();
        }
        discardIncoming();
        new Thread(() -> {
            File dir = new File(getCacheDir(), "incoming");
            if (!dir.isDirectory() && !dir.mkdirs()) {
                runOnUiThread(() -> Toast.makeText(this, "无法创建缓存目录", Toast.LENGTH_LONG).show());
                return;
            }
            java.util.List<File> okFiles = new java.util.ArrayList<>();
            java.util.List<CourseImporter.Peek> okPeeks = new java.util.ArrayList<>();
            java.util.List<String> skipped = new java.util.ArrayList<>();

            int idx = 0;
            long batchBytes = 0;
            for (Uri uri : uris) {
                // 合计上限：超了就停，剩下的记为跳过（已落盘的在下面统一清理或保留给确认框）
                if (batchBytes >= MAX_BATCH_BYTES) {
                    skipped.add("其余文件 —— 本批合计超过 " + (MAX_BATCH_BYTES / 1048576) + "MB，未继续复制");
                    break;
                }
                if (dir.getUsableSpace() < batchBytes + BATCH_FREE_MARGIN) {
                    skipped.add("其余文件 —— 存储空间不足（剩余 " + (dir.getUsableSpace() / 1048576) + "MB）");
                    break;
                }
                String name = displayName(uri);
                if (name != null && !name.toLowerCase(java.util.Locale.ROOT).endsWith(".lcr")) {
                    skipped.add(name + " —— 不是 .lcr 文件");
                    continue;
                }
                File dst = new File(dir, "batch-" + System.currentTimeMillis() + "-" + (idx++) + ".lcr");
                try {
                    batchBytes += copyUriTo(uri, dst);
                    CourseImporter.Peek pk = CourseImporter.peek(dst, BuildConfig.VERSION_NAME);
                    if (!pk.ok) {
                        //noinspection ResultOfMethodCallIgnored
                        dst.delete();
                        skipped.add((name == null ? "未知文件" : name) + " —— " + pk.message);
                        continue;
                    }
                    okFiles.add(dst);
                    okPeeks.add(pk);
                } catch (Exception e) {
                    //noinspection ResultOfMethodCallIgnored
                    dst.delete();
                    skipped.add((name == null ? "未知文件" : name) + " —— " + e.getMessage());
                }
            }
            final java.util.List<File> fOk = okFiles;
            final java.util.List<CourseImporter.Peek> pOk = okPeeks;
            final java.util.List<String> fSkip = skipped;
            runOnUiThread(() -> showBatchConfirm(fOk, pOk, fSkip));
        }, "course-batch-stage").start();
    }

    private void showBatchConfirm(java.util.List<File> okFiles, java.util.List<CourseImporter.Peek> peeks,
                                  java.util.List<String> skipped) {
        if (isFinishing()) {
            for (File f : okFiles) //noinspection ResultOfMethodCallIgnored
                f.delete();
            return;
        }
        if (okFiles.isEmpty()) {
            new android.app.AlertDialog.Builder(this)
                    .setTitle("没有可导入的课程包")
                    .setMessage(joinLines(skipped))
                    .setPositiveButton("知道了", null)
                    .show();
            return;
        }
        pendingBatchFiles.clear();
        pendingBatchFiles.addAll(okFiles);

        long totalBytes = 0;
        StringBuilder sb = new StringBuilder();
        int dup = 0;
        for (int i = 0; i < peeks.size(); i++) {
            CourseImporter.Peek pk = peeks.get(i);
            totalBytes += pk.bytes;
            sb.append("✅ 《").append(pk.title).append("》")
              .append(pk.pages).append(" 页");
            if (pk.questions > 0) sb.append(" · ").append(pk.questions).append(" 题");
            sb.append(" · ").append(String.format(java.util.Locale.ROOT, "%.1f MB", pk.bytes / 1048576.0));
            if (courseExists(pk.id)) { sb.append("（覆盖同 id）"); dup++; }
            sb.append("\n");
        }
        for (String sk : skipped) sb.append("⚠️ ").append(sk).append("\n");
        sb.append("\n共 ").append(String.format(java.util.Locale.ROOT, "%.1f MB", totalBytes / 1048576.0));
        if (dup > 0) sb.append("，其中 ").append(dup).append(" 个会覆盖已有课程");

        final String msg = sb.toString();
        final int n = okFiles.size();
        importDialog = new android.app.AlertDialog.Builder(this)
                .setTitle("导入 " + n + " 个课程包？")
                .setMessage(msg)
                .setNegativeButton("取消", (d, w) -> discardIncoming())
                .setPositiveButton("导入 " + n + " 个", (d, w) -> {
                    java.util.List<File> files = new java.util.ArrayList<>(pendingBatchFiles);
                    java.util.List<String> titles = new java.util.ArrayList<>();
                    for (CourseImporter.Peek pk : peeks) titles.add(pk.title);
                    pendingBatchFiles.clear();
                    importBatch(files, titles);
                })
                .setOnCancelListener(d -> discardIncoming())
                .setOnDismissListener(d -> importDialog = null)
                .show();
    }

    /** 删除 files[from..] 里还没处理的暂存包（已处理过的在 finally 里删过，重复删无害） */
    private void deleteRemaining(java.util.List<File> files, int from) {
        if (files == null) return;
        for (int k = Math.max(0, from); k < files.size(); k++) {
            File f = files.get(k);
            if (f != null) //noinspection ResultOfMethodCallIgnored
                f.delete();
        }
    }

    /** 顺序导入一批已暂存文件；单个失败不影响其它；带进度与取消 */
    private void importBatch(java.util.List<File> files, java.util.List<String> titles) {
        if (files == null || files.isEmpty()) return;
        final int total = files.size();
        batchCancelled = false;
        progressDialog = new android.app.AlertDialog.Builder(this)
                .setTitle("正在导入")
                .setMessage("0 / " + total)
                .setNegativeButton("取消", (d, w) -> batchCancelled = true)
                .setCancelable(false)
                .show();

        new Thread(() -> {
            int okCount = 0, pages = 0;
            java.util.List<String> fails = new java.util.ArrayList<>();
            for (int i = 0; i < total; i++) {
                if (batchCancelled) {
                    // 取消：把 i 及之后的暂存包全部删掉，否则它们会在 cache 里躺到下次冷启动
                    // （pendingBatchFiles 在进入本方法前已清空，discardIncoming 清不到这些）
                    deleteRemaining(files, i);
                    fails.add("已取消：剩余 " + (total - i) + " 个未导入");
                    break;
                }
                File f = files.get(i);
                final String label = (titles != null && i < titles.size()) ? titles.get(i) : f.getName();
                final int cur = i + 1;
                runOnUiThread(() -> {
                    if (progressDialog != null) progressDialog.setMessage(cur + " / " + total + "：" + label);
                });
                try (FileInputStream is = new FileInputStream(f)) {
                    if (f.length() > MAX_COURSE_PKG_BYTES) throw new IOException("单个课程包超过 200MB");
                    CourseImporter.Result r = courseImporter.importZip(is, BuildConfig.VERSION_NAME);
                    if (r.ok) { okCount++; pages += r.pages; }
                    else fails.add("《" + r.id + "》" + r.message);
                } catch (Exception e) {
                    fails.add(f.getName() + "：" + e.getMessage());
                } finally {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
            deleteRemaining(files, files.size());   // 兜底：正常结束后不应有残留
            final int fOk = okCount, fPages = pages;
            final java.util.List<String> fFails = fails;
            runOnUiThread(() -> {
                if (progressDialog != null) {
                    android.app.AlertDialog d = progressDialog;
                    progressDialog = null;
                    try { d.dismiss(); } catch (Exception ignored) { }
                }
                showBatchOutcome(fOk, fPages, fFails);
            });
        }, "course-batch-import").start();
    }

    private void showBatchOutcome(int okCount, int pages, java.util.List<String> fails) {
        String detail = fails.isEmpty() ? "" : ("；失败 " + fails.size() + " 个：" + joinLines(fails));
        String msg = "导入完成：" + okCount + " 个（" + pages + " 页）" + detail;
        try {
            org.json.JSONArray arr = new org.json.JSONArray();
            for (String f : fails) arr.put(f);
            String payload = "{\"ok\":" + (fails.isEmpty()) + ",\"imported\":" + okCount
                    + ",\"pages\":" + pages + ",\"failed\":" + fails.size()
                    + ",\"messages\":" + arr.toString() + "}";
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.__saOnCourseImportBatch && window.__saOnCourseImportBatch(" + payload + ");", null);
            }
        } catch (Exception ignored) { }
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    private static String joinLines(java.util.List<String> list) {
        StringBuilder sb = new StringBuilder();
        for (String s : list) sb.append(s).append("\n");
        return sb.toString().trim();
    }

    private void stageAndConfirm(Uri uri) {
        new Thread(() -> {
            File dst = null;
            try {
                File dir = new File(getCacheDir(), "incoming");
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("无法创建缓存目录");
                dst = new File(dir, "pkg-" + System.currentTimeMillis() + ".lcr");
                copyUriTo(uri, dst);
                CourseImporter.Peek pk = CourseImporter.peek(dst, BuildConfig.VERSION_NAME);
                final File staged = dst;
                runOnUiThread(() -> showImportConfirm(staged, pk));
            } catch (Exception e) {
                if (dst != null) //noinspection ResultOfMethodCallIgnored
                    dst.delete();
                final String msg = String.valueOf(e.getMessage());
                runOnUiThread(() -> Toast.makeText(this, "读不了这个课程包：" + msg, Toast.LENGTH_LONG).show());
            }
        }, "course-intent").start();
    }

    private void showImportConfirm(File staged, CourseImporter.Peek pk) {
        if (isFinishing()) {
            //noinspection ResultOfMethodCallIgnored
            staged.delete();
            return;
        }
        if (!pk.ok) {
            //noinspection ResultOfMethodCallIgnored
            staged.delete();
            new android.app.AlertDialog.Builder(this)
                    .setTitle("不是可用的课程包")
                    .setMessage(pk.message)
                    .setPositiveButton("知道了", null)
                    .show();
            return;
        }
        incomingCourseFile = staged;
        boolean exists = courseExists(pk.id);
        String size = String.format(java.util.Locale.ROOT, "%.1f MB", pk.bytes / 1048576.0);
        StringBuilder sb = new StringBuilder();
        sb.append("《").append(pk.title).append("》\n");
        sb.append("id：").append(pk.id).append("\n");
        sb.append(pk.pages).append(" 页");
        if (pk.questions > 0) sb.append(" · ").append(pk.questions).append(" 道检测题");
        sb.append(" · ").append(size);
        if (exists) sb.append("\n\n已有同 id 课程，导入后会覆盖它，旧卡片进「待复核」。");

        importDialog = new android.app.AlertDialog.Builder(this)
                .setTitle("导入这个课程包？")
                .setMessage(sb.toString())
                .setNegativeButton("取消", (d, w) -> discardIncoming())
                .setPositiveButton("导入", (d, w) -> {
                    File f = incomingCourseFile;
                    incomingCourseFile = null;
                    importCourseFromFile(f);
                })
                .setOnCancelListener(d -> discardIncoming())
                .setOnDismissListener(d -> importDialog = null)
                .show();
    }

    /** 是否有"等确认"或"正在导入"的批次 */
    private boolean hasPendingImport() {
        return importDialog != null || progressDialog != null
                || incomingCourseFile != null || !pendingBatchFiles.isEmpty();
    }

    /** 清空 cache/incoming（启动兜底；同步执行，见 onCreate 注释） */
    private void cleanupIncomingDir() {
        File dir = new File(getCacheDir(), "incoming");
        File[] fs = dir.listFiles();
        if (fs != null) for (File f : fs) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    private void discardIncoming() {
        if (progressDialog != null) {
            batchCancelled = true;
            android.app.AlertDialog d = progressDialog;
            progressDialog = null;
            try { d.dismiss(); } catch (Exception ignored) { }
        }
        if (importDialog != null) {
            android.app.AlertDialog d = importDialog;
            importDialog = null;
            try { d.dismiss(); } catch (Exception ignored) { }
        }
        if (incomingCourseFile != null) {
            //noinspection ResultOfMethodCallIgnored
            incomingCourseFile.delete();
            incomingCourseFile = null;
        }
        for (File f : pendingBatchFiles) //noinspection ResultOfMethodCallIgnored
            f.delete();
        pendingBatchFiles.clear();
    }

    /** 从「外部打开的临时文件」导入 */
    private void importCourseFromFile(File f) {
        if (f == null) return;
        new Thread(() -> {
            CourseImporter.Result r;
            try (FileInputStream is = new FileInputStream(f)) {
                if (f.length() > MAX_COURSE_PKG_BYTES) throw new IOException("课程包超过 200MB");
                r = courseImporter.importZip(is, BuildConfig.VERSION_NAME);
            } catch (Exception e) {
                r = null;
                showImportOutcome(false, "", "E_IO", String.valueOf(e.getMessage()), 0, false);
            } finally {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
            if (r != null) showImportOutcome(r.ok, r.id, r.code, r.message, r.pages, r.replaced);
        }, "course-import-file").start();
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

        boolean multiCourse = requestCode == REQ_IMPORT_COURSE && data != null
                && data.getClipData() != null && data.getClipData().getItemCount() > 1;
        if (resultCode != RESULT_OK || data == null || (!multiCourse && data.getData() == null)) {
            pendingExportJson = null;
            if (requestCode == REQ_EXPORT || requestCode == REQ_IMPORT || requestCode == REQ_IMPORT_COURSE) {
                Toast.makeText(this, "已取消", Toast.LENGTH_SHORT).show();
            }
            return;
        }

        if (multiCourse) {
            // 文件选择器里多选：走批量流程（ClipData 提供全部 URI）
            java.util.List<Uri> uris = new java.util.ArrayList<>();
            android.content.ClipData cd = data.getClipData();
            for (int i = 0; i < cd.getItemCount(); i++) {
                Uri u = cd.getItemAt(i).getUri();
                if (u != null) uris.add(u);
            }
            stageBatch(uris);
            return;
        }

        Uri uri = data.getData();
        if (requestCode == REQ_EXPORT) writeBackup(uri);
        else if (requestCode == REQ_IMPORT) readBackup(uri);
        else if (requestCode == REQ_IMPORT_COURSE) importCourseFrom(uri);
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
                String mime = Mime.of(assetPath);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                boolean textual = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json");
                return new WebResourceResponse(mime, textual ? "utf-8" : null, 200, "OK", headers, is);
            } catch (IOException e) {
                return null; // 资源不存在 → 由 WebView 自行处理（离线环境会显示错误页）
            }
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
        discardIncoming();
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /**
     * 返回键：先问网页能不能消费（图片/图表放大层、目录抽屉），再回退历史，最后两次返回退出。
     *
     * 两个实测坑（本机 WebView 110）：
     *  1) webView.goBack() 对「应用内 location.href 跳转」是**空操作**：idx=1/2 时调 goBack()，
     *     1 秒后 URL 仍不变；而 JS 的 history.back() 能正常跨文档回退（实测 idx 1→0）。
     *  2) webView.canGoBack() 在同一状态下返回 false（与 copyBackForwardList().getCurrentIndex() 矛盾），
     *     所以历史判断改用 getCurrentIndex()。
     * TODO(P7): targetSdk 升到 36 前迁移到 OnBackPressedDispatcher（manifest 已显式关闭预测返回）。
     */
    @Override
    public void onBackPressed() {
        if (webView == null) {
            fallbackBack();
            return;
        }
        webView.evaluateJavascript("(window.__saOnBack && window.__saOnBack()) ? '1' : '0'", value -> {
            boolean consumed = value != null && value.contains("1");
            if (!consumed) fallbackBack();
        });
    }

    /** 历史里是否还有上一页（不用 canGoBack：本机它会误报 false） */
    private boolean canGoBackReliable() {
        if (webView == null) return false;
        WebBackForwardList bfl = webView.copyBackForwardList();
        return bfl != null && bfl.getCurrentIndex() > 0;
    }

    /** 网页没有消费返回键时的原逻辑 */
    private void fallbackBack() {
        if (canGoBackReliable()) {
            // 必须走 JS：webView.goBack() 对应用内跳转是空操作（见方法注释）
            webView.evaluateJavascript("history.back()", null);
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
