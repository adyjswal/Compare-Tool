package com.adityakumar.engine;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.List;

class DifferTest {
    @Test void unchangedLinesAreUnchanged() {
        var r = Differ.diffLines(List.of("a","b","c"), List.of("a","b","c"), new DiffOptions());
        assertEquals(3, r.summary().unchanged());
        assertEquals(0, r.summary().added() + r.summary().removed() + r.summary().changed());
    }
    @Test void addedLineDetected() {
        var r = Differ.diffLines(List.of("a","b"), List.of("a","b","c"), new DiffOptions());
        assertEquals(1, r.summary().added()); assertEquals(0, r.summary().removed());
    }
    @Test void removedLineDetected() {
        var r = Differ.diffLines(List.of("a","b","c"), List.of("a","c"), new DiffOptions());
        assertEquals(1, r.summary().removed()); assertEquals(0, r.summary().added());
    }
    @Test void keyModMatchesByColumn() {
        var key = new ColumnSpec(",", 1);
        var r = Differ.diffLines(List.of("1,alice","2,bob"), List.of("1,alicia","2,bob","3,carol"),
            new DiffOptions("positional", key, true, false));
        assertEquals(1, r.summary().changed());
        assertEquals(1, r.summary().unchanged());
        assertEquals(1, r.summary().added());
    }
    @Test void emptyVsNonEmpty() {
        var r = Differ.diffLines(List.of(), List.of("a","b"), new DiffOptions());
        assertEquals(2, r.summary().added()); assertEquals(0, r.summary().removed());
    }
}
