package com.adityakumar.engine;

import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

public final class Reader {
    private Reader() {}

    public static List<String> readLines(String path) throws IOException {
        List<String> lines = Files.readAllLines(Paths.get(path), StandardCharsets.UTF_8);
        // Drop single trailing empty line (matches engine behaviour for files ending with newline)
        if (!lines.isEmpty() && lines.get(lines.size() - 1).isEmpty()) {
            return lines.subList(0, lines.size() - 1);
        }
        return lines;
    }

    public static boolean isProbablyBinary(String path) throws IOException {
        byte[] buf = new byte[8000];
        try (FileInputStream fis = new FileInputStream(path)) {
            int read = fis.read(buf);
            for (int i = 0; i < read; i++) {
                if (buf[i] == 0) return true;
            }
        }
        return false;
    }
}
