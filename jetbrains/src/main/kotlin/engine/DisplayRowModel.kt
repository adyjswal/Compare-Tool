package com.adityakumar.engine

/**
 * Display-row model for the "unchanged rows" view.
 *
 * Faithfully ports webview/rowModel.ts from the VS Code extension.
 *
 * The diff table is addressed by *absolute* row (0..total-1). To hide or
 * collapse unchanged rows we insert a mapping layer: a *display index*
 * (0..count-1) maps to either an absolute row or a **fold marker** standing in
 * for a collapsed run of unchanged rows.
 *
 * Three modes:
 *  - ALL       — every row (identity mapping; nothing is allocated).
 *  - CHANGES   — only rows that differ (unchanged rows hidden entirely).
 *  - COLLAPSED — GitHub-style: a few context rows around each change, with
 *                long unchanged runs folded into an expandable marker.
 *
 * No Swing/IDE imports — unit-testable in isolation.
 */
object DisplayRowModel {

    /** Which unchanged-row view is active. */
    enum class ViewMode { ALL, CHANGES, COLLAPSED }

    /** Default number of context rows kept on each side of a collapsed run. */
    const val CONTEXT_ROWS = 3

    /**
     * A collapsed run of unchanged rows.
     * [start, end) is the hidden range; count = end - start.
     * runStart is the first row of the *whole* unchanged run — a stable key for
     * the expanded set (unaffected by context changes).
     */
    data class Fold(
        val runStart: Int,
        val start: Int,
        val end: Int,
        val count: Int
    )

    /**
     * The display list derived from the status column.
     *
     * Status byte encoding (same as VS Code Uint8Array):
     *   0 = unchanged, 1 = added, 2 = removed, 3 = changed
     *
     * map encoding:
     *   map[d] >= 0  →  absolute row index
     *   map[d] <  0  →  fold: foldId = -1 - map[d]
     */
    data class Model(
        /** Number of display rows the table should render. */
        val count: Int,
        /**
         * Display index → encoded value. null = identity ("all" mode).
         * value >= 0 → absolute row; value < 0 → fold id = -1 - value.
         */
        val map: IntArray?,
        /** Fold markers indexed by fold id. */
        val folds: List<Fold>,
        /**
         * Absolute row → display index. null = identity.
         * Hidden rows map to the nearest following visible slot (changes mode)
         * or to the fold's display slot (collapsed mode).
         */
        val absToDisplay: IntArray?,
        /**
         * Per-display-row status codes for the overview ruler.
         * Fold slots encode as 0 (unchanged). null = use original statuses ("all").
         */
        val displayStatuses: ByteArray?
    )

    /**
     * Build the display model for a status column under the given view mode.
     *
     * @param statuses    per-row status byte (0=unchanged, 1=added, 2=removed, 3=changed)
     * @param mode        which view is active
     * @param context     context rows on each side of a fold (collapsed mode only)
     * @param expanded    set of runStart values the user has expanded
     */
    fun build(
        statuses: ByteArray,
        mode: ViewMode,
        context: Int = CONTEXT_ROWS,
        expanded: Set<Int> = emptySet()
    ): Model {
        val total = statuses.size
        if (mode == ViewMode.ALL || total == 0) {
            return identity(total)
        }
        if (mode == ViewMode.CHANGES) {
            return buildChanges(statuses, total)
        }
        return buildCollapsed(statuses, total, maxOf(0, context), expanded)
    }

    // ── identity model ─────────────────────────────────────────────────────────

    private fun identity(total: Int) = Model(
        count = total,
        map = null,
        folds = emptyList(),
        absToDisplay = null,
        displayStatuses = null
    )

    // ── changes model ──────────────────────────────────────────────────────────

    private fun buildChanges(statuses: ByteArray, total: Int): Model {
        // Pass 1: count visible rows
        var count = 0
        for (i in 0 until total) {
            if (statuses[i] != 0.toByte()) count++
        }

        val map            = IntArray(count)
        val displaySts     = ByteArray(count)
        val absToDisplay   = IntArray(total)

        // Pass 2: fill
        var d = 0
        for (i in 0 until total) {
            if (statuses[i] != 0.toByte()) {
                map[d] = i
                displaySts[d] = statuses[i]
                absToDisplay[i] = d
                d++
            } else {
                // Hidden: point at the next visible row (clamp at last visible).
                absToDisplay[i] = minOf(d, maxOf(0, count - 1))
            }
        }

        return Model(count, map, emptyList(), absToDisplay, displaySts)
    }

    // ── collapsed model ────────────────────────────────────────────────────────

    private fun buildCollapsed(
        statuses: ByteArray,
        total: Int,
        context: Int,
        expanded: Set<Int>
    ): Model {
        // Pass 1: count display rows and folds
        var count = 0
        var foldCount = 0
        forEachDisplaySlot(statuses, total, context, expanded,
            onRow = { count++ },
            onFold = { count++; foldCount++ }
        )

        val map          = IntArray(count)
        val displaySts   = ByteArray(count)
        val absToDisplay = IntArray(total)
        val folds        = ArrayList<Fold>(foldCount)

        // Pass 2: fill
        var d = 0
        forEachDisplaySlot(statuses, total, context, expanded,
            onRow = { abs ->
                map[d] = abs
                displaySts[d] = statuses[abs]
                absToDisplay[abs] = d
                d++
            },
            onFold = { fold ->
                map[d] = -1 - folds.size
                displaySts[d] = 0
                for (i in fold.start until fold.end) {
                    absToDisplay[i] = d
                }
                folds.add(fold)
                d++
            }
        )

        return Model(count, map, folds, absToDisplay, displaySts)
    }

    // ── shared walk ────────────────────────────────────────────────────────────

    /**
     * Walk the status column and emit display slots for collapsed mode.
     * This is the single source of truth for the shape — called twice (count + fill).
     */
    private fun forEachDisplaySlot(
        statuses: ByteArray,
        total: Int,
        context: Int,
        expanded: Set<Int>,
        onRow: (abs: Int) -> Unit,
        onFold: (fold: Fold) -> Unit
    ) {
        var i = 0
        while (i < total) {
            if (statuses[i] != 0.toByte()) {
                onRow(i)
                i++
                continue
            }

            // Maximal unchanged run [runStart, runEnd)
            val runStart = i
            var runEnd = i + 1
            while (runEnd < total && statuses[runEnd] == 0.toByte()) {
                runEnd++
            }
            val runLen = runEnd - runStart

            if (expanded.contains(runStart) || runLen <= 2 * context) {
                // Show all rows in the run
                for (r in runStart until runEnd) {
                    onRow(r)
                }
            } else {
                // Show context rows, fold the middle, show context rows
                for (r in runStart until runStart + context) {
                    onRow(r)
                }
                val foldStart = runStart + context
                val foldEnd   = runEnd - context
                onFold(Fold(runStart, foldStart, foldEnd, foldEnd - foldStart))
                for (r in runEnd - context until runEnd) {
                    onRow(r)
                }
            }
            i = runEnd
        }
    }

    // ── helpers for the viewer layer ───────────────────────────────────────────

    /**
     * Translate an absolute row index to its display index.
     * Returns abs when model.absToDisplay is null (identity / "all" mode).
     */
    fun Model.displayOf(abs: Int): Int =
        absToDisplay?.get(abs) ?: abs

    /**
     * Decode a map entry:
     *   >= 0 → absolute row index
     *    < 0 → fold id = -1 - value
     */
    fun Model.decodeMapEntry(d: Int): Pair<Int, Fold?> {
        val v = map?.get(d) ?: d          // null map = identity
        return if (v < 0) {
            Pair(-1, folds[-1 - v])
        } else {
            Pair(v, null)
        }
    }

    /**
     * Check whether absolute row [abs] is currently hidden inside a fold.
     * Returns the Fold if hidden, null if visible.
     */
    fun Model.hiddenInFold(abs: Int): Fold? {
        val absToDisp = absToDisplay ?: return null
        val m         = map         ?: return null
        val d = absToDisp[abs]
        val v = m[d]
        if (v >= 0) return null                // not a fold slot
        val fold = folds[-1 - v]
        return if (abs >= fold.start && abs < fold.end) fold else null
    }
}
