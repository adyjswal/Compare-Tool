package com.adityakumar.engine;

import java.util.*;
import java.util.function.Function;

public final class Differ {
    private Differ() {}

    public static DiffResult diffLines(List<String> left, List<String> right, DiffOptions options) {
        Function<String, String> norm = line -> {
            String s = options.trim ? line.trim() : line;
            return options.caseInsensitive ? s.toLowerCase() : s;
        };
        if (options.key != null) return diffByKey(left, right, options.key, norm);
        return diffWholeLine(left, right, norm);
    }

    private static DiffResult diffWholeLine(List<String> left, List<String> right, Function<String, String> norm) {
        List<String> lNorm = left.stream().map(norm).toList();
        List<String> rNorm = right.stream().map(norm).toList();
        List<String> lcs   = computeLCS(lNorm, rNorm);

        List<DiffRow> rows = new ArrayList<>();
        int li = 0, ri = 0, ki = 0;
        while (li < left.size() || ri < right.size()) {
            if (ki < lcs.size() && li < left.size() && ri < right.size()
                    && lNorm.get(li).equals(lcs.get(ki)) && rNorm.get(ri).equals(lcs.get(ki))) {
                rows.add(new DiffRow(DiffStatus.UNCHANGED, left.get(li), right.get(ri)));
                li++; ri++; ki++;
            } else if (li < left.size() && (ki >= lcs.size() || !lNorm.get(li).equals(lcs.get(ki)))) {
                rows.add(new DiffRow(DiffStatus.REMOVED, left.get(li), null));
                li++;
            } else {
                rows.add(new DiffRow(DiffStatus.ADDED, null, right.get(ri)));
                ri++;
            }
        }
        return buildResult(rows);
    }

    private static DiffResult diffByKey(List<String> left, List<String> right, ColumnSpec key, Function<String, String> norm) {
        Function<String, String> getKey = line -> {
            String[] parts = line.split(java.util.regex.Pattern.quote(key.delimiter()), -1);
            int idx = key.index() - 1;
            return (idx >= 0 && idx < parts.length) ? norm.apply(parts[idx]) : norm.apply(line);
        };
        Map<String, String> leftMap  = new LinkedHashMap<>(); left.forEach(l  -> leftMap.put(getKey.apply(l),  l));
        Map<String, String> rightMap = new LinkedHashMap<>(); right.forEach(r -> rightMap.put(getKey.apply(r), r));

        List<String> allKeys = new ArrayList<>(leftMap.keySet());
        rightMap.keySet().stream().filter(k -> !leftMap.containsKey(k)).forEach(allKeys::add);

        List<DiffRow> rows = new ArrayList<>();
        for (String k : allKeys) {
            String l = leftMap.get(k), r = rightMap.get(k);
            if (l != null && r != null) {
                rows.add(new DiffRow(norm.apply(l).equals(norm.apply(r)) ? DiffStatus.UNCHANGED : DiffStatus.CHANGED, l, r));
            } else if (l != null) {
                rows.add(new DiffRow(DiffStatus.REMOVED, l, null));
            } else {
                rows.add(new DiffRow(DiffStatus.ADDED, null, r));
            }
        }
        return buildResult(rows);
    }

    private static List<String> computeLCS(List<String> a, List<String> b) {
        int m = a.size(), n = b.size();
        if ((long) m * n > 5_000_000L) return Collections.emptyList(); // guard against O(m*n) memory
        int[][] dp = new int[m + 1][n + 1];
        for (int i = 1; i <= m; i++)
            for (int j = 1; j <= n; j++)
                dp[i][j] = a.get(i-1).equals(b.get(j-1)) ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
        List<String> lcs = new ArrayList<>();
        int i = m, j = n;
        while (i > 0 && j > 0) {
            if (a.get(i-1).equals(b.get(j-1))) { lcs.add(0, a.get(i-1)); i--; j--; }
            else if (dp[i-1][j] > dp[i][j-1]) i--; else j--;
        }
        return lcs;
    }

    private static DiffResult buildResult(List<DiffRow> rows) {
        int unchanged = 0, added = 0, removed = 0, changed = 0;
        for (DiffRow r : rows) switch (r.status()) {
            case UNCHANGED -> unchanged++;
            case ADDED     -> added++;
            case REMOVED   -> removed++;
            case CHANGED   -> changed++;
        }
        return new DiffResult(rows, new DiffSummary(unchanged, added, removed, changed, rows.size()));
    }
}
