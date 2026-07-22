package com.adityakumar.engine

object Sorter {
    fun sortLines(lines: List<String>, options: SortOptions): List<String> {
        val comparator = Comparator<String> { a, b ->
            val keyA = extractKey(a, options)
            val keyB = extractKey(b, options)
            compareKeys(keyA, keyB, options)
        }
        val sorted = lines.sortedWith(comparator)
        return if (options.direction == SortDirection.DESC) sorted.reversed() else sorted
    }

    private fun extractKey(line: String, options: SortOptions): String {
        val raw = if (options.column != null) {
            val parts = line.split(options.column.delimiter)
            val idx = options.column.index - 1   // 1-based → 0-based
            if (idx >= 0 && idx < parts.size) parts[idx] else ""
        } else line
        val trimmed = if (options.trim) raw.trim() else raw
        return if (options.caseInsensitive) trimmed.lowercase() else trimmed
    }

    private fun compareKeys(a: String, b: String, options: SortOptions): Int {
        return if (options.mode == SortMode.NUMERIC) {
            val na = a.toDoubleOrNull()
            val nb = b.toDoubleOrNull()
            when {
                na != null && nb != null -> na.compareTo(nb)
                na != null -> -1   // numbers before non-numbers in asc
                nb != null -> 1
                else -> a.compareTo(b)
            }
        } else {
            a.compareTo(b)
        }
    }
}
