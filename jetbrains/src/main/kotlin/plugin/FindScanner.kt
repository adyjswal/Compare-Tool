package com.adityakumar.plugin

import com.adityakumar.engine.DiffRow

/**
 * Pure scan over a completed diff result — finds rows where either side
 * contains the query text (or matches the regex).
 *
 * Extracted to a top-level object so it can be unit-tested independently of
 * Swing / IntelliJ Platform. DiffPanel calls this from a SwingWorker background
 * thread so a 1M-row scan never blocks the EDT.
 *
 * Port of the inline scan in `sendFind` in extension/src/panel/diffPanel.ts.
 */
object FindScanner {

    data class FindResult(
        /** Row indices (into the DiffRow list) that matched the query. */
        val indices: List<Int>,
        /** True when [isRegex] was set but the pattern string is not a valid regex. */
        val regexError: Boolean = false
    )

    /**
     * Scan [rows] for [query].
     *
     * @param caseSensitive When false, both query and row text are lowercased before comparison.
     * @param isRegex       When true, [query] is compiled as a Kotlin Regex; invalid patterns
     *                      return [FindResult.regexError] = true with an empty index list.
     */
    fun scan(
        rows: List<DiffRow>,
        query: String,
        caseSensitive: Boolean,
        isRegex: Boolean
    ): FindResult {
        if (query.isEmpty()) return FindResult(emptyList())

        return if (isRegex) {
            val pattern = try {
                if (caseSensitive) Regex(query) else Regex(query, RegexOption.IGNORE_CASE)
            } catch (_: Exception) {
                return FindResult(emptyList(), regexError = true)
            }
            FindResult(
                rows.indices.filter { i ->
                    pattern.containsMatchIn(rows[i].left ?: "") ||
                            pattern.containsMatchIn(rows[i].right ?: "")
                }
            )
        } else {
            val needle = if (caseSensitive) query else query.lowercase()
            FindResult(
                rows.indices.filter { i ->
                    val l = if (caseSensitive) (rows[i].left ?: "") else (rows[i].left ?: "").lowercase()
                    val r = if (caseSensitive) (rows[i].right ?: "") else (rows[i].right ?: "").lowercase()
                    l.contains(needle) || r.contains(needle)
                }
            )
        }
    }
}
