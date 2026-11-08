package com.lucubratio.reader;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * 已导入课程的注册表 = 磁盘目录本身。
 *
 * 设计取舍：不建 IndexedDB 表、也不落 index.json 文件——
 * filesDir/courses/ 下每个子目录就是一门课（含 format.json），
 * 扫描目录 + 内存缓存即可，永远不存在"注册表和实际内容对不上"的状态。
 */
public final class CourseStore {

    /** 一门课的元信息（来自 format.json） */
    public static final class Course {
        public final String id;
        public final String title;
        public final String version;
        public final int pages;
        public final int questions;
        public final long bytes;
        public final long installedAt;

        Course(String id, String title, String version, int pages, int questions, long bytes, long installedAt) {
            this.id = id;
            this.title = title;
            this.version = version;
            this.pages = pages;
            this.questions = questions;
            this.bytes = bytes;
            this.installedAt = installedAt;
        }
    }

    private final File root;
    private volatile List<Course> cache;

    public CourseStore(Context ctx) {
        this.root = new File(ctx.getApplicationContext().getFilesDir(), "courses");
    }

    public File root() {
        return root;
    }

    /** 课程 id 只允许小写字母/数字/连字符（与打包器一致） */
    public static boolean isValidId(String id) {
        if (id == null || id.isEmpty() || id.length() > 64) return false;
        for (int i = 0; i < id.length(); i++) {
            char c = id.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
            if (!ok) return false;
        }
        return id.charAt(0) != '-';
    }

    /** 导入/删除之后调用，让下次读取重新扫描 */
    public void invalidate() {
        cache = null;
    }

    public synchronized List<Course> list() {
        List<Course> c = cache;
        if (c != null) return c;

        List<Course> out = new ArrayList<>();
        File[] dirs = root.listFiles();
        if (dirs != null) {
            for (File d : dirs) {
                // 跳过临时目录（.tmp-*）与隐藏文件
                if (!d.isDirectory() || d.getName().startsWith(".")) continue;
                Course course = readOne(d);
                if (course != null) out.add(course);
            }
        }
        Collections.sort(out, new Comparator<Course>() {
            @Override
            public int compare(Course a, Course b) {
                return Long.compare(a.installedAt, b.installedAt);
            }
        });
        cache = Collections.unmodifiableList(out);
        return cache;
    }

    private Course readOne(File dir) {
        File meta = new File(dir, "format.json");
        if (!meta.isFile()) return null;
        try {
            String text = Util.readText(meta);
            JSONObject o = new JSONObject(text);
            String id = o.optString("id", dir.getName());
            // 目录名与 format.id 必须一致，否则视为损坏（避免路径与标识打架）
            if (!id.equals(dir.getName()) || !isValidId(id)) return null;
            return new Course(
                    id,
                    o.optString("title", id),
                    o.optString("version", "0"),
                    o.optInt("pages", 0),
                    o.optInt("questions", 0),
                    o.optLong("bytes", 0),
                    dir.lastModified()
            );
        } catch (IOException | JSONException e) {
            return null; // 损坏的课程直接忽略，不影响其它课程
        }
    }

    /** /courses/index.json 的内容 */
    public String indexJson() {
        JSONObject rootObj = new JSONObject();
        JSONArray arr = new JSONArray();
        try {
            for (Course c : list()) {
                JSONObject o = new JSONObject();
                o.put("id", c.id);
                o.put("title", c.title);
                o.put("version", c.version);
                o.put("pages", c.pages);
                o.put("questions", c.questions);
                o.put("bytes", c.bytes);
                o.put("installedAt", c.installedAt);
                arr.put(o);
            }
            rootObj.put("v", 1);
            rootObj.put("courses", arr);
        } catch (JSONException e) {
            // 理论上不会发生（都是基础类型），兜底返回空表
            return "{\"v\":1,\"courses\":[]}";
        }
        return rootObj.toString();
    }

    /** 删除一门课：目录先改名到 .trash-*，再递归删除；失败返回 false */
    public boolean delete(String id) {
        if (!isValidId(id)) return false;
        File dir = new File(root, id);
        if (!dir.isDirectory()) return false;
        File trash = new File(root, ".trash-" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12));
        if (!dir.renameTo(trash)) return false;
        CourseImporter.deleteRecursively(trash);
        invalidate();
        return true;
    }

    /**
     * 清理上次异常退出留下的临时目录（.tmp-* 与 .trash-*）。
     * 在启动时调用一次；正常导入/删除后这些目录本来就不存在。
     */
    public void cleanupTemp() {
        File[] fs = root.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            String n = f.getName();
            if (f.isDirectory() && (n.startsWith(".tmp-") || n.startsWith(".trash-"))) {
                CourseImporter.deleteRecursively(f);
            }
        }
        invalidate();
    }

    /**
     * 把 /courses/ 之后的相对路径解析成真实文件。
     * 任何越界（.. / 绝对路径 / 反斜杠 / NUL）都返回 null。
     */
    public File resolve(String relPath) {
        if (relPath == null) return null;
        String rel = relPath;
        while (rel.startsWith("/")) rel = rel.substring(1);
        if (rel.isEmpty()) return null;
        if (rel.indexOf('\0') >= 0 || rel.indexOf('\\') >= 0) return null;
        for (String seg : rel.split("/")) {
            if (seg.isEmpty() || ".".equals(seg) || "..".equals(seg)) return null;
        }
        File f = new File(root, rel);
        try {
            String rootPath = root.getCanonicalPath();
            String fPath = f.getCanonicalPath();
            if (!fPath.equals(rootPath) && !fPath.startsWith(rootPath + File.separator)) return null;
        } catch (IOException e) {
            return null;
        }
        return f;
    }
}
