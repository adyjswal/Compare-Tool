package com.adityakumar.engine

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * Integration tests for the sort → diff pipeline that DiffBackgroundTask executes.
 *
 * Business rules (mirrors VS Code's worker):
 *  - sort is applied with Sorter.sortLines before diffing
 *  - after sorting, diff mode MUST be "set" (positional pairing after reorder is wrong)
 *  - alpha sort uses caseInsensitive=true; numeric sort uses caseInsensitive=false
 */
class PipelineTest {

    // ── sort forces set mode (no spurious CHANGED rows after reorder) ──────────

    @Test fun `sorted identical files produce all-unchanged result`() {
        val lines = listOf("c", "a", "b")
        // Left and right have the same content but different order.
        // After alpha-asc sort both become ["a","b","c"] → all unchanged.
        val sortOpts = SortOptions(SortMode.ALPHABETICAL, SortDirection.ASC, caseInsensitive = true, trim = true)
        val sorted = Sorter.sortLines(lines, sortOpts)
        val diffOpts = DiffOptions(mode = "set")
        val result = Differ.diffLines(sorted, sorted, diffOpts)
        assertEquals(3, result.summary.unchanged)
        assertEquals(0, result.summary.added + result.summary.removed + result.summary.changed)
    }

    @Test fun `sort then set-diff detects genuine addition`() {
        // Left has ["b","a"], right has ["b","a","c"].
        // After alpha-asc sort: left→["a","b"], right→["a","b","c"].
        // Set diff must show 1 added row ("c") and 2 unchanged.
        val sortOpts = SortOptions(SortMode.ALPHABETICAL, SortDirection.ASC, caseInsensitive = true, trim = true)
        val sortedLeft  = Sorter.sortLines(listOf("b", "a"),      sortOpts)
        val sortedRight = Sorter.sortLines(listOf("b", "a", "c"), sortOpts)
        val result = Differ.diffLines(sortedLeft, sortedRight, DiffOptions(mode = "set"))
        assertEquals(2, result.summary.unchanged)
        assertEquals(1, result.summary.added)
        assertEquals(0, result.summary.removed + result.summary.changed)
    }

    @Test fun `sort then set-diff detects genuine removal`() {
        val sortOpts = SortOptions(SortMode.ALPHABETICAL, SortDirection.ASC, caseInsensitive = true, trim = true)
        val sortedLeft  = Sorter.sortLines(listOf("c", "a", "b"), sortOpts)
        val sortedRight = Sorter.sortLines(listOf("a", "b"),      sortOpts)
        val result = Differ.diffLines(sortedLeft, sortedRight, DiffOptions(mode = "set"))
        assertEquals(2, result.summary.unchanged)
        assertEquals(1, result.summary.removed)
        assertEquals(0, result.summary.added + result.summary.changed)
    }

    @Test fun `set mode after sort never produces changed rows`() {
        // A modified line (similar content) after sorting ends up at a different position.
        // In "set" mode it must NOT be paired as CHANGED; it stays as separate REMOVED+ADDED.
        val sortOpts = SortOptions(SortMode.ALPHABETICAL, SortDirection.ASC, caseInsensitive = true, trim = true)
        val leftLines  = listOf("apple", "banana", "cherry")
        // "banana" → "banana2" (one edit)
        val rightLines = listOf("apple", "banana2", "cherry")
        val sortedLeft  = Sorter.sortLines(leftLines,  sortOpts)
        val sortedRight = Sorter.sortLines(rightLines, sortOpts)
        val result = Differ.diffLines(sortedLeft, sortedRight, DiffOptions(mode = "set"))
        assertEquals(0, result.summary.changed, "set mode must not produce CHANGED rows")
    }

    // ── numeric sort ───────────────────────────────────────────────────────────

    @Test fun `numeric sort then diff aligns by numeric order`() {
        // Left: ["10","2","1"], right: ["10","2","1","100"]
        // Numeric asc: left→["1","2","10"], right→["1","2","10","100"] → 1 added
        val sortOpts = SortOptions(SortMode.NUMERIC, SortDirection.ASC, caseInsensitive = false, trim = true)
        val sortedLeft  = Sorter.sortLines(listOf("10", "2", "1"),         sortOpts)
        val sortedRight = Sorter.sortLines(listOf("10", "2", "1", "100"),  sortOpts)
        val result = Differ.diffLines(sortedLeft, sortedRight, DiffOptions(mode = "set"))
        assertEquals(3, result.summary.unchanged)
        assertEquals(1, result.summary.added)
    }

    @Test fun `numeric descending sort orders correctly before diff`() {
        val sortOpts = SortOptions(SortMode.NUMERIC, SortDirection.DESC, caseInsensitive = false, trim = true)
        val lines = listOf("1", "10", "2")
        val sorted = Sorter.sortLines(lines, sortOpts)
        // desc: ["10","2","1"]
        assertEquals(listOf("10", "2", "1"), sorted)
        // Both sides identical → all unchanged
        val result = Differ.diffLines(sorted, sorted, DiffOptions(mode = "set"))
        assertEquals(3, result.summary.unchanged)
    }

    // ── alpha sort options ─────────────────────────────────────────────────────

    @Test fun `alpha sort uses caseInsensitive true so mixed-case files merge correctly`() {
        // caseInsensitive=true means "Apple" and "apple" sort together rather than
        // splitting on ASCII case boundary.
        val sortOpts = SortOptions(SortMode.ALPHABETICAL, SortDirection.ASC, caseInsensitive = true, trim = true)
        val sorted = Sorter.sortLines(listOf("banana", "Apple", "cherry"), sortOpts)
        // "Apple" (sorted as "apple") must come before "banana"
        assertEquals("Apple", sorted[0])
        assertEquals("banana", sorted[1])
        assertEquals("cherry", sorted[2])
    }

    @Test fun `alpha descending sort then diff`() {
        val sortOpts = SortOptions(SortMode.ALPHABETICAL, SortDirection.DESC, caseInsensitive = true, trim = true)
        val sortedLeft  = Sorter.sortLines(listOf("a", "b", "c"), sortOpts)  // → ["c","b","a"]
        val sortedRight = Sorter.sortLines(listOf("a", "b", "c"), sortOpts)  // → ["c","b","a"]
        val result = Differ.diffLines(sortedLeft, sortedRight, DiffOptions(mode = "set"))
        assertEquals(3, result.summary.unchanged)
    }
}
