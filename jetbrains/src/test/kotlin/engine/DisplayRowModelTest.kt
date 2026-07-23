package com.adityakumar.engine

import com.adityakumar.engine.DisplayRowModel.ViewMode
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * Unit tests for DisplayRowModel.
 * Mirrors the semantics of extension/test/rowModel.test.ts exactly.
 *
 * Status encoding helper: u=0, a=1, r=2, c=3
 */
class DisplayRowModelTest {

    /** Build a ByteArray status column from a compact string. */
    private fun statuses(spec: String): ByteArray {
        return ByteArray(spec.length) { i ->
            when (spec[i]) {
                'u' -> 0
                'a' -> 1
                'r' -> 2
                'c' -> 3
                else -> throw IllegalArgumentException("bad status char: ${spec[i]}")
            }
        }
    }

    /**
     * Expand the model into the display sequence: absolute row indices and
     * fold descriptors, matching the display() helper in rowModel.test.ts.
     */
    private sealed class DisplayEntry {
        data class Row(val abs: Int) : DisplayEntry()
        data class Fold(val start: Int, val end: Int) : DisplayEntry()
    }

    private fun display(model: DisplayRowModel.Model): List<DisplayEntry> {
        val out = mutableListOf<DisplayEntry>()
        for (d in 0 until model.count) {
            val v = model.map?.get(d) ?: d
            if (model.map != null && v < 0) {
                val fold = model.folds[-1 - v]
                out.add(DisplayEntry.Fold(fold.start, fold.end))
            } else {
                out.add(DisplayEntry.Row(v))
            }
        }
        return out
    }

    private fun row(abs: Int) = DisplayEntry.Row(abs)
    private fun fold(start: Int, end: Int) = DisplayEntry.Fold(start, end)

    // ── ALL mode ───────────────────────────────────────────────────────────────

    @Test fun `all mode is identity regardless of content`() {
        val s = statuses("uacru")
        val m = DisplayRowModel.build(s, ViewMode.ALL)
        assertEquals(5, m.count)
        assertNull(m.map)
        assertNull(m.absToDisplay)
        assertNull(m.displayStatuses)
        assertEquals(emptyList<DisplayRowModel.Fold>(), m.folds)
    }

    @Test fun `all mode empty input is identity`() {
        val m = DisplayRowModel.build(ByteArray(0), ViewMode.ALL)
        assertEquals(0, m.count)
        assertNull(m.map)
    }

    @Test fun `empty input in changes mode is identity`() {
        val m = DisplayRowModel.build(ByteArray(0), ViewMode.CHANGES)
        assertEquals(0, m.count)
        assertNull(m.map)
    }

    // ── CHANGES mode ───────────────────────────────────────────────────────────

    @Test fun `changes mode keeps only rows that differ in order`() {
        // "uuacuuruu" → changes at abs 2(a), 3(c), 6(r)
        val s = statuses("uuacuuruu")
        val m = DisplayRowModel.build(s, ViewMode.CHANGES)
        assertEquals(listOf(row(2), row(3), row(6)), display(m))
        assertArrayEquals(byteArrayOf(1, 3, 2), m.displayStatuses)
    }

    @Test fun `changes mode maps hidden rows to next visible display row`() {
        val s = statuses("uuacuuruu") // changes at 2,3,6
        val m = DisplayRowModel.build(s, ViewMode.CHANGES)
        val a = m.absToDisplay!!
        // abs 0,1 → first visible = d=0
        assertEquals(0, a[0])
        assertEquals(0, a[1])
        // abs 2 (a) → its own display slot d=0
        assertEquals(0, a[2])
        // abs 3 (c) → d=1
        assertEquals(1, a[3])
        // abs 4,5 (unchanged) → next visible is abs 6 at d=2
        assertEquals(2, a[4])
        assertEquals(2, a[5])
        // abs 6 (r) → d=2
        assertEquals(2, a[6])
        // abs 7,8 (trailing unchanged) → clamped to count-1=2
        assertEquals(2, a[7])
        assertEquals(2, a[8])
    }

    @Test fun `changes mode all-unchanged collapses to empty list`() {
        val s = statuses("uuuu")
        val m = DisplayRowModel.build(s, ViewMode.CHANGES)
        assertEquals(0, m.count)
    }

    // ── COLLAPSED mode ─────────────────────────────────────────────────────────

    @Test fun `collapsed folds a long unchanged run with context on each side`() {
        // 10 u then 1 c; context=3 → show 0,1,2, fold [3,7), show 7,8,9, then 10
        val s = statuses("uuuuuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        assertEquals(
            listOf(row(0), row(1), row(2), fold(3, 7), row(7), row(8), row(9), row(10)),
            display(m)
        )
        val f = m.folds[0]
        assertEquals(0, f.runStart)
        assertEquals(3, f.start)
        assertEquals(7, f.end)
        assertEquals(4, f.count)
    }

    @Test fun `collapsed does not fold a run of exactly 2 times context`() {
        // 6 u then c; runLen=6 == 2*3 — threshold is >, so NOT folded
        val s = statuses("uuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        assertEquals(0, m.folds.size)
        assertEquals(
            listOf(row(0), row(1), row(2), row(3), row(4), row(5), row(6)),
            display(m)
        )
    }

    @Test fun `collapsed folds a run of 2 times context plus 1`() {
        // 7 u then c; runLen=7 > 2*3=6 → fold [3,4)
        val s = statuses("uuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        assertEquals(1, m.folds.size)
        val f = m.folds[0]
        assertEquals(3, f.start)
        assertEquals(4, f.end)
        assertEquals(1, f.count)
    }

    @Test fun `collapsed expanding a run reveals every row`() {
        val s = statuses("uuuuuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3, expanded = setOf(0))
        assertEquals(0, m.folds.size)
        assertEquals(
            (0..10).map { row(it) },
            display(m)
        )
    }

    @Test fun `collapsed folds each long run independently`() {
        // run A (8 u), change, run B (8 u), change
        val s = statuses("uuuuuuuucuuuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        assertEquals(2, m.folds.size)
        val expected = listOf(
            row(0), row(1), row(2), fold(3, 5), row(5), row(6), row(7),
            row(8),
            row(9), row(10), row(11), fold(12, 14), row(14), row(15), row(16),
            row(17)
        )
        assertEquals(expected, display(m))
    }

    @Test fun `collapsed hidden rows in a fold map to the fold display index`() {
        val s = statuses("uuuuuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        // Fold sits at display index 3 (after rows 0,1,2). Rows 3..6 are hidden.
        val a = m.absToDisplay!!
        assertEquals(3, a[3])
        assertEquals(3, a[4])
        assertEquals(3, a[5])
        assertEquals(3, a[6])
        // Visible rows map to their own display index
        assertEquals(4, a[7])
        assertEquals(7, a[10])
    }

    @Test fun `collapsed visible rows map to their own display index`() {
        val s = statuses("uuuuuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        val a = m.absToDisplay!!
        assertEquals(0, a[0])
        assertEquals(1, a[1])
        assertEquals(2, a[2])
        assertEquals(4, a[7])
        assertEquals(5, a[8])
        assertEquals(6, a[9])
        assertEquals(7, a[10])
    }

    @Test fun `collapsed fold map entries are negative and decode correctly`() {
        val s = statuses("uuuuuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        // Display slot 3 should be the fold
        val mapVal = m.map!![3]
        assertTrue(mapVal < 0, "fold map entry should be negative, got $mapVal")
        val foldId = -1 - mapVal
        assertEquals(0, foldId)
        assertEquals(m.folds[0], m.folds[foldId])
    }

    @Test fun `collapsed displayStatuses fold slot is 0 (unchanged)`() {
        val s = statuses("uuuuuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        // Display slot 3 is the fold; its displayStatus must be 0
        assertEquals(0.toByte(), m.displayStatuses!![3])
        // Display slot 7 is the changed row
        assertEquals(3.toByte(), m.displayStatuses!![7])
    }

    // ── displayOf helper ───────────────────────────────────────────────────────

    @Test fun `displayOf returns abs when map is null (all mode)`() {
        val s = statuses("uacru")
        val m = DisplayRowModel.build(s, ViewMode.ALL)
        with(DisplayRowModel) {
            assertEquals(3, m.displayOf(3))
        }
    }

    @Test fun `displayOf uses absToDisplay when present`() {
        val s = statuses("uuacuuruu")
        val m = DisplayRowModel.build(s, ViewMode.CHANGES)
        with(DisplayRowModel) {
            assertEquals(0, m.displayOf(2))  // abs 2 (a) → display 0
            assertEquals(1, m.displayOf(3))  // abs 3 (c) → display 1
            assertEquals(2, m.displayOf(6))  // abs 6 (r) → display 2
        }
    }

    // ── hiddenInFold helper ────────────────────────────────────────────────────

    @Test fun `hiddenInFold returns null for visible rows`() {
        val s = statuses("uuuuuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        with(DisplayRowModel) {
            assertNull(m.hiddenInFold(0))   // visible
            assertNull(m.hiddenInFold(10))  // the changed row
        }
    }

    @Test fun `hiddenInFold returns fold for hidden rows`() {
        val s = statuses("uuuuuuuuuuc")
        val m = DisplayRowModel.build(s, ViewMode.COLLAPSED, context = 3)
        with(DisplayRowModel) {
            val fold = m.hiddenInFold(4)
            assertNotNull(fold)
            assertEquals(3, fold!!.start)
            assertEquals(7, fold.end)
        }
    }

    @Test fun `hiddenInFold returns null in all mode (no absToDisplay)`() {
        val s = statuses("uuuuu")
        val m = DisplayRowModel.build(s, ViewMode.ALL)
        with(DisplayRowModel) {
            assertNull(m.hiddenInFold(2))
        }
    }
}
