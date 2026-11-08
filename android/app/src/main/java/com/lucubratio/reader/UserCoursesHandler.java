package com.lucubratio.reader;

import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * /courses/ → filesDir/courses/（用户导入的课程）
 *
 * 两个关键点（都是踩过的坑）：
 * 1) WebViewAssetLoader 的 PathHandler 是**按注册顺序**匹配的，不是最长前缀，
 *    所以 MainActivity 里 "/courses/" 必须注册在 "/" 之前。
 * 2) 缺文件**不能返回 null**——返回 null 会让 WebView 回落去发起真正的网络请求
 *    （本 App 无 INTERNET 权限，只会白等 + 错误页）。这里统一返回 404 空响应。
 */
public final class UserCoursesHandler implements WebViewAssetLoader.PathHandler {

    private final CourseStore store;

    public UserCoursesHandler(CourseStore store) {
        this.store = store;
    }

    @Override
    public WebResourceResponse handle(String path) {
        String rel = path == null ? "" : path;
        while (rel.startsWith("/")) rel = rel.substring(1);

        // 目录请求（/courses/）直接给注册表，便于首页一次拿到全部课程
        if (rel.isEmpty() || rel.equals("index.json")) {
            byte[] body = store.indexJson().getBytes(StandardCharsets.UTF_8);
            return response("application/json", body);
        }

        File f = store.resolve(rel);
        if (f == null || !f.isFile()) return notFound();

        try {
            InputStream is = new FileInputStream(f);
            String mime = Mime.of(f.getName());
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(
                    mime,
                    Mime.isTextual(mime) ? "utf-8" : null,
                    200, "OK", headers, is);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse response(String mime, byte[] body) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        return new WebResourceResponse(mime, "utf-8", 200, "OK", headers, new ByteArrayInputStream(body));
    }

    /** 404 空响应：既告诉 WebView "没有"，又避免它去走网络 */
    private static WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        return new WebResourceResponse(
                "text/plain", "utf-8", 404, "Not Found", headers,
                new ByteArrayInputStream(new byte[0]));
    }
}
