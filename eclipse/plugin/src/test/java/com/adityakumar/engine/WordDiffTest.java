package com.adityakumar.engine;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link WordDiff} — the inline word-level diff algorithm.
 *
 * <p>Mirrors the semantics documented in the VS Code DiffList.tsx
 * {@code computeInline()} specification.
 */
class WordDiffTest {

    // ------------------------------------------------------------------ //
    //  tokenize()                                                          //
    // ------------------------------------------------------------------ //

    @Test
    void tokenizeEmptyStringReturnsEmpty() {
        assertArrayEquals(new String[0], WordDiff.tokenize(""));
    }

    @Test
    void tokenizeWords() {
        String[] tokens = WordDiff.tokenize("hello world");
        assertArrayEquals(new String[]{"hello", " ", "world"}, tokens);
    }

    @Test
    void tokenizeMixedContent() {
        String[] tokens = WordDiff.tokenize("id=1000 name=alice");
        // Tokens: "id", "=", "1000", " ", "name", "=", "alice"
        assertArrayEquals(new String[]{"id", "=", "1000", " ", "name", "=", "alice"}, tokens);
    }

    @Test
    void tokenizePunctuation() {
        String[] tokens = WordDiff.tokenize("foo,bar;baz");
        assertArrayEquals(new String[]{"foo", ",", "bar", ";", "baz"}, tokens);
    }

    @Test
    void tokenizeWhitespaceRun() {
        String[] tokens = WordDiff.tokenize("a   b");
        assertArrayEquals(new String[]{"a", "   ", "b"}, tokens);
    }

    @Test
    void tokenizeReconstitutesOriginal() {
        String original = "  hello, world! 123_test  ";
        String[] tokens = WordDiff.tokenize(original);
        StringBuilder sb = new StringBuilder();
        for (String t : tokens) sb.append(t);
        assertEquals(original, sb.toString(),
                "tokens must concatenate back to the original string without gaps or overlaps");
    }

    // ------------------------------------------------------------------ //
    //  changedRange()                                                      //
    // ------------------------------------------------------------------ //

    @Test
    void changedRangeFullSpan() {
        String[] tokens = new String[]{"hello", " ", "world"};
        int[] span = WordDiff.changedRange(tokens, 0, 3);
        assertArrayEquals(new int[]{0, 11}, span);
    }

    @Test
    void changedRangeMiddleToken() {
        // prefix=1 (skip "hello"), midEnd=2 (stop before "world")
        String[] tokens = new String[]{"hello", " ", "world"};
        int[] span = WordDiff.changedRange(tokens, 1, 2);
        // start = length("hello") = 5; end = 5 + length(" ") = 6
        assertArrayEquals(new int[]{5, 6}, span);
    }

    @Test
    void changedRangeEmptySpan() {
        String[] tokens = new String[]{"hello", " ", "world"};
        int[] span = WordDiff.changedRange(tokens, 2, 2);
        // start = length("hello") + length(" ") = 6; end = 6
        assertArrayEquals(new int[]{6, 6}, span);
    }

    // ------------------------------------------------------------------ //
    //  compute() — main algorithm                                          //
    // ------------------------------------------------------------------ //

    @Test
    void computeIdenticalLinesReturnsNull() {
        assertNull(WordDiff.compute("hello world", "hello world"),
                "token-identical lines should return null (no highlight)");
    }

    @Test
    void computeSingleWordDiff() {
        // "status=active" vs "status=inactive"
        // Prefix: "status", "=" — 2 tokens shared.
        // Suffix: nothing (after common prefix, "active" vs "inactive" differ entirely).
        var result = WordDiff.compute("status=active", "status=inactive");
        assertNotNull(result);
        // Left span covers "active" starting after "status="
        assertEquals(7, result.left().start());
        assertEquals(13, result.left().end());   // "active" is 6 chars → 7+6=13
        // Right span covers "inactive" starting after "status="
        assertEquals(7, result.right().start());
        assertEquals(15, result.right().end());  // "inactive" is 8 chars → 7+8=15
    }

    @Test
    void computeLinesTooLongReturnsNull() {
        String longString = "a".repeat(15_000);
        assertNull(WordDiff.compute(longString, longString + "b"),
                "lines exceeding INLINE_MAX_CHARS combined should return null");
    }

    @Test
    void computeEmptyVsNonEmpty() {
        var result = WordDiff.compute("", "hello");
        assertNotNull(result);
        // Left span is empty [0,0], right span covers all of "hello" [0,5]
        assertEquals(0, result.left().start());
        assertEquals(0, result.left().end());
        assertEquals(0, result.right().start());
        assertEquals(5, result.right().end());
    }

    @Test
    void computeNonEmptyVsEmpty() {
        var result = WordDiff.compute("hello", "");
        assertNotNull(result);
        assertEquals(0, result.left().start());
        assertEquals(5, result.left().end());
        assertEquals(0, result.right().start());
        assertEquals(0, result.right().end());
    }

    @Test
    void computeSpansAreCorrectCharOffsets() {
        // "id=1000 name=alice status=active" vs "id=1000 name=alice status=inactive"
        // Common prefix tokens: id, =, 1000, ' ', name, =, alice, ' ', status, =
        // That prefix text = "id=1000 name=alice status="  (length = 26)
        // Changed token: left="active" right="inactive"
        var result = WordDiff.compute(
                "id=1000 name=alice status=active",
                "id=1000 name=alice status=inactive");
        assertNotNull(result);
        assertEquals(26, result.left().start());
        assertEquals(32, result.left().end());   // "active" = 6 chars
        assertEquals(26, result.right().start());
        assertEquals(34, result.right().end());  // "inactive" = 8 chars
    }

    @Test
    void computeChangedMiddleWithCommonSuffix() {
        // left:  "BEGIN foo END"
        // right: "BEGIN foobar END"
        // Prefix: "BEGIN", " "  -> 2 tokens
        // Suffix: " ", "END"   -> 2 tokens (suffix can only use maxSuffix = min(3,4)-2 = 1 here)
        // Actually: a=["BEGIN"," ","foo"," ","END"], b=["BEGIN"," ","foobar"," ","END"]
        // prefix=2 ("BEGIN"," "), maxSuffix=min(5,5)-2=3
        // suffix check: a[4]="END"==b[4]="END" -> suffix=1; a[3]=" "==b[3]=" " -> suffix=2;
        //               a[2]="foo" != b[2]="foobar" -> stop at suffix=2
        // left midStart=2, midEnd=5-2=3 -> token "foo" -> charRange = 6..9
        // right midStart=2, midEnd=5-2=3 -> token "foobar" -> charRange = 6..12
        var result = WordDiff.compute("BEGIN foo END", "BEGIN foobar END");
        assertNotNull(result);
        assertEquals(6, result.left().start());
        assertEquals(9, result.left().end());
        assertEquals(6, result.right().start());
        assertEquals(12, result.right().end());
    }

    @Test
    void computeInlineMaxCharsThreshold() {
        // Exactly at the threshold: should NOT be null
        int halfMax = WordDiff.INLINE_MAX_CHARS / 2;
        String left  = "a".repeat(halfMax);
        String right = "b".repeat(halfMax);
        // combined = 20_000 exactly — the guard is "> 20_000" (strictly greater), so this is OK
        assertNotNull(WordDiff.compute(left, right));

        // One over the threshold: should be null
        assertNull(WordDiff.compute(left + "x", right));
    }
}
