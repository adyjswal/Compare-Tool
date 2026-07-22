package com.adityakumar.engine

/**
 * Comparing two line lists — a faithful port of the TypeScript engine
 * (engine/src/differ.ts). Three behaviours, chosen by the caller:
 *
 *  - Whole-line "positional" (default): compare files in their existing order.
 *    A removed line paired with a similar added line becomes one `changed` row.
 *  - Whole-line "set": same comparison, no pairing (a modified line stays a
 *    separate removed + added). Use after sorting, where positions don't matter.
 *  - Key column: record reconciliation — rows matched by a delimited key column;
 *    same key + different content = a `changed` row.
 *
 * The whole-line diff is a **patience diff** over interned line ids, so it stays
 * fast on very large (200k–1M line) files instead of collapsing to an
 * all-removed + all-added dump the way a naive O(m*n) LCS does above a size cap.
 */
object Differ {
    // Below this combined segment size we fall back to an exact LCS diff; above
    // it, an anchorless block is emitted as a plain removed + added ("replace"),
    // so we never risk an O(m*n) blow-up on a huge divergent block.
    private const val BASE_LCS_LIMIT = 2000
    // Guard against pathological anchor nesting; deeper segments use the base path.
    private const val MAX_DEPTH = 4000
    // A removed+added pair is only reported as `changed` when at least this similar.
    private const val SIMILARITY_THRESHOLD = 0.6

    private const val EQUAL = 0
    private const val DELETE = 1
    private const val INSERT = 2

    fun diffLines(
        left: List<String>,
        right: List<String>,
        options: DiffOptions = DiffOptions(),
    ): DiffResult {
        val normalize = makeNormalizer(options.trim, options.caseInsensitive)
        val rows = if (options.key != null) {
            diffByKey(left, right, options.key, normalize)
        } else {
            diffWholeLine(left, right, options.mode, normalize, options.pairChanged)
        }
        return buildResult(rows)
    }

    /* ------------------------------------------------------------------ *
     * Whole-line comparison (patience diff over interned lines)
     * ------------------------------------------------------------------ */

    private sealed class WorkItem
    private class OpItem(val op: Int, var n: Int) : WorkItem()
    private class RangeItem(
        val al: Int, val ah: Int, val bl: Int, val bh: Int, val depth: Int,
    ) : WorkItem()

    private fun diffWholeLine(
        left: List<String>,
        right: List<String>,
        mode: String,
        normalize: (String) -> String,
        pairChanged: Boolean,
    ): List<DiffRow> {
        val dict = HashMap<String, Int>()
        var nextId = 0
        fun idOf(line: String): Int = dict.getOrPut(normalize(line)) { nextId++ }
        val a = IntArray(left.size) { idOf(left[it]) }
        val b = IntArray(right.size) { idOf(right[it]) }

        val ops = diffIds(a, b)
        return if (mode == "positional") {
            reconstructPositional(ops, left, right, pairChanged)
        } else {
            reconstructSet(ops, left, right)
        }
    }

    /** Append a run, coalescing with the previous run of the same kind. */
    private fun pushOp(ops: MutableList<OpItem>, op: Int, n: Int) {
        if (n <= 0) return
        val last = ops.lastOrNull()
        if (last != null && last.op == op) last.n += n else ops.add(OpItem(op, n))
    }

    /** Patience-diff two id arrays into an ordered list of EQUAL/DELETE/INSERT runs. */
    private fun diffIds(a: IntArray, b: IntArray): List<OpItem> {
        val ops = ArrayList<OpItem>()
        val stack = ArrayDeque<WorkItem>()
        stack.addLast(RangeItem(0, a.size, 0, b.size, 0))

        while (stack.isNotEmpty()) {
            val item = stack.removeLast()
            if (item is OpItem) {
                pushOp(ops, item.op, item.n)
                continue
            }
            item as RangeItem
            var al = item.al; var ah = item.ah; var bl = item.bl; var bh = item.bh
            val parts = ArrayList<WorkItem>()

            var prefix = 0
            while (al < ah && bl < bh && a[al] == b[bl]) { al++; bl++; prefix++ }
            if (prefix > 0) parts.add(OpItem(EQUAL, prefix))

            var suffix = 0
            while (ah > al && bh > bl && a[ah - 1] == b[bh - 1]) { ah--; bh--; suffix++ }

            if (al == ah) {
                if (bl < bh) parts.add(OpItem(INSERT, bh - bl))
            } else if (bl == bh) {
                parts.add(OpItem(DELETE, ah - al))
            } else {
                val anchors = if (item.depth <= MAX_DEPTH) {
                    patienceAnchors(a, b, al, ah, bl, bh)
                } else {
                    emptyList()
                }
                if (anchors.isEmpty()) {
                    baseDiff(a, b, al, ah, bl, bh, parts)
                } else {
                    var pa = al; var pb = bl
                    for (anchor in anchors) {
                        parts.add(RangeItem(pa, anchor[0], pb, anchor[1], item.depth + 1))
                        parts.add(OpItem(EQUAL, 1))
                        pa = anchor[0] + 1; pb = anchor[1] + 1
                    }
                    parts.add(RangeItem(pa, ah, pb, bh, item.depth + 1))
                }
            }

            if (suffix > 0) parts.add(OpItem(EQUAL, suffix))

            for (i in parts.indices.reversed()) stack.addLast(parts[i])
        }
        return ops
    }

    /**
     * Diff a small (or anchorless) segment. Tiny segments go through an exact LCS
     * diff; oversized anchorless blocks are emitted as a plain removed + added
     * replacement so we never risk a blow-up.
     */
    private fun baseDiff(
        a: IntArray, b: IntArray, al: Int, ah: Int, bl: Int, bh: Int,
        parts: MutableList<WorkItem>,
    ) {
        val leftLen = ah - al
        val rightLen = bh - bl
        if (leftLen + rightLen > BASE_LCS_LIMIT) {
            if (leftLen > 0) parts.add(OpItem(DELETE, leftLen))
            if (rightLen > 0) parts.add(OpItem(INSERT, rightLen))
            return
        }
        for (op in lcsDiff(a.copyOfRange(al, ah), b.copyOfRange(bl, bh))) parts.add(op)
    }

    /**
     * Exact LCS diff of two small id arrays → coalesced EQUAL/DELETE/INSERT runs.
     * Bounded to segments of at most BASE_LCS_LIMIT combined length, so the O(m*n)
     * DP table stays small (≤ ~1M cells).
     */
    private fun lcsDiff(a: IntArray, b: IntArray): List<OpItem> {
        val m = a.size; val n = b.size
        if (m == 0) return if (n > 0) listOf(OpItem(INSERT, n)) else emptyList()
        if (n == 0) return listOf(OpItem(DELETE, m))

        val dp = Array(m + 1) { IntArray(n + 1) }
        for (i in 1..m) for (j in 1..n) {
            dp[i][j] = if (a[i - 1] == b[j - 1]) dp[i - 1][j - 1] + 1
            else maxOf(dp[i - 1][j], dp[i][j - 1])
        }

        val rev = ArrayList<OpItem>()
        var i = m; var j = n
        while (i > 0 && j > 0) {
            when {
                a[i - 1] == b[j - 1] -> { rev.add(OpItem(EQUAL, 1)); i--; j-- }
                dp[i - 1][j] >= dp[i][j - 1] -> { rev.add(OpItem(DELETE, 1)); i-- }
                else -> { rev.add(OpItem(INSERT, 1)); j-- }
            }
        }
        while (i > 0) { rev.add(OpItem(DELETE, 1)); i-- }
        while (j > 0) { rev.add(OpItem(INSERT, 1)); j-- }
        rev.reverse()

        val out = ArrayList<OpItem>()
        for (o in rev) {
            val last = out.lastOrNull()
            if (last != null && last.op == o.op) last.n += o.n else out.add(OpItem(o.op, o.n))
        }
        return out
    }

    /**
     * Anchor pairs: lines occurring exactly once on both sides, kept as the
     * longest run whose positions increase on both sides (a patience LIS).
     * Each element is [leftPos, rightPos].
     */
    private fun patienceAnchors(
        a: IntArray, b: IntArray, al: Int, ah: Int, bl: Int, bh: Int,
    ): List<IntArray> {
        val leftPos = uniquePositions(a, al, ah)
        val rightPos = uniquePositions(b, bl, bh)

        val pairs = ArrayList<IntArray>()
        for ((id, lp) in leftPos) {
            val rp = rightPos[id]
            if (rp != null && rp >= 0 && lp >= 0) pairs.add(intArrayOf(lp, rp))
        }
        if (pairs.isEmpty()) return emptyList()
        pairs.sortBy { it[0] }
        return longestIncreasingByRight(pairs)
    }

    /** Map id → its single position in [lo,hi), or -1 if it occurs more than once. */
    private fun uniquePositions(ids: IntArray, lo: Int, hi: Int): HashMap<Int, Int> {
        val seen = HashMap<Int, Int>()
        for (i in lo until hi) {
            val id = ids[i]
            seen[id] = if (seen.containsKey(id)) -1 else i
        }
        return seen
    }

    /** Longest subsequence of pairs (pre-sorted by left) whose right pos increases. */
    private fun longestIncreasingByRight(pairs: List<IntArray>): List<IntArray> {
        val n = pairs.size
        val prev = IntArray(n) { -1 }
        val tails = ArrayList<Int>() // tails[k] = index of smallest tail of an LIS of length k+1

        for (i in 0 until n) {
            val value = pairs[i][1]
            var lo = 0; var hi = tails.size
            while (lo < hi) {
                val mid = (lo + hi) ushr 1
                if (pairs[tails[mid]][1] < value) lo = mid + 1 else hi = mid
            }
            if (lo > 0) prev[i] = tails[lo - 1]
            if (lo == tails.size) tails.add(i) else tails[lo] = i
        }

        val result = ArrayList<IntArray>()
        var k = if (tails.isNotEmpty()) tails[tails.size - 1] else -1
        while (k != -1) { result.add(pairs[k]); k = prev[k] }
        result.reverse()
        return result
    }

    /**
     * "set" mode: emit each run as-is. Modified lines surface as separate
     * removed + added — appropriate once the input has been sorted.
     */
    private fun reconstructSet(
        ops: List<OpItem>, left: List<String>, right: List<String>,
    ): List<DiffRow> {
        val rows = ArrayList<DiffRow>()
        var lc = 0; var rc = 0
        for (o in ops) when (o.op) {
            INSERT -> repeat(o.n) { rows.add(DiffRow(DiffStatus.ADDED, null, right[rc++])) }
            DELETE -> repeat(o.n) { rows.add(DiffRow(DiffStatus.REMOVED, left[lc++], null)) }
            else -> repeat(o.n) { rows.add(DiffRow(DiffStatus.UNCHANGED, left[lc++], right[rc++])) }
        }
        return rows
    }

    /**
     * "positional" mode: within a modified block, a removed line is reported as
     * `changed` (paired with an added line) ONLY if the two are actually similar;
     * unrelated lines at the same position stay as separate removed + added.
     * Every left/right line still appears exactly once, in order — the categories
     * remain a complete, ordered partition of the diff.
     */
    private fun reconstructPositional(
        ops: List<OpItem>, left: List<String>, right: List<String>, pairChanged: Boolean,
    ): List<DiffRow> {
        val rows = ArrayList<DiffRow>()
        var lc = 0; var rc = 0
        val pendingRemoved = ArrayList<String>()
        val pendingAdded = ArrayList<String>()

        fun flush() {
            val removed = ArrayList(pendingRemoved)
            val added = ArrayList(pendingAdded)
            pendingRemoved.clear(); pendingAdded.clear()

            // Strict (git-style): never pair — an edit is a removed + an added line.
            if (!pairChanged) {
                for (line in removed) rows.add(DiffRow(DiffStatus.REMOVED, line, null))
                for (line in added) rows.add(DiffRow(DiffStatus.ADDED, null, line))
                return
            }

            val paired = minOf(removed.size, added.size)
            val similar = BooleanArray(paired)
            var anySimilar = false
            for (i in 0 until paired) {
                similar[i] = similarLines(removed[i], added[i])
                anySimilar = anySimilar || similar[i]
            }

            if (!anySimilar) {
                // Wholesale replacement: removed block, then added block.
                for (line in removed) rows.add(DiffRow(DiffStatus.REMOVED, line, null))
                for (line in added) rows.add(DiffRow(DiffStatus.ADDED, null, line))
                return
            }

            // Mixed block: keep positional order; similar pairs are `changed`.
            for (i in 0 until paired) {
                if (similar[i]) {
                    rows.add(DiffRow(DiffStatus.CHANGED, removed[i], added[i]))
                } else {
                    rows.add(DiffRow(DiffStatus.REMOVED, removed[i], null))
                    rows.add(DiffRow(DiffStatus.ADDED, null, added[i]))
                }
            }
            for (i in paired until removed.size) rows.add(DiffRow(DiffStatus.REMOVED, removed[i], null))
            for (i in paired until added.size) rows.add(DiffRow(DiffStatus.ADDED, null, added[i]))
        }

        for (o in ops) when (o.op) {
            DELETE -> repeat(o.n) { pendingRemoved.add(left[lc++]) }
            INSERT -> repeat(o.n) { pendingAdded.add(right[rc++]) }
            else -> {
                flush()
                repeat(o.n) { rows.add(DiffRow(DiffStatus.UNCHANGED, left[lc++], right[rc++])) }
            }
        }
        flush()
        return rows
    }

    /**
     * Are two lines similar enough to call one a `changed` version of the other?
     * Character-bigram overlap (Sørensen–Dice) on a normalized form. Conservative:
     * when in doubt it reports "not similar" so we never fabricate an edit.
     */
    private fun similarLines(a: String, b: String): Boolean {
        val na = normalizeForSimilarity(a)
        val nb = normalizeForSimilarity(b)
        if (na == nb) return true
        val countA = na.length - 1
        val countB = nb.length - 1
        if (countA < 1 || countB < 1) return false

        val grams = HashMap<String, Int>()
        for (i in 0 until na.length - 1) {
            val gram = na.substring(i, i + 2)
            grams[gram] = (grams[gram] ?: 0) + 1
        }
        var common = 0
        for (i in 0 until nb.length - 1) {
            val gram = nb.substring(i, i + 2)
            val count = grams[gram]
            if (count != null && count > 0) { common++; grams[gram] = count - 1 }
        }
        return (2.0 * common) / (countA + countB) >= SIMILARITY_THRESHOLD
    }

    private val WHITESPACE = Regex("\\s+")
    private fun normalizeForSimilarity(line: String): String =
        line.trim().lowercase().replace(WHITESPACE, " ")

    /* ------------------------------------------------------------------ *
     * Key-based reconciliation (enables `changed`)
     * ------------------------------------------------------------------ */

    private fun diffByKey(
        left: List<String>, right: List<String>, key: ColumnSpec, normalize: (String) -> String,
    ): List<DiffRow> {
        val keyOf = { line: String -> normalize(extractColumn(line, key)) }
        val leftGroups = groupByKey(left, keyOf)
        val rightGroups = groupByKey(right, keyOf)

        // Deterministic output: walk the union of keys in sorted order.
        val keys = sortedSetOf<String>().apply {
            addAll(leftGroups.keys); addAll(rightGroups.keys)
        }

        val rows = ArrayList<DiffRow>()
        for (k in keys) {
            val leftLines = leftGroups[k] ?: emptyList()
            val rightLines = rightGroups[k] ?: emptyList()
            val pairs = maxOf(leftLines.size, rightLines.size)

            // Pair rows sharing a key positionally; leftovers are added/removed.
            for (i in 0 until pairs) {
                val leftLine = leftLines.getOrNull(i)
                val rightLine = rightLines.getOrNull(i)
                when {
                    leftLine != null && rightLine != null -> {
                        val status = if (normalize(leftLine) == normalize(rightLine)) {
                            DiffStatus.UNCHANGED
                        } else {
                            DiffStatus.CHANGED
                        }
                        rows.add(DiffRow(status, leftLine, rightLine))
                    }
                    leftLine != null -> rows.add(DiffRow(DiffStatus.REMOVED, leftLine, null))
                    rightLine != null -> rows.add(DiffRow(DiffStatus.ADDED, null, rightLine))
                }
            }
        }
        return rows
    }

    private fun groupByKey(
        lines: List<String>, keyOf: (String) -> String,
    ): LinkedHashMap<String, MutableList<String>> {
        val groups = LinkedHashMap<String, MutableList<String>>()
        for (line in lines) groups.getOrPut(keyOf(line)) { ArrayList() }.add(line)
        return groups
    }

    /** Split on the delimiter and return the 1-based column, or "" if absent. */
    private fun extractColumn(line: String, column: ColumnSpec): String {
        val parts = line.split(column.delimiter)
        val idx = column.index - 1
        return if (idx >= 0 && idx < parts.size) parts[idx] else ""
    }

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    /** Normalizer with per-string caching so a line isn't re-normalized repeatedly. */
    private fun makeNormalizer(trim: Boolean, caseInsensitive: Boolean): (String) -> String {
        val cache = HashMap<String, String>()
        return { s ->
            cache.getOrPut(s) {
                var n = s
                if (trim) n = n.trim()
                if (caseInsensitive) n = n.lowercase()
                n
            }
        }
    }

    private fun buildResult(rows: List<DiffRow>): DiffResult {
        var unchanged = 0; var added = 0; var removed = 0; var changed = 0
        for (row in rows) when (row.status) {
            DiffStatus.UNCHANGED -> unchanged++
            DiffStatus.ADDED -> added++
            DiffStatus.REMOVED -> removed++
            DiffStatus.CHANGED -> changed++
        }
        return DiffResult(rows, DiffSummary(unchanged, added, removed, changed, rows.size))
    }
}
