package com.adityakumar.engine

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class DifferTest {
    /* ---- basic status detection (original cases) ---- */

    @Test fun `unchanged lines are unchanged`() {
        val r = Differ.diffLines(listOf("a", "b", "c"), listOf("a", "b", "c"))
        assertEquals(3, r.summary.unchanged)
        assertEquals(0, r.summary.added + r.summary.removed + r.summary.changed)
    }

    @Test fun `added line detected`() {
        val r = Differ.diffLines(listOf("a", "b"), listOf("a", "b", "c"))
        assertEquals(1, r.summary.added); assertEquals(0, r.summary.removed)
    }

    @Test fun `removed line detected`() {
        val r = Differ.diffLines(listOf("a", "b", "c"), listOf("a", "c"))
        assertEquals(1, r.summary.removed); assertEquals(0, r.summary.added)
    }

    @Test fun `empty vs non-empty`() {
        val r = Differ.diffLines(emptyList(), listOf("a", "b"))
        assertEquals(2, r.summary.added); assertEquals(0, r.summary.removed)
    }

    @Test fun `trim option treats trimmed lines as equal`() {
        val r = Differ.diffLines(listOf("hello "), listOf("hello"), DiffOptions(trim = true))
        assertEquals(1, r.summary.unchanged)
    }

    @Test fun `caseInsensitive treats case-only difference as equal`() {
        val r = Differ.diffLines(listOf("Hello"), listOf("hello"), DiffOptions(caseInsensitive = true))
        assertEquals(1, r.summary.unchanged)
        assertEquals(0, r.summary.changed)
    }

    /* ---- positional `changed` pairing (Sørensen–Dice) ---- */

    @Test fun `similar edited line becomes changed`() {
        // Same structure, one value edited → should pair as a single `changed` row.
        val left = listOf("id=1000 name=alice status=active")
        val right = listOf("id=1000 name=alice status=inactive")
        val r = Differ.diffLines(left, right)
        assertEquals(1, r.summary.changed)
        assertEquals(0, r.summary.removed)
        assertEquals(0, r.summary.added)
    }

    @Test fun `unrelated lines stay separate removed and added`() {
        // No meaningful overlap → must NOT be a fabricated `changed`.
        val r = Differ.diffLines(listOf("the quick brown fox"), listOf("9999 zzz qqq"))
        assertEquals(0, r.summary.changed)
        assertEquals(1, r.summary.removed)
        assertEquals(1, r.summary.added)
    }

    @Test fun `pairChanged false is git-style with no changed rows`() {
        val left = listOf("id=1000 name=alice status=active")
        val right = listOf("id=1000 name=alice status=inactive")
        val r = Differ.diffLines(left, right, DiffOptions(pairChanged = false))
        assertEquals(0, r.summary.changed)
        assertEquals(1, r.summary.removed)
        assertEquals(1, r.summary.added)
    }

    /* ---- set mode ---- */

    @Test fun `set mode never produces changed rows`() {
        val left = listOf("id=1000 name=alice status=active")
        val right = listOf("id=1000 name=alice status=inactive")
        val r = Differ.diffLines(left, right, DiffOptions(mode = "set"))
        assertEquals(0, r.summary.changed)
        assertEquals(1, r.summary.removed)
        assertEquals(1, r.summary.added)
    }

    /* ---- prefix/suffix fast path ---- */

    @Test fun `single change buried in a large equal block`() {
        val left = (0 until 5000).map { "line $it" }
        val right = left.toMutableList().apply { this[2500] = "line 2500 CHANGED" }
        val r = Differ.diffLines(left, right)
        assertEquals(4999, r.summary.unchanged)
        // The one differing line is a similar edit → changed.
        assertEquals(1, r.summary.changed)
    }

    /* ---- large-file regression: the bug the old O(m*n) LCS could not handle ---- */

    @Test fun `200k lines diff without collapsing to all-removed-added`() {
        val n = 200_000
        val left = (0 until n).map { "row $it value ${it % 7}" }
        // Change 1 line in 10; each change is a similar edit of the same row.
        val right = left.mapIndexed { i, s -> if (i % 10 == 0) "$s EDIT" else s }
        val r = Differ.diffLines(left, right)

        // The old naive LCS returned an empty LCS above ~2.2k lines, making
        // EVERY row removed+added (unchanged == 0). Patience diff must keep the
        // ~90% of untouched rows as unchanged.
        assertEquals(n * 9 / 10, r.summary.unchanged)
        assertEquals(n / 10, r.summary.changed)
        assertEquals(0, r.summary.removed)
        assertEquals(0, r.summary.added)
    }

    /* ---- partition correctness ---- */

    @Test fun `every left and right line appears exactly once`() {
        val left = listOf("a", "b", "c", "d", "e")
        val right = listOf("a", "x", "c", "y", "z", "e")
        val r = Differ.diffLines(left, right)

        val leftSeen = r.rows.mapNotNull { it.left }
        val rightSeen = r.rows.mapNotNull { it.right }
        assertEquals(left, leftSeen)     // left lines in original order, no dupes/drops
        assertEquals(right, rightSeen)   // right lines in original order, no dupes/drops
    }

    /* ---- key-column mode ---- */

    @Test fun `key mode matches by column`() {
        val key = ColumnSpec(",", 1)
        val r = Differ.diffLines(
            listOf("1,alice", "2,bob"),
            listOf("1,alicia", "2,bob", "3,carol"),
            DiffOptions(key = key),
        )
        assertEquals(1, r.summary.changed)   // alice → alicia
        assertEquals(1, r.summary.unchanged) // bob
        assertEquals(1, r.summary.added)     // carol
    }

    @Test fun `key mode is deterministic in sorted key order`() {
        val key = ColumnSpec(",", 1)
        val r = Differ.diffLines(
            listOf("30,c", "10,a", "20,b"),
            listOf("20,b", "10,a", "30,c"),
            DiffOptions(key = key),
        )
        assertEquals(3, r.summary.unchanged)
        val keysInOrder = r.rows.map { it.left!!.substringBefore(",") }
        assertEquals(listOf("10", "20", "30"), keysInOrder)
    }

    @Test fun `key mode preserves duplicate keys instead of collapsing`() {
        // Two rows share key "1"; the old LinkedHashMap<String,String> kept only
        // the last, silently dropping a row. Grouped pairing must keep both.
        val key = ColumnSpec(",", 1)
        val r = Differ.diffLines(
            listOf("1,alice", "1,alice2"),
            listOf("1,alice"),
            DiffOptions(key = key),
        )
        // First "1" pairs (unchanged); the extra left "1" row is removed — not dropped.
        assertEquals(1, r.summary.unchanged)
        assertEquals(1, r.summary.removed)
        assertEquals(0, r.summary.added)
        assertEquals(2, r.summary.total)
    }
}
