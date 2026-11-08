package com.lucubratio.reader;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 课程包导入器（.lcr = zip）。
 *
 * 流程：流式解压到 .tmp-<uuid>/ → 全量校验 → ATOMIC_MOVE 提交为 courses/<id>/
 * 任何一步失败都会删掉临时目录，绝不留下半成品。
 *
 * 安全闸门：
 *   · Zip Slip：拒绝绝对路径 / ".." / 反斜杠 / NUL / 盘符；
 *   · Zip 炸弹：条目数 ≤ 5000、单条 ≤ 64MB、总量 ≤ 200MB（按实际解压字节计）；
 *   · 扩展名白名单；
 *   · 每页跑 HtmlGuard（与 Node 侧同一套规则）；
 *   · format.json 的 id 必须合法，且 appMin 不能高于当前版本。
 */
public final class CourseImporter {

    public static final class Result {
        public final boolean ok;
        public final String id;
        public final String code;
        public final String message;
        public final int pages;
        /** true = 覆盖了同 id 的旧版本（不是首次安装） */
        public final boolean replaced;

        private Result(boolean ok, String id, String code, String message, int pages, boolean replaced) {
            this.ok = ok; this.id = id; this.code = code; this.message = message;
            this.pages = pages; this.replaced = replaced;
        }

        static Result ok(String id, int pages, boolean replaced) {
            return new Result(true, id, "OK", replaced ? "已更新" : "导入成功", pages, replaced);
        }
        static Result fail(String code, String message) { return new Result(false, null, code, message, 0, false); }
    }

    private static final int MAX_ENTRIES = 5000;
    private static final long MAX_ENTRY_BYTES = 64L * 1024 * 1024;
    private static final long MAX_TOTAL_BYTES = 200L * 1024 * 1024;
    private static final Set<String> ALLOWED_EXT = new HashSet<>(Arrays.asList(
            ".html", ".htm", ".json", ".webp", ".png", ".jpg", ".jpeg", ".svg",
            ".woff2", ".woff", ".ttf", ".txt", ".md"));

    private final Context ctx;
    private final File root;
    private final CourseStore store;

    public CourseImporter(Context ctx, CourseStore store) {
        this.ctx = ctx.getApplicationContext();
        this.root = store.root();
        this.store = store;
    }

    /** 从 zip 输入流导入；调用方负责关闭流 */
    public Result importZip(InputStream in, String currentAppVersion) {
        final String uuid = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        final File tmp = new File(root, ".tmp-" + uuid);
        try {
            if (!tmp.mkdirs() && !tmp.isDirectory()) {
                return Result.fail("E_IO", "无法创建临时目录");
            }
            Result ex = extract(in, tmp);
            if (!ex.ok) return ex;

            Validation va = validate(tmp, currentAppVersion);
            if (!va.ok) return Result.fail(va.code, va.message);

            return commit(tmp, va.id, uuid, va.pages);
        } catch (Exception e) {
            deleteRecursively(tmp);
            return Result.fail("E_IO", "导入失败：" + e.getMessage());
        }
    }

    /* ---------------- 1) 解压 ---------------- */

    private Result extract(InputStream in, File tmp) throws IOException {
        ZipInputStream zis = new ZipInputStream(in, StandardCharsets.UTF_8);
        byte[] buf = new byte[16384];
        int entries = 0;
        long total = 0;

        try {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                String name = e.getName();
                if (name == null || name.isEmpty()) continue;

                if (++entries > MAX_ENTRIES) return Result.fail("E_TOO_MANY", "包内条目过多");

                String rel = safeRelPath(name);
                if (rel == null) return Result.fail("E_PATH", "包内存在不安全路径：" + name);

                File out = new File(tmp, rel);
                if (e.isDirectory()) {
                    if (!out.mkdirs() && !out.isDirectory()) return Result.fail("E_IO", "无法创建目录：" + rel);
                    continue;
                }

                String lower = rel.toLowerCase(Locale.ROOT);
                int dot = lower.lastIndexOf('.');
                String ext = dot < 0 ? "" : lower.substring(dot);
                if (!ALLOWED_EXT.contains(ext)) return Result.fail("E_EXT", "不允许的文件类型：" + rel);

                File parent = out.getParentFile();
                if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
                    return Result.fail("E_IO", "无法创建目录：" + rel);
                }

                long written = 0;
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    int n;
                    while ((n = zis.read(buf)) > 0) {
                        written += n;
                        total += n;
                        if (written > MAX_ENTRY_BYTES) return Result.fail("E_TOO_BIG", "单个文件过大：" + rel);
                        if (total > MAX_TOTAL_BYTES) return Result.fail("E_TOO_BIG", "解压后总量超过 200MB");
                        fos.write(buf, 0, n);
                    }
                }
                if (e.getSize() >= 0 && written != e.getSize()) {
                    return Result.fail("E_CRC", "文件大小不符（可能已损坏）：" + rel);
                }
            }
        } catch (IOException e) {
            return Result.fail("E_ZIP", "不是有效的课程包：" + e.getMessage());
        }
        if (entries == 0) return Result.fail("E_ZIP", "包是空的");
        return Result.ok(null, 0, false);
    }

    /** 校验并归一化 zip 内路径；不安全返回 null */
    static String safeRelPath(String raw) {
        if (raw.indexOf('\0') >= 0 || raw.indexOf('\\') >= 0) return null;
        if (raw.startsWith("/") || raw.startsWith("\\")) return null;
        if (raw.length() > 1 && raw.charAt(1) == ':') return null;
        List<String> parts = new ArrayList<>();
        for (String seg : raw.split("/")) {
            if (seg.isEmpty() || ".".equals(seg)) continue;
            if ("..".equals(seg)) return null;
            parts.add(seg);
        }
        if (parts.isEmpty()) return null;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0) sb.append('/');
            sb.append(parts.get(i));
        }
        // 不允许写进隐藏目录（.tmp-* / .trash-*）
        if (parts.get(0).startsWith(".")) return null;
        return sb.toString();
    }

    /* ---------------- 2) 校验 ---------------- */

    private static final class Validation {
        boolean ok;
        String code;
        String message;
        String id;
        int pages;

        static Validation pass(String id, int pages) {
            Validation v = new Validation();
            v.ok = true; v.id = id; v.pages = pages;
            return v;
        }

        static Validation fail(String code, String message) {
            Validation v = new Validation();
            v.ok = false; v.code = code; v.message = message;
            return v;
        }
    }

    private Validation validate(File tmp, String currentAppVersion) throws Exception {
        File fmtFile = new File(tmp, "format.json");
        File manFile = new File(tmp, "manifest.json");
        File seaFile = new File(tmp, "search.json");
        if (!fmtFile.isFile()) return Validation.fail("E_FORMAT", "缺少 format.json");
        if (!manFile.isFile()) return Validation.fail("E_FORMAT", "缺少 manifest.json");
        if (!seaFile.isFile()) return Validation.fail("E_FORMAT", "缺少 search.json");

        JSONObject fmt;
        try { fmt = new JSONObject(Util.readText(fmtFile)); }
        catch (Exception e) { return Validation.fail("E_FORMAT", "format.json 不是合法 JSON"); }

        String format = fmt.optString("format", "");
        if (!"lcr/1".equals(format)) return Validation.fail("E_FORMAT_VERSION", "不支持的包格式：" + format);

        String id = fmt.optString("id", "");
        if (!CourseStore.isValidId(id)) return Validation.fail("E_ID", "课程 id 不合法：" + id);

        String appMin = fmt.optString("appMin", "0.0.0");
        if (compareVersion(appMin, currentAppVersion) > 0) {
            return Validation.fail("E_APP_TOO_OLD", "该课程包需要 App ≥ " + appMin + "（当前 " + currentAppVersion + "）");
        }

        // manifest：页面清单必须都在包里
        JSONObject man;
        try { man = new JSONObject(Util.readText(manFile)); }
        catch (Exception e) { return Validation.fail("E_MANIFEST", "manifest.json 不是合法 JSON"); }

        String prefix = "/courses/" + id + "/";
        int pages = 0;
        JSONArray groups = man.optJSONArray("groups");
        if (groups == null) return Validation.fail("E_MANIFEST", "manifest 缺少 groups");
        for (int gi = 0; gi < groups.length(); gi++) {
            JSONObject g = groups.optJSONObject(gi);
            if (g == null) continue;
            JSONArray items = g.optJSONArray("items");
            if (items == null) continue;
            for (int ii = 0; ii < items.length(); ii++) {
                JSONObject it = items.optJSONObject(ii);
                if (it == null) continue;
                String file = it.optString("file", "");
                if (!file.startsWith(prefix)) return Validation.fail("E_MANIFEST", "页面路径不符合约定：" + file);
                String rel = file.substring(prefix.length());
                File pageFile = new File(tmp, rel);
                if (!pageFile.isFile()) return Validation.fail("E_MANIFEST", "清单里的页面不存在：" + rel);
                pages++;
            }
        }
        if (pages == 0) return Validation.fail("E_MANIFEST", "课程包里没有任何页面");

        // search.json 至少要能解析
        try { new JSONObject(Util.readText(seaFile)); }
        catch (Exception e) { return Validation.fail("E_SEARCH", "search.json 不是合法 JSON"); }

        // 逐页跑安全闸门
        List<File> htmls = new ArrayList<>();
        collectHtml(tmp, htmls);
        for (File h : htmls) {
            List<HtmlGuard.Violation> vs = HtmlGuard.scan(Util.readText(h));
            if (!vs.isEmpty()) {
                String rel = h.getAbsolutePath().substring(tmp.getAbsolutePath().length() + 1);
                return Validation.fail("E_HTML", "页面含不安全内容（" + rel + "）：" + vs.get(0).detail);
            }
        }

        return Validation.pass(id, pages);
    }

    private static void collectHtml(File dir, List<File> out) {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            if (f.isDirectory()) collectHtml(f, out);
            else if (f.getName().toLowerCase(Locale.ROOT).endsWith(".html")) out.add(f);
        }
    }

    /** 比较 x.y.z（缺位按 0 处理）；a>b 返回正数 */
    static int compareVersion(String a, String b) {
        int[] va = parseVer(a), vb = parseVer(b);
        for (int i = 0; i < 3; i++) {
            if (va[i] != vb[i]) return va[i] - vb[i];
        }
        return 0;
    }

    private static int[] parseVer(String s) {
        int[] r = new int[]{0, 0, 0};
        if (s == null) return r;
        String[] parts = s.split("\\.");
        for (int i = 0; i < 3 && i < parts.length; i++) {
            try { r[i] = Integer.parseInt(parts[i].replaceAll("[^0-9].*$", "")); } catch (Exception ignored) { }
        }
        return r;
    }

    /* ---------------- 3) 提交 ---------------- */

    private Result commit(File tmp, String id, String uuid, int pages) throws IOException {
        File target = new File(root, id);
        File trash = new File(root, ".trash-" + uuid);
        boolean hadOld = false;

        if (target.exists()) {
            if (!move(target, trash)) return Result.fail("E_COMMIT", "无法替换旧版本（重命名失败）");
            hadOld = true;
        }
        if (!move(tmp, target)) {
            if (hadOld) move(trash, target); // 回滚
            deleteRecursively(tmp);
            return Result.fail("E_COMMIT", "无法写入课程目录");
        }
        if (hadOld) deleteRecursively(trash);

        store.invalidate();
        return Result.ok(id, pages, hadOld);
    }

    private static boolean move(File from, File to) {
        try {
            try {
                Files.move(from.toPath(), to.toPath(), StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception e) {
                Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
            return true;
        } catch (Exception e) {
            return from.renameTo(to);
        }
    }

    static void deleteRecursively(File f) {
        if (f == null || !f.exists()) return;
        File[] fs = f.listFiles();
        if (fs != null) for (File c : fs) deleteRecursively(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /* ---------------- 工具：读全部字节（给 Activity 用） ---------------- */

    public static long sizeOf(InputStream in) throws IOException {
        long n = 0;
        byte[] buf = new byte[8192];
        int r;
        while ((r = in.read(buf)) > 0) n += r;
        return n;
    }

    @SuppressWarnings("unused")
    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int r;
        while ((r = in.read(buf)) > 0) bos.write(buf, 0, r);
        return bos.toByteArray();
    }
}
