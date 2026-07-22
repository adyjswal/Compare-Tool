package com.adityakumar.engine;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public final class Sorter {
    private Sorter() {}

    public static List<String> sortLines(List<String> lines, SortOptions options) {
        List<String> result = new ArrayList<>(lines);
        Comparator<String> cmp;
        if (options.mode == SortOptions.Mode.NUMERIC) {
            // Numeric mode: parse each key as double; non-parseable keys sort AFTER numeric ones.
            // This matches the Kotlin port's toDoubleOrNull() semantics.
            cmp = (a, b) -> compareNumericKeys(extractRawKey(a, options), extractRawKey(b, options));
        } else {
            // Alphabetical mode: compare as strings (with optional case-fold and trim).
            cmp = Comparator.comparing(line -> extractStringKey(line, options));
        }
        if (options.direction == SortOptions.Direction.DESC) cmp = cmp.reversed();
        result.sort(cmp);
        return result;
    }

    /**
     * Extract the raw sort key for a line: split by column if configured, apply trim.
     * No case conversion — used directly for numeric comparison.
     */
    private static String extractRawKey(String line, SortOptions opts) {
        String raw;
        if (opts.column != null) {
            String[] parts = line.split(java.util.regex.Pattern.quote(opts.column.delimiter()), -1);
            int idx = opts.column.index() - 1;
            raw = (idx >= 0 && idx < parts.length) ? parts[idx] : "";
        } else {
            raw = line;
        }
        return opts.trim ? raw.trim() : raw;
    }

    /**
     * Extract the string sort key: raw key + optional case-fold.
     * Used for alphabetical comparison.
     */
    private static String extractStringKey(String line, SortOptions opts) {
        String key = extractRawKey(line, opts);
        return opts.caseInsensitive ? key.toLowerCase() : key;
    }

    /**
     * Compare two raw keys numerically (port of Kotlin's {@code toDoubleOrNull()} logic):
     * <ul>
     *   <li>Both parse as double → compare by double value</li>
     *   <li>Only {@code a} is numeric → {@code a} comes first (numeric before non-numeric)</li>
     *   <li>Only {@code b} is numeric → {@code b} comes first</li>
     *   <li>Neither is numeric → alphabetical comparison of the raw strings</li>
     * </ul>
     */
    private static int compareNumericKeys(String a, String b) {
        Double da = tryParseDouble(a);
        Double db = tryParseDouble(b);
        if (da != null && db != null) return Double.compare(da, db);
        if (da != null) return -1;   // numeric a before non-numeric b
        if (db != null) return  1;   // non-numeric a after numeric b
        return a.compareTo(b);       // both non-numeric: alphabetical fallback
    }

    /** Parse {@code s} as a double, returning {@code null} if it is not a valid number. */
    private static Double tryParseDouble(String s) {
        if (s == null || s.isEmpty()) return null;
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
