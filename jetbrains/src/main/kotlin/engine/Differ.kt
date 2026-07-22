package com.adityakumar.engine

object Differ {
    fun diffLines(left: List<String>, right: List<String>, options: DiffOptions = DiffOptions()): DiffResult {
        val normalize: (String) -> String = { line ->
            var s = line
            if (options.trim) s = s.trim()
            if (options.caseInsensitive) s = s.lowercase()
            s
        }

        return if (options.key != null) {
            diffByKey(left, right, options.key, normalize)
        } else {
            diffWholeLine(left, right, normalize)
        }
    }

    private fun diffWholeLine(left: List<String>, right: List<String>, normalize: (String) -> String): DiffResult {
        val lNorm = left.map(normalize)
        val rNorm = right.map(normalize)
        val lcs = computeLCS(lNorm, rNorm)

        val rows = mutableListOf<DiffRow>()
        var li = 0; var ri = 0; var ki = 0

        while (li < left.size || ri < right.size) {
            if (ki < lcs.size && li < left.size && ri < right.size &&
                lNorm[li] == lcs[ki] && rNorm[ri] == lcs[ki]) {
                rows.add(DiffRow(DiffStatus.UNCHANGED, left[li], right[ri]))
                li++; ri++; ki++
            } else if (li < left.size && (ki >= lcs.size || lNorm[li] != lcs[ki])) {
                rows.add(DiffRow(DiffStatus.REMOVED, left[li], null))
                li++
            } else {
                rows.add(DiffRow(DiffStatus.ADDED, null, right[ri]))
                ri++
            }
        }
        return buildResult(rows)
    }

    private fun diffByKey(left: List<String>, right: List<String>, key: ColumnSpec, normalize: (String) -> String): DiffResult {
        fun extractKey(line: String): String {
            val parts = line.split(key.delimiter)
            val idx = key.index - 1
            return if (idx >= 0 && idx < parts.size) normalize(parts[idx]) else normalize(line)
        }
        val leftMap = LinkedHashMap<String, String>()
        left.forEach { leftMap[extractKey(it)] = it }
        val rightMap = LinkedHashMap<String, String>()
        right.forEach { rightMap[extractKey(it)] = it }

        val rows = mutableListOf<DiffRow>()
        val allKeys = (leftMap.keys + rightMap.keys).distinct()
        for (k in allKeys) {
            val l = leftMap[k]; val r = rightMap[k]
            when {
                l != null && r != null && normalize(l) == normalize(r) -> rows.add(DiffRow(DiffStatus.UNCHANGED, l, r))
                l != null && r != null -> rows.add(DiffRow(DiffStatus.CHANGED, l, r))
                l != null -> rows.add(DiffRow(DiffStatus.REMOVED, l, null))
                else -> rows.add(DiffRow(DiffStatus.ADDED, null, r))
            }
        }
        return buildResult(rows)
    }

    private fun computeLCS(a: List<String>, b: List<String>): List<String> {
        val m = a.size; val n = b.size
        // For large files, skip full LCS to avoid O(m*n) memory — fall back to empty (all removed+added)
        if (m.toLong() * n > 5_000_000L) return emptyList()
        val dp = Array(m + 1) { IntArray(n + 1) }
        for (i in 1..m) for (j in 1..n) {
            dp[i][j] = if (a[i-1] == b[j-1]) dp[i-1][j-1] + 1 else maxOf(dp[i-1][j], dp[i][j-1])
        }
        val lcs = mutableListOf<String>()
        var i = m; var j = n
        while (i > 0 && j > 0) {
            when {
                a[i-1] == b[j-1] -> { lcs.add(0, a[i-1]); i--; j-- }
                dp[i-1][j] > dp[i][j-1] -> i--
                else -> j--
            }
        }
        return lcs
    }

    private fun buildResult(rows: List<DiffRow>): DiffResult {
        var unchanged = 0; var added = 0; var removed = 0; var changed = 0
        rows.forEach { when (it.status) {
            DiffStatus.UNCHANGED -> unchanged++
            DiffStatus.ADDED     -> added++
            DiffStatus.REMOVED   -> removed++
            DiffStatus.CHANGED   -> changed++
        }}
        return DiffResult(rows, DiffSummary(unchanged, added, removed, changed, rows.size))
    }
}
