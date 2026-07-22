package com.adityakumar.plugin

import com.adityakumar.engine.DiffRow
import com.adityakumar.engine.DiffStatus
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class FindScannerTest {

    // ── helpers ────────────────────────────────────────────────────────────────

    private fun row(left: String? = null, right: String? = null) =
        DiffRow(DiffStatus.UNCHANGED, left, right)

    // ── empty / trivial ────────────────────────────────────────────────────────

    @Test fun `empty query returns empty result`() {
        val rows = listOf(row("hello", "world"))
        val r = FindScanner.scan(rows, "", caseSensitive = false, isRegex = false)
        assertTrue(r.indices.isEmpty())
        assertFalse(r.regexError)
    }

    @Test fun `empty row list returns empty result`() {
        val r = FindScanner.scan(emptyList(), "hello", caseSensitive = false, isRegex = false)
        assertTrue(r.indices.isEmpty())
    }

    // ── plain text, case-insensitive ───────────────────────────────────────────

    @Test fun `case-insensitive matches on left side`() {
        val rows = listOf(row("Hello World", "other"), row("nope", "nope"))
        val r = FindScanner.scan(rows, "hello", caseSensitive = false, isRegex = false)
        assertEquals(listOf(0), r.indices)
    }

    @Test fun `case-insensitive matches on right side`() {
        val rows = listOf(row("nope", "HELLO world"), row("nope", "nope"))
        val r = FindScanner.scan(rows, "hello", caseSensitive = false, isRegex = false)
        assertEquals(listOf(0), r.indices)
    }

    @Test fun `matches in both sides returns the same index once`() {
        val rows = listOf(row("hello", "hello again"), row("nope", "nope"))
        val r = FindScanner.scan(rows, "hello", caseSensitive = false, isRegex = false)
        // Row 0 matches (left OR right); it must appear exactly once in the result.
        assertEquals(listOf(0), r.indices)
    }

    @Test fun `multiple rows matched`() {
        val rows = listOf(row("apple", "pear"), row("banana", "mango"), row("APPLE juice", "x"))
        val r = FindScanner.scan(rows, "apple", caseSensitive = false, isRegex = false)
        assertEquals(listOf(0, 2), r.indices)
    }

    // ── plain text, case-sensitive ─────────────────────────────────────────────

    @Test fun `case-sensitive does NOT match wrong case`() {
        val rows = listOf(row("Hello", "World"))
        val r = FindScanner.scan(rows, "hello", caseSensitive = true, isRegex = false)
        assertTrue(r.indices.isEmpty())
    }

    @Test fun `case-sensitive matches exact case`() {
        val rows = listOf(row("hello", "World"), row("Hello", "hello"))
        val r = FindScanner.scan(rows, "hello", caseSensitive = true, isRegex = false)
        assertEquals(listOf(0, 1), r.indices)
    }

    // ── null sides (ADDED / REMOVED rows have one null side) ──────────────────

    @Test fun `null left side is treated as empty string`() {
        val rows = listOf(DiffRow(DiffStatus.ADDED, left = null, right = "needle here"))
        val r = FindScanner.scan(rows, "needle", caseSensitive = false, isRegex = false)
        assertEquals(listOf(0), r.indices)
    }

    @Test fun `null right side is treated as empty string`() {
        val rows = listOf(DiffRow(DiffStatus.REMOVED, left = "needle here", right = null))
        val r = FindScanner.scan(rows, "needle", caseSensitive = false, isRegex = false)
        assertEquals(listOf(0), r.indices)
    }

    @Test fun `both sides null does not match a non-empty query`() {
        val rows = listOf(DiffRow(DiffStatus.UNCHANGED, left = null, right = null))
        val r = FindScanner.scan(rows, "anything", caseSensitive = false, isRegex = false)
        assertTrue(r.indices.isEmpty())
    }

    // ── regex mode ─────────────────────────────────────────────────────────────

    @Test fun `regex matches digits pattern`() {
        val rows = listOf(row("abc123", "xyz"), row("no digits", "here too"))
        val r = FindScanner.scan(rows, """\d+""", caseSensitive = false, isRegex = true)
        assertEquals(listOf(0), r.indices)
        assertFalse(r.regexError)
    }

    @Test fun `regex is case-insensitive when caseSensitive is false`() {
        val rows = listOf(row("HELLO", "world"), row("goodbye", "bye"))
        val r = FindScanner.scan(rows, "hello", caseSensitive = false, isRegex = true)
        assertEquals(listOf(0), r.indices)
    }

    @Test fun `regex is case-sensitive when caseSensitive is true`() {
        val rows = listOf(row("HELLO", "world"), row("hello", "bye"))
        val r = FindScanner.scan(rows, "hello", caseSensitive = true, isRegex = true)
        // Only row 1 has lowercase "hello"
        assertEquals(listOf(1), r.indices)
    }

    @Test fun `invalid regex returns regexError true and empty indices`() {
        val rows = listOf(row("anything", "here"))
        val r = FindScanner.scan(rows, "[invalid(", caseSensitive = false, isRegex = true)
        assertTrue(r.regexError)
        assertTrue(r.indices.isEmpty())
    }

    @Test fun `valid regex with no matches returns empty indices and no error`() {
        val rows = listOf(row("hello world", "foo bar"))
        val r = FindScanner.scan(rows, """\d{5}""", caseSensitive = false, isRegex = true)
        assertTrue(r.indices.isEmpty())
        assertFalse(r.regexError)
    }
}
