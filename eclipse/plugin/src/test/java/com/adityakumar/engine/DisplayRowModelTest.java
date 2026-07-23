package com.adityakumar.engine;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Unit tests for {@link DisplayRowModel} — the fold/view-mode display model.
 *
 * <p>Mirrors the canonical test vectors from the VS Code
 * {@code extension/test/rowModel.test.ts} file.
 *
 * <p>Status encoding: u=0 (unchanged), a=1 (added), r=2 (removed), c=3 (changed).
 */
class DisplayRowModelTest {

    // ------------------------------------------------------------------ //
    //  Helpers                                                             //
    // ------------------------------------------------------------------ //

    /** Parse a compact spec like "uuacuuruu" into a byte[] status column. */
    private static byte[] statuses(String spec) {
        byte[] result = new byte[spec.length()];
        for (int i = 0; i < spec.length(); i++) {
            result[i] = switch (spec.charAt(i)) {
                case 'u' -> 0;
                case 'a' -> 1;
                case 'r' -> 2;
                case 'c' -> 3;
                default  -> throw new IllegalArgumentException("bad char: " + spec.charAt(i));
            };
        }
        return result;
    }

    /** Build a model in ALL mode with an empty expanded set. */
    private static DisplayRowModel.Model all(String spec) {
        return DisplayRowModel.build(statuses(spec), DisplayRowModel.ViewMode.ALL, 3, Set.of());
    }

    /** Build a model in CHANGES mode. */
    private static DisplayRowModel.Model changes(String spec) {
        return DisplayRowModel.build(statuses(spec), DisplayRowModel.ViewMode.CHANGES, 3, Set.of());
    }

    /** Build a model in COLLAPSED mode with context=3 and no expanded runs. */
    private static DisplayRowModel.Model collapsed(String spec) {
        return DisplayRowModel.build(statuses(spec), DisplayRowModel.ViewMode.COLLAPSED, 3, Set.of());
    }

    /** Build a model in COLLAPSED mode with context=3 and some expanded run-starts. */
    private static DisplayRowModel.Model collapsed(String spec, Integer... expandedRunStarts) {
        return DisplayRowModel.build(statuses(spec), DisplayRowModel.ViewMode.COLLAPSED, 3,
                new HashSet<>(Arrays.asList(expandedRunStarts)));
    }

    // ------------------------------------------------------------------ //
    //  ALL mode                                                            //
    // ------------------------------------------------------------------ //

    @Test
    void allModeIsIdentityNoAllocation() {
        var m = all("uacru");
        assertEquals(5, m.count);
        assertNull(m.map,            "ALL mode: map must be null");
        assertNull(m.absToDisplay,   "ALL mode: absToDisplay must be null");
        assertNull(m.displayStatuses,"ALL mode: displayStatuses must be null");
        assertEquals(0, m.folds.length);
    }

    @Test
    void allModeDisplayOfIsIdentity() {
        var m = all("uacru");
        for (int i = 0; i < 5; i++) {
            assertEquals(i, m.displayOf(i));
        }
    }

    @Test
    void emptyInputIsIdentityRegardlessOfMode() {
        var m = DisplayRowModel.build(new byte[0], DisplayRowModel.ViewMode.CHANGES, 3, Set.of());
        assertEquals(0, m.count);
        assertNull(m.map);
    }

    // ------------------------------------------------------------------ //
    //  CHANGES mode                                                        //
    // ------------------------------------------------------------------ //

    @Test
    void changesKeepsOnlyDiffRows() {
        // "uuacuuruu" — changes at abs 2(a), 3(c), 6(r)
        var m = changes("uuacuuruu");
        assertEquals(3, m.count);
        assertNotNull(m.map);
        assertArrayEquals(new int[]{2, 3, 6}, m.map);
    }

    @Test
    void changesDisplayStatuses() {
        var m = changes("uuacuuruu");
        assertNotNull(m.displayStatuses);
        assertArrayEquals(new byte[]{1, 3, 2}, m.displayStatuses);
    }

    @Test
    void changesAbsToDisplayHiddenRows() {
        // "uuacuuruu": changes at 2(d=0), 3(d=1), 6(d=2)
        // abs 0,1 (unchanged before first change) -> d=0 (next visible)
        // abs 2   (a) -> d=0
        // abs 3   (c) -> d=1
        // abs 4,5 (unchanged) -> d=2 (next visible is abs 6 at d=2)
        // abs 6   (r) -> d=2
        // abs 7,8 (trailing unchanged) -> d=2 (clamped to count-1=2)
        var m = changes("uuacuuruu");
        assertArrayEquals(new int[]{0, 0, 0, 1, 2, 2, 2, 2, 2}, m.absToDisplay);
    }

    @Test
    void changesAllUnchangedIsEmptyList() {
        var m = changes("uuuu");
        assertEquals(0, m.count);
    }

    @Test
    void changesAbsToDisplayForAllUnchanged() {
        // count=0, so all hidden rows clamp to max(0, -1) = 0
        var m = changes("uuuu");
        assertNotNull(m.absToDisplay);
        assertArrayEquals(new int[]{0, 0, 0, 0}, m.absToDisplay);
    }

    // ------------------------------------------------------------------ //
    //  COLLAPSED mode                                                      //
    // ------------------------------------------------------------------ //

    @Test
    void collapsedFoldsLongUnchangedRun() {
        // "uuuuuuuuuuc": 10 unchanged then 1 changed.
        // context=3: show rows 0,1,2; fold [3,7); show rows 7,8,9; show row 10.
        var m = collapsed("uuuuuuuuuuc");
        assertEquals(8, m.count);  // 3 + 1 fold + 3 + 1 changed
        assertEquals(1, m.folds.length);

        var fold = m.folds[0];
        assertEquals(0, fold.runStart);
        assertEquals(3, fold.start);
        assertEquals(7, fold.end);
        assertEquals(4, fold.count);

        // map: [0,1,2, -1 (fold_id=0), 7,8,9, 10]
        assertNotNull(m.map);
        assertArrayEquals(new int[]{0, 1, 2, -1, 7, 8, 9, 10}, m.map);
    }

    @Test
    void collapsedAbsToDisplayForFolded() {
        // "uuuuuuuuuuc": fold slot at display index 3.
        // Rows 3,4,5,6 are hidden -> all map to d=3.
        var m = collapsed("uuuuuuuuuuc");
        assertNotNull(m.absToDisplay);
        // Visible rows 0,1,2 -> d=0,1,2
        assertEquals(0, m.absToDisplay[0]);
        assertEquals(1, m.absToDisplay[1]);
        assertEquals(2, m.absToDisplay[2]);
        // Hidden rows 3..6 -> d=3 (the fold slot)
        assertEquals(3, m.absToDisplay[3]);
        assertEquals(3, m.absToDisplay[4]);
        assertEquals(3, m.absToDisplay[5]);
        assertEquals(3, m.absToDisplay[6]);
        // Visible rows 7,8,9 -> d=4,5,6
        assertEquals(4, m.absToDisplay[7]);
        assertEquals(5, m.absToDisplay[8]);
        assertEquals(6, m.absToDisplay[9]);
        // Changed row 10 -> d=7
        assertEquals(7, m.absToDisplay[10]);
    }

    @Test
    void collapsedDoesNotFoldRunOfExactly2xContext() {
        // "uuuuuuc": 6 unchanged = 2*3, then change. Must NOT fold.
        var m = collapsed("uuuuuuc");
        assertEquals(0, m.folds.length);
        assertEquals(7, m.count);
        // All 7 display slots are identity-like
        assertNotNull(m.map);
        assertArrayEquals(new int[]{0, 1, 2, 3, 4, 5, 6}, m.map);
    }

    @Test
    void collapsedFoldsRunOf2xContextPlusOne() {
        // "uuuuuuuc": 7 unchanged = 2*3+1, then change. MUST fold, hiding exactly 1 row.
        var m = collapsed("uuuuuuuc");
        assertEquals(1, m.folds.length);
        var fold = m.folds[0];
        assertEquals(3, fold.start);
        assertEquals(4, fold.end);   // runEnd=7, context=3 -> end=7-3=4
        assertEquals(1, fold.count);
    }

    @Test
    void collapsedExpandedRunShowsAllRows() {
        // "uuuuuuuuuuc" with runStart=0 expanded.
        var m = collapsed("uuuuuuuuuuc", 0);
        assertEquals(0, m.folds.length);
        assertEquals(11, m.count);  // all 10 unchanged + 1 changed
    }

    @Test
    void collapsedTwoIndependentFolds() {
        // "uuuuuuuucuuuuuuuuc": run A [0,8), changed @8, run B [9,17), changed @17
        // context=3: show 0,1,2; fold[3,5); show 5,6,7; show 8;
        //            show 9,10,11; fold[12,14); show 14,15,16; show 17
        var m = collapsed("uuuuuuuucuuuuuuuuc");
        assertEquals(2, m.folds.length);

        var foldA = m.folds[0];
        assertEquals(0, foldA.runStart);
        assertEquals(3, foldA.start);
        assertEquals(5, foldA.end);
        assertEquals(2, foldA.count);

        var foldB = m.folds[1];
        assertEquals(9, foldB.runStart);
        assertEquals(12, foldB.start);
        assertEquals(14, foldB.end);
        assertEquals(2, foldB.count);
    }

    @Test
    void collapsedFoldMarkerHasStatus0InDisplayStatuses() {
        var m = collapsed("uuuuuuuuuuc");
        assertNotNull(m.displayStatuses);
        // Slot 3 is the fold marker -> status 0
        assertEquals(0, m.displayStatuses[3]);
        // Slot 7 is the changed row -> status 3
        assertEquals(3, m.displayStatuses[7]);
    }

    @Test
    void collapsedDisplayOfDecoding() {
        var m = collapsed("uuuuuuuuuuc");
        // displayOf wraps absToDisplay
        assertEquals(3, m.displayOf(4));   // row 4 is in the fold at d=3
        assertEquals(7, m.displayOf(10));  // changed row 10 at d=7
    }

    @Test
    void collapsedAbsoluteOfDecoding() {
        var m = collapsed("uuuuuuuuuuc");
        // Display slot 0 -> abs row 0
        assertEquals(0, m.absoluteOf(0));
        // Display slot 3 -> fold (returns -1)
        assertEquals(-1, m.absoluteOf(3));
        // Display slot 7 -> abs row 10
        assertEquals(10, m.absoluteOf(7));
    }

    @Test
    void collapsedFoldAtDecoding() {
        var m = collapsed("uuuuuuuuuuc");
        // Slot 3 is a fold
        var fold = m.foldAt(3);
        assertNotNull(fold);
        assertEquals(3, fold.start);
        assertEquals(7, fold.end);
        // Slot 0 is a real row
        assertNull(m.foldAt(0));
    }

    @Test
    void allModeAbsoluteOfAndFoldAt() {
        var m = all("uuuc");
        // identity: absoluteOf(i) == i, foldAt always null
        assertEquals(2, m.absoluteOf(2));
        assertNull(m.foldAt(0));
        assertNull(m.foldAt(3));
    }
}
