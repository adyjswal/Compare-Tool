package com.adityakumar.engine;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SorterTest {

    // ---- numeric sort (the bug: was lexicographic, must be numeric) ----

    /** Core regression: ["10","9","100"] must sort to [9,10,100], NOT [10,100,9]. */
    @Test
    void numericAscNotLexicographic() {
        var result = Sorter.sortLines(
                List.of("10", "9", "100"),
                new SortOptions(SortOptions.Mode.NUMERIC, SortOptions.Direction.ASC, false, true, null));
        assertEquals(List.of("9", "10", "100"), result,
                "NUMERIC ASC must order by value, not lexicographically");
    }

    @Test
    void numericDescNotLexicographic() {
        var result = Sorter.sortLines(
                List.of("10", "9", "100"),
                new SortOptions(SortOptions.Mode.NUMERIC, SortOptions.Direction.DESC, false, true, null));
        assertEquals(List.of("100", "10", "9"), result);
    }

    @Test
    void nonNumericKeysOrderedAfterNumeric() {
        // Non-parseable keys must appear AFTER all numeric keys in ASC order.
        var result = Sorter.sortLines(
                List.of("abc", "5", "10", "1"),
                new SortOptions(SortOptions.Mode.NUMERIC, SortOptions.Direction.ASC, false, true, null));
        assertEquals(List.of("1", "5", "10", "abc"), result);
    }

    @Test
    void floatingPointNumericSort() {
        var result = Sorter.sortLines(
                List.of("3.14", "1.0", "2.718"),
                new SortOptions(SortOptions.Mode.NUMERIC, SortOptions.Direction.ASC, false, true, null));
        assertEquals(List.of("1.0", "2.718", "3.14"), result);
    }

    @Test
    void negativeNumbersNumericSort() {
        var result = Sorter.sortLines(
                List.of("5", "-3", "0", "10"),
                new SortOptions(SortOptions.Mode.NUMERIC, SortOptions.Direction.ASC, false, true, null));
        assertEquals(List.of("-3", "0", "5", "10"), result);
    }

    // ---- alphabetical sort ----

    @Test
    void alphabeticalAscCaseInsensitive() {
        var result = Sorter.sortLines(
                List.of("banana", "Apple", "cherry"),
                new SortOptions(SortOptions.Mode.ALPHABETICAL, SortOptions.Direction.ASC, true, true, null));
        assertEquals(List.of("Apple", "banana", "cherry"), result);
    }

    @Test
    void alphabeticalDesc() {
        var result = Sorter.sortLines(
                List.of("a", "c", "b"),
                new SortOptions(SortOptions.Mode.ALPHABETICAL, SortOptions.Direction.DESC, false, true, null));
        assertEquals(List.of("c", "b", "a"), result);
    }

    // ---- trim interacts with numeric ----

    @Test
    void numericWithLeadingSpaceTrimmed() {
        // "  10" with trim=true should be treated as 10, not "  10" (which is NaN).
        var result = Sorter.sortLines(
                List.of("  10", " 9", "100"),
                new SortOptions(SortOptions.Mode.NUMERIC, SortOptions.Direction.ASC, false, true, null));
        assertEquals(List.of(" 9", "  10", "100"), result);
    }
}
