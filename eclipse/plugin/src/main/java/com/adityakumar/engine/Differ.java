package com.adityakumar.engine;

import java.util.*;
import java.util.regex.Pattern;

/**
 * Comparing two line lists — a faithful port of the TypeScript engine
 * (engine/src/differ.ts) and its Kotlin twin. Three behaviours:
 *
 *  - Whole-line "positional" (default): compare files in their existing order.
 *    A removed line paired with a similar added line becomes one {@code changed} row.
 *  - Whole-line "set": same comparison, no pairing. Use after sorting.
 *  - Key column: rows matched by a delimited key column; same key + different
 *    content = a {@code changed} row.
 *
 * The whole-line diff is a <b>patience diff</b> over interned line ids, so it
 * stays fast on very large (200k–1M line) files instead of collapsing to an
 * all-removed + all-added dump the way a naive O(m*n) LCS does above a size cap.
 */
public final class Differ {
    private Differ() {}

    // Below this combined segment size we fall back to an exact LCS diff; above
    // it, an anchorless block is emitted as a plain removed + added ("replace").
    private static final int BASE_LCS_LIMIT = 2000;
    // Guard against pathological anchor nesting; deeper segments use the base path.
    private static final int MAX_DEPTH = 4000;
    // A removed+added pair is only reported as `changed` when at least this similar.
    private static final double SIMILARITY_THRESHOLD = 0.6;

    private static final int EQUAL = 0, DELETE = 1, INSERT = 2;

    public static DiffResult diffLines(List<String> left, List<String> right, DiffOptions options) {
        Normalizer normalize = new Normalizer(options.trim, options.caseInsensitive);
        List<DiffRow> rows = options.key != null
                ? diffByKey(left, right, options.key, normalize)
                : diffWholeLine(left, right, options.mode, normalize, options.pairChanged);
        return buildResult(rows);
    }

    /* ------------------------------------------------------------------ *
     * Whole-line comparison (patience diff over interned lines)
     * ------------------------------------------------------------------ */

    /** A run of the diff: op is EQUAL/DELETE/INSERT, n is how many lines. */
    private static final class Op {
        final int op; int n;
        Op(int op, int n) { this.op = op; this.n = n; }
    }

    private sealed interface Work permits OpWork, RangeWork {}
    private record OpWork(int op, int n) implements Work {}
    private record RangeWork(int al, int ah, int bl, int bh, int depth) implements Work {}

    private static List<DiffRow> diffWholeLine(
            List<String> left, List<String> right, String mode,
            Normalizer normalize, boolean pairChanged) {
        Map<String, Integer> dict = new HashMap<>();
        int[] a = new int[left.size()];
        int[] b = new int[right.size()];
        for (int i = 0; i < left.size(); i++) a[i] = intern(dict, normalize.apply(left.get(i)));
        for (int i = 0; i < right.size(); i++) b[i] = intern(dict, normalize.apply(right.get(i)));

        List<Op> ops = diffIds(a, b);
        return "positional".equals(mode)
                ? reconstructPositional(ops, left, right, pairChanged)
                : reconstructSet(ops, left, right);
    }

    private static int intern(Map<String, Integer> dict, String key) {
        Integer id = dict.get(key);
        if (id == null) { id = dict.size(); dict.put(key, id); }
        return id;
    }

    /** Append a run, coalescing with the previous run of the same kind. */
    private static void pushOp(List<Op> ops, int op, int n) {
        if (n <= 0) return;
        if (!ops.isEmpty()) {
            Op last = ops.get(ops.size() - 1);
            if (last.op == op) { last.n += n; return; }
        }
        ops.add(new Op(op, n));
    }

    /** Patience-diff two id arrays into an ordered list of EQUAL/DELETE/INSERT runs. */
    private static List<Op> diffIds(int[] a, int[] b) {
        List<Op> ops = new ArrayList<>();
        Deque<Work> stack = new ArrayDeque<>();
        stack.addLast(new RangeWork(0, a.length, 0, b.length, 0));

        while (!stack.isEmpty()) {
            Work item = stack.removeLast();
            if (item instanceof OpWork ow) { pushOp(ops, ow.op(), ow.n()); continue; }
            RangeWork r = (RangeWork) item;
            int al = r.al(), ah = r.ah(), bl = r.bl(), bh = r.bh();
            List<Work> parts = new ArrayList<>();

            int prefix = 0;
            while (al < ah && bl < bh && a[al] == b[bl]) { al++; bl++; prefix++; }
            if (prefix > 0) parts.add(new OpWork(EQUAL, prefix));

            int suffix = 0;
            while (ah > al && bh > bl && a[ah - 1] == b[bh - 1]) { ah--; bh--; suffix++; }

            if (al == ah) {
                if (bl < bh) parts.add(new OpWork(INSERT, bh - bl));
            } else if (bl == bh) {
                parts.add(new OpWork(DELETE, ah - al));
            } else {
                List<int[]> anchors = r.depth() <= MAX_DEPTH
                        ? patienceAnchors(a, b, al, ah, bl, bh)
                        : List.<int[]>of();
                if (anchors.isEmpty()) {
                    baseDiff(a, b, al, ah, bl, bh, parts);
                } else {
                    int pa = al, pb = bl;
                    for (int[] anc : anchors) {
                        parts.add(new RangeWork(pa, anc[0], pb, anc[1], r.depth() + 1));
                        parts.add(new OpWork(EQUAL, 1));
                        pa = anc[0] + 1; pb = anc[1] + 1;
                    }
                    parts.add(new RangeWork(pa, ah, pb, bh, r.depth() + 1));
                }
            }

            if (suffix > 0) parts.add(new OpWork(EQUAL, suffix));

            for (int i = parts.size() - 1; i >= 0; i--) stack.addLast(parts.get(i));
        }
        return ops;
    }

    /**
     * Diff a small (or anchorless) segment. Tiny segments go through an exact LCS
     * diff; oversized anchorless blocks are emitted as a plain removed + added.
     */
    private static void baseDiff(int[] a, int[] b, int al, int ah, int bl, int bh, List<Work> parts) {
        int leftLen = ah - al, rightLen = bh - bl;
        if (leftLen + rightLen > BASE_LCS_LIMIT) {
            if (leftLen > 0) parts.add(new OpWork(DELETE, leftLen));
            if (rightLen > 0) parts.add(new OpWork(INSERT, rightLen));
            return;
        }
        for (Op o : lcsDiff(Arrays.copyOfRange(a, al, ah), Arrays.copyOfRange(b, bl, bh))) {
            parts.add(new OpWork(o.op, o.n));
        }
    }

    /** Exact LCS diff of two small id arrays → coalesced EQUAL/DELETE/INSERT runs. */
    private static List<Op> lcsDiff(int[] a, int[] b) {
        int m = a.length, n = b.length;
        if (m == 0) return n > 0 ? List.of(new Op(INSERT, n)) : List.of();
        if (n == 0) return List.of(new Op(DELETE, m));

        int[][] dp = new int[m + 1][n + 1];
        for (int i = 1; i <= m; i++)
            for (int j = 1; j <= n; j++)
                dp[i][j] = a[i - 1] == b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

        List<Op> rev = new ArrayList<>();
        int i = m, j = n;
        while (i > 0 && j > 0) {
            if (a[i - 1] == b[j - 1]) { rev.add(new Op(EQUAL, 1)); i--; j--; }
            else if (dp[i - 1][j] >= dp[i][j - 1]) { rev.add(new Op(DELETE, 1)); i--; }
            else { rev.add(new Op(INSERT, 1)); j--; }
        }
        while (i > 0) { rev.add(new Op(DELETE, 1)); i--; }
        while (j > 0) { rev.add(new Op(INSERT, 1)); j--; }
        Collections.reverse(rev);

        List<Op> out = new ArrayList<>();
        for (Op o : rev) {
            if (!out.isEmpty()) {
                Op last = out.get(out.size() - 1);
                if (last.op == o.op) { last.n += o.n; continue; }
            }
            out.add(new Op(o.op, o.n));
        }
        return out;
    }

    /** Anchor pairs [leftPos, rightPos]: lines occurring exactly once on both sides. */
    private static List<int[]> patienceAnchors(int[] a, int[] b, int al, int ah, int bl, int bh) {
        Map<Integer, Integer> leftPos = uniquePositions(a, al, ah);
        Map<Integer, Integer> rightPos = uniquePositions(b, bl, bh);

        List<int[]> pairs = new ArrayList<>();
        for (Map.Entry<Integer, Integer> e : leftPos.entrySet()) {
            int lp = e.getValue();
            Integer rp = rightPos.get(e.getKey());
            if (rp != null && rp >= 0 && lp >= 0) pairs.add(new int[]{lp, rp});
        }
        if (pairs.isEmpty()) return List.of();
        pairs.sort(Comparator.comparingInt(p -> p[0]));
        return longestIncreasingByRight(pairs);
    }

    /** Map id → its single position in [lo,hi), or -1 if it occurs more than once. */
    private static Map<Integer, Integer> uniquePositions(int[] ids, int lo, int hi) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = lo; i < hi; i++) {
            int id = ids[i];
            seen.put(id, seen.containsKey(id) ? -1 : i);
        }
        return seen;
    }

    /** Longest subsequence of pairs (pre-sorted by left) whose right pos increases. */
    private static List<int[]> longestIncreasingByRight(List<int[]> pairs) {
        int n = pairs.size();
        int[] prev = new int[n];
        Arrays.fill(prev, -1);
        List<Integer> tails = new ArrayList<>(); // tails[k] = index of smallest tail of an LIS of length k+1

        for (int i = 0; i < n; i++) {
            int value = pairs.get(i)[1];
            int lo = 0, hi = tails.size();
            while (lo < hi) {
                int mid = (lo + hi) >>> 1;
                if (pairs.get(tails.get(mid))[1] < value) lo = mid + 1; else hi = mid;
            }
            if (lo > 0) prev[i] = tails.get(lo - 1);
            if (lo == tails.size()) tails.add(i); else tails.set(lo, i);
        }

        List<int[]> result = new ArrayList<>();
        int k = tails.isEmpty() ? -1 : tails.get(tails.size() - 1);
        while (k != -1) { result.add(pairs.get(k)); k = prev[k]; }
        Collections.reverse(result);
        return result;
    }

    /** "set" mode: emit each run as-is (no pairing). */
    private static List<DiffRow> reconstructSet(List<Op> ops, List<String> left, List<String> right) {
        List<DiffRow> rows = new ArrayList<>();
        int lc = 0, rc = 0;
        for (Op o : ops) {
            if (o.op == INSERT) for (int i = 0; i < o.n; i++) rows.add(new DiffRow(DiffStatus.ADDED, null, right.get(rc++)));
            else if (o.op == DELETE) for (int i = 0; i < o.n; i++) rows.add(new DiffRow(DiffStatus.REMOVED, left.get(lc++), null));
            else for (int i = 0; i < o.n; i++) rows.add(new DiffRow(DiffStatus.UNCHANGED, left.get(lc++), right.get(rc++)));
        }
        return rows;
    }

    /**
     * "positional" mode: a removed line is reported as {@code changed} (paired with
     * an added line) ONLY if the two are actually similar; unrelated lines stay as
     * separate removed + added. Every left/right line still appears exactly once.
     */
    private static List<DiffRow> reconstructPositional(
            List<Op> ops, List<String> left, List<String> right, boolean pairChanged) {
        List<DiffRow> rows = new ArrayList<>();
        int lc = 0, rc = 0;
        List<String> pendingRemoved = new ArrayList<>();
        List<String> pendingAdded = new ArrayList<>();

        for (Op o : ops) {
            if (o.op == DELETE) {
                for (int i = 0; i < o.n; i++) pendingRemoved.add(left.get(lc++));
            } else if (o.op == INSERT) {
                for (int i = 0; i < o.n; i++) pendingAdded.add(right.get(rc++));
            } else {
                flush(rows, pendingRemoved, pendingAdded, pairChanged);
                for (int i = 0; i < o.n; i++) rows.add(new DiffRow(DiffStatus.UNCHANGED, left.get(lc++), right.get(rc++)));
            }
        }
        flush(rows, pendingRemoved, pendingAdded, pairChanged);
        return rows;
    }

    private static void flush(List<DiffRow> rows, List<String> pendingRemoved,
                              List<String> pendingAdded, boolean pairChanged) {
        List<String> removed = new ArrayList<>(pendingRemoved);
        List<String> added = new ArrayList<>(pendingAdded);
        pendingRemoved.clear();
        pendingAdded.clear();

        // Strict (git-style): never pair — an edit is a removed + an added line.
        if (!pairChanged) {
            for (String line : removed) rows.add(new DiffRow(DiffStatus.REMOVED, line, null));
            for (String line : added) rows.add(new DiffRow(DiffStatus.ADDED, null, line));
            return;
        }

        int paired = Math.min(removed.size(), added.size());
        boolean[] similar = new boolean[paired];
        boolean anySimilar = false;
        for (int i = 0; i < paired; i++) {
            similar[i] = similarLines(removed.get(i), added.get(i));
            anySimilar = anySimilar || similar[i];
        }

        if (!anySimilar) {
            // Wholesale replacement: removed block, then added block.
            for (String line : removed) rows.add(new DiffRow(DiffStatus.REMOVED, line, null));
            for (String line : added) rows.add(new DiffRow(DiffStatus.ADDED, null, line));
            return;
        }

        // Mixed block: keep positional order; similar pairs are `changed`.
        for (int i = 0; i < paired; i++) {
            if (similar[i]) {
                rows.add(new DiffRow(DiffStatus.CHANGED, removed.get(i), added.get(i)));
            } else {
                rows.add(new DiffRow(DiffStatus.REMOVED, removed.get(i), null));
                rows.add(new DiffRow(DiffStatus.ADDED, null, added.get(i)));
            }
        }
        for (int i = paired; i < removed.size(); i++) rows.add(new DiffRow(DiffStatus.REMOVED, removed.get(i), null));
        for (int i = paired; i < added.size(); i++) rows.add(new DiffRow(DiffStatus.ADDED, null, added.get(i)));
    }

    /**
     * Are two lines similar enough to call one a {@code changed} version of the
     * other? Character-bigram overlap (Sørensen–Dice) on a normalized form.
     * Conservative: when in doubt it reports "not similar".
     */
    private static boolean similarLines(String a, String b) {
        String na = normalizeForSimilarity(a);
        String nb = normalizeForSimilarity(b);
        if (na.equals(nb)) return true;
        int countA = na.length() - 1, countB = nb.length() - 1;
        if (countA < 1 || countB < 1) return false;

        Map<String, Integer> grams = new HashMap<>();
        for (int i = 0; i < na.length() - 1; i++) {
            grams.merge(na.substring(i, i + 2), 1, Integer::sum);
        }
        int common = 0;
        for (int i = 0; i < nb.length() - 1; i++) {
            String gram = nb.substring(i, i + 2);
            Integer count = grams.get(gram);
            if (count != null && count > 0) { common++; grams.put(gram, count - 1); }
        }
        return (2.0 * common) / (countA + countB) >= SIMILARITY_THRESHOLD;
    }

    private static final Pattern WHITESPACE = Pattern.compile("\\s+");
    private static String normalizeForSimilarity(String line) {
        return WHITESPACE.matcher(line.trim().toLowerCase()).replaceAll(" ");
    }

    /* ------------------------------------------------------------------ *
     * Key-based reconciliation (enables `changed`)
     * ------------------------------------------------------------------ */

    private static List<DiffRow> diffByKey(List<String> left, List<String> right,
                                           ColumnSpec key, Normalizer normalize) {
        LinkedHashMap<String, List<String>> leftGroups = groupByKey(left, key, normalize);
        LinkedHashMap<String, List<String>> rightGroups = groupByKey(right, key, normalize);

        // Deterministic output: walk the union of keys in sorted order.
        TreeSet<String> keys = new TreeSet<>();
        keys.addAll(leftGroups.keySet());
        keys.addAll(rightGroups.keySet());

        List<DiffRow> rows = new ArrayList<>();
        for (String k : keys) {
            List<String> leftLines = leftGroups.getOrDefault(k, List.of());
            List<String> rightLines = rightGroups.getOrDefault(k, List.of());
            int pairs = Math.max(leftLines.size(), rightLines.size());

            for (int i = 0; i < pairs; i++) {
                String l = i < leftLines.size() ? leftLines.get(i) : null;
                String r = i < rightLines.size() ? rightLines.get(i) : null;
                if (l != null && r != null) {
                    DiffStatus status = normalize.apply(l).equals(normalize.apply(r))
                            ? DiffStatus.UNCHANGED : DiffStatus.CHANGED;
                    rows.add(new DiffRow(status, l, r));
                } else if (l != null) {
                    rows.add(new DiffRow(DiffStatus.REMOVED, l, null));
                } else {
                    rows.add(new DiffRow(DiffStatus.ADDED, null, r));
                }
            }
        }
        return rows;
    }

    private static LinkedHashMap<String, List<String>> groupByKey(
            List<String> lines, ColumnSpec key, Normalizer normalize) {
        LinkedHashMap<String, List<String>> groups = new LinkedHashMap<>();
        for (String line : lines) {
            String k = normalize.apply(extractColumn(line, key));
            groups.computeIfAbsent(k, x -> new ArrayList<>()).add(line);
        }
        return groups;
    }

    /** Split on the delimiter and return the 1-based column, or "" if absent. */
    private static String extractColumn(String line, ColumnSpec column) {
        String[] parts = line.split(Pattern.quote(column.delimiter()), -1);
        int idx = column.index() - 1;
        return (idx >= 0 && idx < parts.length) ? parts[idx] : "";
    }

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    /** Normalizer with per-string caching so a line isn't re-normalized repeatedly. */
    private static final class Normalizer {
        private final boolean trim, caseInsensitive;
        private final Map<String, String> cache = new HashMap<>();

        Normalizer(boolean trim, boolean caseInsensitive) {
            this.trim = trim;
            this.caseInsensitive = caseInsensitive;
        }

        String apply(String s) {
            String cached = cache.get(s);
            if (cached != null) return cached;
            String n = s;
            if (trim) n = n.trim();
            if (caseInsensitive) n = n.toLowerCase();
            cache.put(s, n);
            return n;
        }
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
