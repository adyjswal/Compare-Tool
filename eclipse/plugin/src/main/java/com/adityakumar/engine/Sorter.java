package com.adityakumar.engine;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public final class Sorter {
    private Sorter() {}

    public static List<String> sortLines(List<String> lines, SortOptions options) {
        List<String> result = new ArrayList<>(lines);
        Comparator<String> cmp = Comparator.comparing(line -> extractKey(line, options));
        if (options.direction == SortOptions.Direction.DESC) cmp = cmp.reversed();
        result.sort(cmp);
        return result;
    }

    private static String extractKey(String line, SortOptions opts) {
        String raw;
        if (opts.column != null) {
            String[] parts = line.split(java.util.regex.Pattern.quote(opts.column.delimiter()), -1);
            int idx = opts.column.index() - 1;
            raw = (idx >= 0 && idx < parts.length) ? parts[idx] : "";
        } else {
            raw = line;
        }
        String key = opts.trim ? raw.trim() : raw;
        return opts.caseInsensitive ? key.toLowerCase() : key;
    }
}
