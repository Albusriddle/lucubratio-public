package com.lucubratio.reader;

import java.util.Locale;

/**
 * 按扩展名猜 MIME。
 * assets（内置内容）与用户课程目录共用同一份规则，避免"内置能显示、导入的图裂了"。
 */
public final class Mime {

    private Mime() {}

    public static String of(String path) {
        String lower = path == null ? "" : path.toLowerCase(Locale.ROOT);
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

    /** 文本类资源必须显式给编码，否则中文会乱码 */
    public static boolean isTextual(String mime) {
        return mime.startsWith("text/")
                || mime.contains("javascript")
                || mime.contains("json")
                || mime.contains("svg");
    }
}
