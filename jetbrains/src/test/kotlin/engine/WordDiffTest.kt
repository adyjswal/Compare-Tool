package com.adityakumar.engine

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class WordDiffTest {

    // ── tokenize ───────────────────────────────────────────────────────────────

    @Test fun `tokenize empty string returns empty list`() {
        assertEquals(emptyList<String>(), WordDiff.tokenize(""))
    }

    @Test fun `tokenize pure word`() {
        assertEquals(listOf("hello"), WordDiff.tokenize("hello"))
    }

    @Test fun `tokenize word with trailing space`() {
        // "hello " → ["hello", " "]
        assertEquals(listOf("hello", " "), WordDiff.tokenize("hello "))
    }

    @Test fun `tokenize mixed content`() {
        // "foo, bar" → ["foo", ",", " ", "bar"]
        assertEquals(listOf("foo", ",", " ", "bar"), WordDiff.tokenize("foo, bar"))
    }

    @Test fun `tokenize whitespace run is one token`() {
        assertEquals(listOf("a", "   ", "b"), WordDiff.tokenize("a   b"))
    }

    @Test fun `tokenize punctuation run is one token`() {
        assertEquals(listOf("abc", "...", "def"), WordDiff.tokenize("abc...def"))
    }

    @Test fun `tokenize concatenates back to original`() {
        val text = "SELECT id, name FROM users WHERE id = 42;"
        val tokens = WordDiff.tokenize(text)
        assertEquals(text, tokens.joinToString(""))
    }

    @Test fun `tokenize digits are word chars`() {
        assertEquals(listOf("123"), WordDiff.tokenize("123"))
    }

    // ── changedRange ───────────────────────────────────────────────────────────

    @Test fun `changedRange empty token list`() {
        val span = WordDiff.changedRange(emptyList(), 0, 0)
        assertEquals(WordDiff.Span(0, 0), span)
    }

    @Test fun `changedRange full span`() {
        val tokens = listOf("foo", " ", "bar")
        // midStart=0, midEnd=3 → start=0, end=7
        val span = WordDiff.changedRange(tokens, 0, 3)
        assertEquals(WordDiff.Span(0, 7), span)
    }

    @Test fun `changedRange middle span`() {
        val tokens = listOf("a", "b", "c", "d")  // lengths 1,1,1,1
        // midStart=1, midEnd=3 → start=1, end=3
        val span = WordDiff.changedRange(tokens, 1, 3)
        assertEquals(WordDiff.Span(1, 3), span)
    }

    @Test fun `changedRange when midStart equals midEnd returns empty span`() {
        val tokens = listOf("hello", " ", "world")
        val span = WordDiff.changedRange(tokens, 2, 2)
        // start = len("hello") + len(" ") = 6; end = 6
        assertEquals(WordDiff.Span(6, 6), span)
    }

    // ── computeInline ──────────────────────────────────────────────────────────

    @Test fun `computeInline identical lines returns null (no highlight)`() {
        assertNull(WordDiff.computeInline("hello world", "hello world"))
    }

    @Test fun `computeInline empty strings returns null`() {
        assertNull(WordDiff.computeInline("", ""))
    }

    @Test fun `computeInline one empty one non-empty`() {
        val result = WordDiff.computeInline("", "hello")
        assertNotNull(result)
        // left span is empty (nothing in left), right span covers "hello"
        assertEquals(WordDiff.Span(0, 0), result!!.left)
        assertEquals(WordDiff.Span(0, 5), result.right)
    }

    @Test fun `computeInline completely different words`() {
        val result = WordDiff.computeInline("foo", "bar")
        assertNotNull(result)
        assertEquals(WordDiff.Span(0, 3), result!!.left)
        assertEquals(WordDiff.Span(0, 3), result.right)
    }

    @Test fun `computeInline common prefix trimmed`() {
        // "status=active" vs "status=inactive" — common prefix "status="
        val result = WordDiff.computeInline("status=active", "status=inactive")
        assertNotNull(result)
        // tokens left:  ["status", "=", "active"]
        // tokens right: ["status", "=", "inactive"]
        // common prefix = 2 tokens ("status", "="), no common suffix
        // left span: offset 7 to 13 ("active")
        // right span: offset 7 to 15 ("inactive")
        assertEquals(WordDiff.Span(7, 13), result!!.left)
        assertEquals(WordDiff.Span(7, 15), result.right)
    }

    @Test fun `computeInline common suffix trimmed`() {
        // "hello world" vs "goodbye world" — common suffix " world"
        val result = WordDiff.computeInline("hello world", "goodbye world")
        assertNotNull(result)
        // tokens: ["hello", " ", "world"] vs ["goodbye", " ", "world"]
        // prefix=0, suffix=2 (" ", "world")
        // left span: 0..5 ("hello")
        // right span: 0..7 ("goodbye")
        assertEquals(WordDiff.Span(0, 5), result!!.left)
        assertEquals(WordDiff.Span(0, 7), result.right)
    }

    @Test fun `computeInline common prefix AND suffix`() {
        // "id=1000 name=alice status=active" vs "id=1000 name=alice status=inactive"
        val left  = "id=1000 name=alice status=active"
        val right = "id=1000 name=alice status=inactive"
        val result = WordDiff.computeInline(left, right)
        assertNotNull(result)
        // Both spans should be non-empty
        assertTrue(result!!.left.end > result.left.start)
        assertTrue(result.right.end > result.right.start)
        // The changed part is only at the end ("active" vs "inactive")
        // Left span ends at left.length, right span ends at right.length
        assertEquals(left.length, result.left.end)
        assertEquals(right.length, result.right.end)
    }

    @Test fun `computeInline returns null when total chars exceed 20000`() {
        val big = "a".repeat(10_001)
        assertNull(WordDiff.computeInline(big, big.replace("a", "b")))
    }

    @Test fun `computeInline boundary exactly at limit returns result`() {
        // 10000 + 10000 = 20000 — exactly at limit, not over, should compute
        val left  = "a".repeat(10_000)
        val right = "b".repeat(10_000)
        // If sum == 20000 we allow it; sum > 20000 we reject
        val result = WordDiff.computeInline(left, right)
        assertNotNull(result)
    }

    @Test fun `computeInline single character change`() {
        val result = WordDiff.computeInline("abc", "axc")
        assertNotNull(result)
        // tokens: ["abc"] vs ["axc"] — no common prefix, no common suffix at token level
        // Entire strings are highlighted since single tokens differ
        assertEquals(WordDiff.Span(0, 3), result!!.left)
        assertEquals(WordDiff.Span(0, 3), result.right)
    }

    @Test fun `computeInline whitespace-only difference`() {
        // "a b" vs "a  b" — the space token differs (one space vs two spaces)
        val result = WordDiff.computeInline("a b", "a  b")
        assertNotNull(result)
        // tokens: ["a", " ", "b"] vs ["a", "  ", "b"]
        // prefix=1 ("a"), suffix=1 ("b"), middle = [" "] vs ["  "]
        assertEquals(WordDiff.Span(1, 2), result!!.left)
        assertEquals(WordDiff.Span(1, 3), result.right)
    }
}
