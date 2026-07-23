package com.adityakumar.engine

import java.util.regex.Pattern

/**
 * Inline word-level diff for "changed" rows.
 *
 * Faithfully ports the VS Code webview computeInline / tokenize / changedRange
 * functions from DiffList.tsx. The algorithm is NOT Myers/LCS — it finds the
 * longest common token prefix and suffix, then highlights everything in between
 * as a single contiguous changed span per side.
 *
 * This is pure logic with no IDE or Swing imports — unit-testable in isolation.
 */
object WordDiff {

    /** Maximum total character count (left + right) before we skip inline highlighting. */
    const val INLINE_MAX_CHARS = 20_000

    /**
     * Character-offset span [start, end) into the raw line string.
     * start == end means no highlighting (empty span).
     */
    data class Span(val start: Int, val end: Int)

    /**
     * One pair of spans — one per side of a changed row.
     * null means: do not highlight (lines too long, or no meaningful diff).
     */
    data class InlineResult(val left: Span, val right: Span)

    // Regex mirrors JS: /\w+|\s+|[^\w\s]+/g
    // Java \w is ASCII-only [A-Za-z0-9_], same as JS \w in practice.
    private val TOKEN_PATTERN: Pattern = Pattern.compile("""\w+|\s+|[^\w\s]+""")

    /**
     * Tokenize a raw line string into non-overlapping exhaustive tokens.
     * Token classes (priority order):
     *   1. \w+       — word characters
     *   2. \s+       — whitespace runs
     *   3. [^\w\s]+  — punctuation/symbol runs
     */
    fun tokenize(text: String): List<String> {
        if (text.isEmpty()) return emptyList()
        val result = mutableListOf<String>()
        val m = TOKEN_PATTERN.matcher(text)
        while (m.find()) {
            result.add(m.group())
        }
        return result
    }

    /**
     * Convert a half-open token index range [midStart, midEnd) into character
     * offsets [start, end) in the original string by summing token lengths.
     *
     * @param tokens   the token list for one side
     * @param midStart index of the first token in the changed range
     * @param midEnd   exclusive end index of the changed range
     * @return Span with start = sum of lengths before midStart,
     *               end   = start + sum of lengths in [midStart, midEnd)
     */
    fun changedRange(tokens: List<String>, midStart: Int, midEnd: Int): Span {
        var start = 0
        for (i in 0 until midStart) {
            start += tokens[i].length
        }
        var end = start
        for (i in midStart until midEnd) {
            end += tokens[i].length
        }
        return Span(start, end)
    }

    /**
     * Compute the inline diff between the left and right text of a "changed" row.
     *
     * Returns null when:
     *  - left.length + right.length > INLINE_MAX_CHARS
     *  - the resulting span is empty (lines are token-identical)
     *
     * Algorithm:
     *  1. Guard on total length.
     *  2. Tokenize both sides.
     *  3. Walk forward to find the longest common token prefix.
     *  4. Walk backward to find the longest common token suffix
     *     (capped so prefix + suffix cannot exceed min(a.length, b.length)).
     *  5. Convert prefix/suffix counts to character offsets via changedRange().
     */
    fun computeInline(left: String, right: String): InlineResult? {
        if (left.length + right.length > INLINE_MAX_CHARS) return null

        val a = tokenize(left)
        val b = tokenize(right)

        // Step 2 — longest common token prefix
        val maxPrefix = minOf(a.size, b.size)
        var prefix = 0
        while (prefix < maxPrefix && a[prefix] == b[prefix]) {
            prefix++
        }

        // Step 3 — longest common token suffix (cannot overlap with prefix)
        val maxSuffix = maxPrefix - prefix
        var suffix = 0
        while (suffix < maxSuffix &&
               a[a.size - 1 - suffix] == b[b.size - 1 - suffix]) {
            suffix++
        }

        // Step 4 — compute character offsets
        val leftSpan  = changedRange(a, prefix, a.size - suffix)
        val rightSpan = changedRange(b, prefix, b.size - suffix)

        // If both spans are empty the lines are effectively identical at the token level
        if (leftSpan.start == leftSpan.end && rightSpan.start == rightSpan.end) return null

        return InlineResult(leftSpan, rightSpan)
    }
}
