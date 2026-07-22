package com.adityakumar.engine;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

class DifferTest {
    /* ---- basic status detection ---- */

    @Test void unchangedLinesAreUnchanged() {
        var r = Differ.diffLines(List.of("a", "b", "c"), List.of("a", "b", "c"), new DiffOptions());
        assertEquals(3, r.summary().unchanged());
        assertEquals(0, r.summary().added() + r.summary().removed() + r.summary().changed());
    }

    @Test void addedLineDetected() {
        var r = Differ.diffLines(List.of("a", "b"), List.of("a", "b", "c"), new DiffOptions());
        assertEquals(1, r.summary().added());
        assertEquals(0, r.summary().removed());
    }

    @Test void removedLineDetected() {
        var r = Differ.diffLines(List.of("a", "b", "c"), List.of("a", "c"), new DiffOptions());
        assertEquals(1, r.summary().removed());
        assertEquals(0, r.summary().added());
    }

    @Test void emptyVsNonEmpty() {
        var r = Differ.diffLines(List.of(), List.of("a", "b"), new DiffOptions());
        assertEquals(2, r.summary().added());
        assertEquals(0, r.summary().removed());
    }

    @Test void trimOptionTreatsTrimmedLinesAsEqual() {
        var r = Differ.diffLines(List.of("hello "), List.of("hello"), new DiffOptions());
        assertEquals(1, r.summary().unchanged());
    }

    @Test void caseInsensitiveTreatsCaseOnlyDifferenceAsEqual() {
        var r = Differ.diffLines(List.of("Hello"), List.of("hello"),
                new DiffOptions("positional", null, true, true));
        assertEquals(1, r.summary().unchanged());
        assertEquals(0, r.summary().changed());
    }

    /* ---- positional `changed` pairing (Sørensen–Dice) ---- */

    @Test void similarEditedLineBecomesChanged() {
        var left = List.of("id=1000 name=alice status=active");
        var right = List.of("id=1000 name=alice status=inactive");
        var r = Differ.diffLines(left, right, new DiffOptions());
        assertEquals(1, r.summary().changed());
        assertEquals(0, r.summary().removed());
        assertEquals(0, r.summary().added());
    }

    @Test void unrelatedLinesStaySeparate() {
        var r = Differ.diffLines(List.of("the quick brown fox"), List.of("9999 zzz qqq"), new DiffOptions());
        assertEquals(0, r.summary().changed());
        assertEquals(1, r.summary().removed());
        assertEquals(1, r.summary().added());
    }

    @Test void pairChangedFalseIsGitStyle() {
        var left = List.of("id=1000 name=alice status=active");
        var right = List.of("id=1000 name=alice status=inactive");
        var r = Differ.diffLines(left, right, new DiffOptions("positional", null, true, false, false));
        assertEquals(0, r.summary().changed());
        assertEquals(1, r.summary().removed());
        assertEquals(1, r.summary().added());
    }

    /* ---- set mode ---- */

    @Test void setModeNeverProducesChanged() {
        var left = List.of("id=1000 name=alice status=active");
        var right = List.of("id=1000 name=alice status=inactive");
        var r = Differ.diffLines(left, right, new DiffOptions("set", null, true, false));
        assertEquals(0, r.summary().changed());
        assertEquals(1, r.summary().removed());
        assertEquals(1, r.summary().added());
    }

    /* ---- prefix/suffix fast path ---- */

    @Test void singleChangeBuriedInLargeEqualBlock() {
        List<String> left = new ArrayList<>();
        for (int i = 0; i < 5000; i++) left.add("line " + i);
        List<String> right = new ArrayList<>(left);
        right.set(2500, "line 2500 CHANGED");
        var r = Differ.diffLines(left, right, new DiffOptions());
        assertEquals(4999, r.summary().unchanged());
        assertEquals(1, r.summary().changed());
    }

    /* ---- large-file regression: the bug the old O(m*n) LCS could not handle ---- */

    @Test void twoHundredKLinesNoCollapse() {
        int n = 200_000;
        List<String> left = new ArrayList<>(n);
        for (int i = 0; i < n; i++) left.add("row " + i + " value " + (i % 7));
        List<String> right = new ArrayList<>(n);
        for (int i = 0; i < n; i++) right.add(i % 10 == 0 ? left.get(i) + " EDIT" : left.get(i));

        var r = Differ.diffLines(left, right, new DiffOptions());

        // The old naive LCS returned an empty LCS above ~2.2k lines, making
        // EVERY row removed+added (unchanged == 0). Patience diff must keep the
        // ~90% of untouched rows as unchanged.
        assertEquals(n * 9 / 10, r.summary().unchanged());
        assertEquals(n / 10, r.summary().changed());
        assertEquals(0, r.summary().removed());
        assertEquals(0, r.summary().added());
    }

    /* ---- partition correctness ---- */

    @Test void everyLineAppearsExactlyOnce() {
        var left = List.of("a", "b", "c", "d", "e");
        var right = List.of("a", "x", "c", "y", "z", "e");
        var r = Differ.diffLines(left, right, new DiffOptions());

        var leftSeen = r.rows().stream().map(DiffRow::left).filter(Objects::nonNull).toList();
        var rightSeen = r.rows().stream().map(DiffRow::right).filter(Objects::nonNull).toList();
        assertEquals(left, leftSeen);
        assertEquals(right, rightSeen);
    }

    /* ---- key-column mode ---- */

    @Test void keyModeMatchesByColumn() {
        var key = new ColumnSpec(",", 1);
        var r = Differ.diffLines(List.of("1,alice", "2,bob"), List.of("1,alicia", "2,bob", "3,carol"),
                new DiffOptions("positional", key, true, false));
        assertEquals(1, r.summary().changed());
        assertEquals(1, r.summary().unchanged());
        assertEquals(1, r.summary().added());
    }

    @Test void keyModeIsDeterministicInSortedOrder() {
        var key = new ColumnSpec(",", 1);
        var r = Differ.diffLines(List.of("30,c", "10,a", "20,b"), List.of("20,b", "10,a", "30,c"),
                new DiffOptions("positional", key, true, false));
        assertEquals(3, r.summary().unchanged());
        var keysInOrder = r.rows().stream().map(row -> row.left().split(",")[0]).toList();
        assertEquals(List.of("10", "20", "30"), keysInOrder);
    }

    @Test void keyModePreservesDuplicateKeys() {
        // Two rows share key "1"; the old Map<String,String> kept only the last,
        // silently dropping a row. Grouped pairing must keep both.
        var key = new ColumnSpec(",", 1);
        var r = Differ.diffLines(List.of("1,alice", "1,alice2"), List.of("1,alice"),
                new DiffOptions("positional", key, true, false));
        assertEquals(1, r.summary().unchanged());
        assertEquals(1, r.summary().removed());
        assertEquals(0, r.summary().added());
        assertEquals(2, r.summary().total());
    }
}
