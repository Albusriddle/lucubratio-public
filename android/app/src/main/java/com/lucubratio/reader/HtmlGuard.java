package com.lucubratio.reader;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 课程包 HTML 安全闸门（标签级扫描）。
 *
 * 与 scripts/lib/htmlguard.mjs 保持同一套规则：正则挡不住"无引号属性 / 单引号 /
 * 自闭合 / 实体编码"这些写法，所以这里同样按 HTML 语法把标签与属性真正切出来再判。
 *
 * 允许：<script type="text/plain">（Mermaid 源码）、<script src="/shell/*.js">、
 *       <link href="/shell/*.css">、内联 <style>（不得引外部资源）。
 * 拒绝：其它脚本、on* 属性、外链/可执行 URL、iframe/object/embed/base 等。
 */
public final class HtmlGuard {

    private static final Set<String> FORBIDDEN_TAGS = new HashSet<>(Arrays.asList(
            "iframe", "frame", "frameset", "object", "embed", "applet", "base", "portal"));
    private static final Set<String> URL_ATTRS = new HashSet<>(Arrays.asList(
            "src", "href", "poster", "background", "data", "formaction", "action", "srcset", "xlink:href", "manifest"));

    private HtmlGuard() {}

    /** 一条违规 */
    public static final class Violation {
        public final String rule;
        public final String detail;
        Violation(String rule, String detail) { this.rule = rule; this.detail = detail; }
        @Override public String toString() { return rule + ": " + detail; }
    }

    /** 扫描一段 HTML，返回违规列表（空 = 通过） */
    public static List<Violation> scan(String html) {
        List<Violation> out = new ArrayList<>();
        if (html == null) return out;
        final int n = html.length();
        int i = 0;

        while (i < n) {
            int lt = html.indexOf('<', i);
            if (lt < 0) break;

            // 注释
            if (html.startsWith("<!--", lt)) {
                int end = html.indexOf("-->", lt + 4);
                i = end < 0 ? n : end + 3;
                continue;
            }
            // <!doctype> / <![CDATA[ / <?xml
            if (lt + 1 < n && (html.charAt(lt + 1) == '!' || html.charAt(lt + 1) == '?')) {
                int end = html.indexOf('>', lt);
                i = end < 0 ? n : end + 1;
                continue;
            }
            // 结束标签
            if (lt + 1 < n && html.charAt(lt + 1) == '/') {
                int end = html.indexOf('>', lt);
                i = end < 0 ? n : end + 1;
                continue;
            }
            // 开标签
            int p = lt + 1;
            if (p >= n || !isNameStart(html.charAt(p))) { i = lt + 1; continue; }
            int nameEnd = p;
            while (nameEnd < n && isNameChar(html.charAt(nameEnd))) nameEnd++;
            String tag = html.substring(p, nameEnd).toLowerCase(Locale.ROOT);

            Attrs attrs = parseAttrs(html, nameEnd);
            String afterTag = String.valueOf(attrs.next);

            /* 规则 1：禁止的标签 */
            if (FORBIDDEN_TAGS.contains(tag)) out.add(new Violation("forbidden-tag", "<" + tag + "> 不允许"));

            /* 规则 2：meta refresh */
            if ("meta".equals(tag)) {
                String he = decode(attrs.get("http-equiv")).trim().toLowerCase(Locale.ROOT);
                if ("refresh".equals(he)) out.add(new Violation("meta-refresh", "meta http-equiv=refresh"));
            }

            /* 规则 3：on* 事件属性 */
            for (String[] a : attrs.list) {
                if (a[0].startsWith("on") && a[0].length() > 2) {
                    out.add(new Violation("inline-handler", "属性 " + a[0] + "="));
                }
            }

            /* 规则 4：URL 属性不得指向外部/可执行 */
            for (String[] a : attrs.list) {
                if (!URL_ATTRS.contains(a[0])) continue;
                if (isBadUrl(a[1])) out.add(new Violation("external-url", a[0] + "=\"" + trunc(decode(a[1])) + "\""));
            }

            /* 规则 5：link 只允许 /shell/ */
            if ("link".equals(tag)) {
                String href = decode(attrs.get("href")).trim();
                if (!href.startsWith("/shell/")) out.add(new Violation("bad-link", "link href=\"" + trunc(href) + "\""));
            }

            /* 规则 6：script 白名单 */
            if ("script".equals(tag)) {
                String src = decode(attrs.get("src")).trim();
                String type = decode(attrs.get("type")).trim().toLowerCase(Locale.ROOT);
                if (!src.isEmpty()) {
                    if (!src.startsWith("/shell/")) out.add(new Violation("bad-script-src", "script src=\"" + trunc(src) + "\""));
                } else if (!"text/plain".equals(type)) {
                    out.add(new Violation("inline-script", "内联 <script>（Mermaid 源码请用 type=\"text/plain\"）"));
                }
                int close = html.toLowerCase(Locale.ROOT).indexOf("</script", attrs.next);
                i = close < 0 ? n : close;
                continue;
            }

            /* 规则 7：style 原文里不得引外部资源 */
            if ("style".equals(tag)) {
                int close = html.toLowerCase(Locale.ROOT).indexOf("</style", attrs.next);
                String css = html.substring(attrs.next, close < 0 ? n : close);
                String lower = css.toLowerCase(Locale.ROOT);
                if (lower.contains("@import")) out.add(new Violation("style-import", "<style> 内 @import"));
                int k = 0;
                while (true) {
                    int u = lower.indexOf("url(", k);
                    if (u < 0) break;
                    int start = u + 4;
                    while (start < css.length() && (css.charAt(start) == '\'' || css.charAt(start) == '"' || Character.isWhitespace(css.charAt(start)))) start++;
                    int e = start;
                    while (e < css.length() && css.charAt(e) != ')' && css.charAt(e) != '\'' && css.charAt(e) != '"') e++;
                    String url = css.substring(start, Math.min(e, css.length()));
                    if (isBadUrl(url)) out.add(new Violation("style-url", "<style> 内 url(" + trunc(decode(url)) + ")"));
                    k = u + 4;
                }
                i = close < 0 ? n : close;
                continue;
            }

            if ("textarea".equals(tag) || "title".equals(tag)) {
                int close = html.toLowerCase(Locale.ROOT).indexOf("</" + tag, attrs.next);
                i = close < 0 ? n : close;
                continue;
            }

            i = attrs.next;
        }
        return out;
    }

    /* ---------------- 属性解析 ---------------- */

    private static final class Attrs {
        final List<String[]> list = new ArrayList<>();
        int next;

        String get(String name) {
            for (String[] a : list) if (a[0].equals(name)) return a[1];
            return "";
        }
    }

    private static Attrs parseAttrs(String html, int from) {
        Attrs res = new Attrs();
        int j = from;
        int n = html.length();
        while (j < n) {
            while (j < n && Character.isWhitespace(html.charAt(j))) j++;
            if (j >= n) break;
            char c = html.charAt(j);
            if (c == '>') { j++; break; }
            if (c == '/' && j + 1 < n && html.charAt(j + 1) == '>') { j += 2; break; }

            int k = j;
            while (k < n && !isAttrStop(html.charAt(k))) k++;
            if (k == j) { j++; continue; }
            String name = html.substring(j, k).toLowerCase(Locale.ROOT);
            j = k;
            while (j < n && Character.isWhitespace(html.charAt(j))) j++;

            String value = "";
            if (j < n && html.charAt(j) == '=') {
                j++;
                while (j < n && Character.isWhitespace(html.charAt(j))) j++;
                if (j < n && (html.charAt(j) == '"' || html.charAt(j) == '\'')) {
                    char q = html.charAt(j);
                    int end = html.indexOf(q, j + 1);
                    value = html.substring(j + 1, end < 0 ? n : end);
                    j = end < 0 ? n : end + 1;
                } else {
                    int e = j;
                    while (e < n && !Character.isWhitespace(html.charAt(e)) && html.charAt(e) != '>') e++;
                    value = html.substring(j, e);
                    j = e;
                }
            }
            res.list.add(new String[]{name, value});
        }
        res.next = j;
        return res;
    }

    private static boolean isNameStart(char c) {
        return Character.isLetter(c);
    }

    private static boolean isNameChar(char c) {
        return Character.isLetterOrDigit(c) || c == ':' || c == '-' || c == '_';
    }

    private static boolean isAttrStop(char c) {
        return Character.isWhitespace(c) || c == '=' || c == '/' || c == '>';
    }

    /* ---------------- 工具 ---------------- */

    /** 解码常见 HTML 实体（与 JS 侧一致，只解一层） */
    static String decode(String s) {
        if (s == null || s.isEmpty()) return "";
        StringBuilder sb = new StringBuilder(s.length());
        int i = 0;
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c != '&') { sb.append(c); i++; continue; }
            int semi = s.indexOf(';', i + 1);
            if (semi < 0 || semi - i > 10) { sb.append(c); i++; continue; }
            String ent = s.substring(i + 1, semi);
            String decoded = decodeEntity(ent);
            if (decoded == null) { sb.append(c); i++; continue; }
            sb.append(decoded);
            i = semi + 1;
        }
        return sb.toString();
    }

    private static String decodeEntity(String ent) {
        if (ent.startsWith("#x") || ent.startsWith("#X")) {
            try { return new String(Character.toChars(Integer.parseInt(ent.substring(2), 16))); }
            catch (Exception e) { return null; }
        }
        if (ent.startsWith("#")) {
            try { return new String(Character.toChars(Integer.parseInt(ent.substring(1)))); }
            catch (Exception e) { return null; }
        }
        switch (ent.toLowerCase(Locale.ROOT)) {
            case "amp": return "&";
            case "lt": return "<";
            case "gt": return ">";
            case "quot": return "\"";
            case "apos": return "'";
            case "colon": return ":";
            case "sol": return "/";
            case "tab": return "\t";
            case "newline": return "\n";
            case "nbsp": return " ";
            default: return null;
        }
    }

    /** 归一化后判断是否是"外部/可执行"资源 */
    static boolean isBadUrl(String raw) {
        String v = decode(raw).replaceAll("[\\u0000-\\u0020\\u00a0]", "").toLowerCase(Locale.ROOT);
        if (v.isEmpty()) return false;
        if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true;
        if (v.startsWith("data:") && (v.startsWith("data:text/html") || v.startsWith("data:image/svg"))) return true;
        return v.startsWith("http://") || v.startsWith("https://") || v.startsWith("//");
    }

    private static String trunc(String s) {
        if (s == null) return "";
        return s.length() <= 60 ? s : s.substring(0, 60) + "…";
    }
}
