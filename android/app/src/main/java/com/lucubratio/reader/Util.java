package com.lucubratio.reader;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** 小工具（零依赖） */
public final class Util {

    private Util() {}

    /** 读文本文件（UTF-8），带大小上限，避免被超大文件拖死 */
    public static String readText(File f) throws IOException {
        final long MAX = 4L * 1024 * 1024;
        if (f.length() > MAX) throw new IOException("文件过大: " + f.getName());
        try (InputStream is = new FileInputStream(f)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream((int) Math.min(f.length(), 64 * 1024));
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
