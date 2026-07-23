package com.adityakumar.engine;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Display-row model for the "unchanged rows" view — a faithful Java port of the
 * TypeScript {@code rowModel.ts} in the VS Code extension.
 *
 * <p>The diff view is a windowed virtual list indexed by <em>display index</em>
 * ({@code 0..count-1}). A display index maps to either an absolute row index
 * (into the raw diff result) or a <strong>fold marker</strong> that stands in
 * for a collapsed run of unchanged rows.
 *
 * <h3>Three view modes</h3>
 * <ul>
 *   <li>{@link ViewMode#ALL} — every row shown; identity mapping, no allocation.</li>
 *   <li>{@link ViewMode#CHANGES} — only rows with {@code status != 0} are shown;
 *       unchanged rows are hidden.</li>
 *   <li>{@link ViewMode#COLLAPSED} — GitHub-style: {@link #CONTEXT_ROWS} rows of
 *       context are kept on each side of a change; unchanged runs longer than
 *       {@code 2 * CONTEXT_ROWS} are collapsed into a single fold-marker slot
 *       (unless the user has expanded that run).</li>
 * </ul>
 *
 * <h3>Map encoding</h3>
 * {@code map[d] >= 0} → absolute row index.
 * {@code map[d] < 0}  → fold marker; {@code foldId = -1 - map[d]}.
 *
 * <p>This class is pure Java with no SWT/UI dependencies; it is fully
 * unit-testable without a running Eclipse workbench.
 */
public final class DisplayRowModel {

    /** Default context rows kept on each side of a fold. */
    public static final int CONTEXT_ROWS = 3;

    // ------------------------------------------------------------------ //
    //  Public types                                                        //
    // ------------------------------------------------------------------ //

    /** Which unchanged-row view is active. */
    public enum ViewMode { ALL, CHANGES, COLLAPSED }

    /**
     * A collapsed run of unchanged rows.
     *
     * <p>{@code [start, end)} is the folded (hidden) range;
     * {@code count = end - start}. {@code runStart} is the first row of the
     * <em>whole</em> unchanged run this fold belongs to — a stable key for the
     * expanded set (it does not change when context size changes), so expansion
     * survives model rebuilds.
     */
    public static final class Fold {
        /** First absolute row of the whole unchanged run (stable key for expanded set). */
        public final int runStart;
        /** First hidden absolute row ({@code = runStart + context}). */
        public final int start;
        /** Exclusive end of the hidden range ({@code = runEnd - context}). */
        public final int end;
        /** Number of hidden rows ({@code = end - start}). */
        public final int count;

        public Fold(int runStart, int start, int end, int count) {
            this.runStart = runStart;
            this.start    = start;
            this.end      = end;
            this.count    = count;
        }

        @Override
        public String toString() {
            return "Fold{runStart=" + runStart + ", start=" + start
                    + ", end=" + end + ", count=" + count + "}";
        }
    }

    /**
     * The complete display model returned by {@link #build}.
     *
     * <p>{@code null} fields mean "identity / not needed" — they are used only
     * in {@link ViewMode#ALL} or when {@code total == 0}.
     */
    public static final class Model {
        /** Number of display rows the virtual list should render. */
        public final int count;
        /**
         * Display index → encoded value.
         * {@code null} means identity (display index <em>is</em> the absolute row).
         * {@code map[d] >= 0}: absolute row index.
         * {@code map[d] < 0}: fold, id = {@code -1 - map[d]}.
         */
        public final int[] map;
        /** Fold objects indexed by fold id (may be empty). */
        public final Fold[] folds;
        /**
         * Absolute row → display index.
         * {@code null} = identity.
         * Hidden rows in collapsed mode point to their fold's display slot.
         * Hidden rows in changes mode point to the nearest following visible row.
         */
        public final int[] absToDisplay;
        /**
         * Per-display-row status code for the overview ruler.
         * Fold slots encode as {@code 0} (unchanged).
         * {@code null} = use the original status column directly (ALL mode).
         */
        public final byte[] displayStatuses;

        private Model(int count, int[] map, Fold[] folds,
                      int[] absToDisplay, byte[] displayStatuses) {
            this.count          = count;
            this.map            = map;
            this.folds          = folds;
            this.absToDisplay   = absToDisplay;
            this.displayStatuses = displayStatuses;
        }

        /**
         * Translate an absolute row to a display index.
         * Returns {@code abs} when the mapping is the identity (ALL mode).
         */
        public int displayOf(int abs) {
            return absToDisplay != null ? absToDisplay[abs] : abs;
        }

        /**
         * Decode a display slot into its absolute row index, or {@code -1} if it
         * is a fold marker.
         *
         * @param d display index
         * @return absolute row index, or {@code -1} for a fold slot
         */
        public int absoluteOf(int d) {
            if (map == null) return d;       // identity
            int v = map[d];
            return v >= 0 ? v : -1;
        }

        /**
         * If display slot {@code d} is a fold, return the {@link Fold}; else
         * {@code null}.
         */
        public Fold foldAt(int d) {
            if (map == null) return null;
            int v = map[d];
            if (v >= 0) return null;
            int foldId = -1 - v;
            return folds[foldId];
        }
    }

    // ------------------------------------------------------------------ //
    //  Factory                                                             //
    // ------------------------------------------------------------------ //

    private DisplayRowModel() {}

    /**
     * Build the display model for a status column under the given view mode.
     *
     * @param statuses per-row status bytes (0 unchanged, 1 added, 2 removed, 3 changed).
     *                 Length equals the total number of diff rows.
     * @param mode     which unchanged-row view is active
     * @param context  context rows kept on each side of a fold ({@link ViewMode#COLLAPSED})
     * @param expanded set of {@code runStart} indices the user has expanded
     *                 ({@link ViewMode#COLLAPSED})
     * @return a freshly built {@link Model}
     */
    public static Model build(byte[] statuses, ViewMode mode, int context, Set<Integer> expanded) {
        int total = statuses.length;
        if (mode == ViewMode.ALL || total == 0) {
            return identityModel(total);
        }
        if (mode == ViewMode.CHANGES) {
            return buildChangesModel(statuses, total);
        }
        return buildCollapsedModel(statuses, total, Math.max(0, context), expanded);
    }

    // ------------------------------------------------------------------ //
    //  Identity model                                                      //
    // ------------------------------------------------------------------ //

    private static Model identityModel(int total) {
        return new Model(total, null, new Fold[0], null, null);
    }

    // ------------------------------------------------------------------ //
    //  "Changes" mode                                                      //
    // ------------------------------------------------------------------ //

    /**
     * Keep only rows where {@code status != 0}; drop unchanged rows entirely.
     *
     * <p>Hidden rows map to the nearest following visible row (clamped at
     * {@code count - 1}), so jumping to a hidden row lands at the next diff.
     */
    private static Model buildChangesModel(byte[] statuses, int total) {
        // Pass 1: count non-zero rows.
        int count = 0;
        for (int i = 0; i < total; i++) {
            if (statuses[i] != 0) count++;
        }

        int[]  map            = new int[count];
        byte[] displayStatuses = new byte[count];
        int[]  absToDisplay   = new int[total];

        // Pass 2: fill arrays.
        int d = 0;
        for (int i = 0; i < total; i++) {
            if (statuses[i] != 0) {
                map[d]             = i;
                displayStatuses[d] = statuses[i];
                absToDisplay[i]    = d;
                d++;
            } else {
                // Hidden row: point at the next visible display slot (clamped).
                absToDisplay[i] = Math.min(d, Math.max(0, count - 1));
            }
        }
        return new Model(count, map, new Fold[0], absToDisplay, displayStatuses);
    }

    // ------------------------------------------------------------------ //
    //  "Collapsed" mode                                                    //
    // ------------------------------------------------------------------ //

    /**
     * GitHub-style context: {@code context} rows around each change; unchanged
     * runs longer than {@code 2 * context} become a fold (unless expanded).
     */
    private static Model buildCollapsedModel(byte[] statuses, int total,
                                             int context, Set<Integer> expanded) {
        // Pass 1: count display rows and folds.
        int[] counts = {0, 0};  // [displayCount, foldCount]
        forEachDisplaySlot(statuses, total, context, expanded,
                (abs) -> counts[0]++,
                (fold) -> { counts[0]++; counts[1]++; });

        int count     = counts[0];
        int foldCount = counts[1];

        int[]  map             = new int[count];
        byte[] displayStatuses = new byte[count];
        int[]  absToDisplay    = new int[total];
        Fold[] folds           = new Fold[foldCount];

        // Pass 2: fill arrays.
        int[] cursors = {0, 0};   // [d, f]
        forEachDisplaySlot(statuses, total, context, expanded,
                (abs) -> {
                    int d = cursors[0];
                    map[d]             = abs;
                    displayStatuses[d] = statuses[abs];
                    absToDisplay[abs]  = d;
                    cursors[0]++;
                },
                (fold) -> {
                    int d = cursors[0];
                    int f = cursors[1];
                    map[d]             = -1 - f;
                    displayStatuses[d] = 0;
                    for (int i = fold.start; i < fold.end; i++) {
                        absToDisplay[i] = d;
                    }
                    folds[f] = fold;
                    cursors[0]++;
                    cursors[1]++;
                });

        return new Model(count, map, folds, absToDisplay, displayStatuses);
    }

    // ------------------------------------------------------------------ //
    //  Core walk — the single source of truth for collapsed layout         //
    // ------------------------------------------------------------------ //

    /**
     * Walk the status column and emit the sequence of display slots for
     * {@link ViewMode#COLLAPSED}, calling the visitors for each slot.
     *
     * <p>This is shared by the size pass and fill pass so the two can never
     * disagree.  The algorithm is a faithful port of {@code forEachDisplaySlot}
     * in {@code rowModel.ts}.
     *
     * @param statuses  per-row status bytes (0 unchanged, 1 added, 2 removed, 3 changed)
     * @param total     number of rows
     * @param context   context rows on each side of a fold
     * @param expanded  set of runStart values the user has expanded
     * @param rowVisitor   called with the absolute row index for each real-row slot
     * @param foldVisitor  called with the {@link Fold} object for each fold slot
     */
    static void forEachDisplaySlot(byte[] statuses, int total, int context,
                                   Set<Integer> expanded,
                                   RowVisitor rowVisitor, FoldVisitor foldVisitor) {
        int i = 0;
        while (i < total) {
            if (statuses[i] != 0) {
                rowVisitor.visit(i);
                i++;
                continue;
            }
            // Maximal unchanged run [runStart, runEnd).
            int runStart = i;
            int runEnd   = i + 1;
            while (runEnd < total && statuses[runEnd] == 0) {
                runEnd++;
            }
            int runLen = runEnd - runStart;

            // Show the whole run when it is short or the user expanded it;
            // otherwise keep context rows on each side and fold the middle.
            if (expanded.contains(runStart) || runLen <= 2 * context) {
                for (int r = runStart; r < runEnd; r++) {
                    rowVisitor.visit(r);
                }
            } else {
                for (int r = runStart; r < runStart + context; r++) {
                    rowVisitor.visit(r);
                }
                int foldStart = runStart + context;
                int foldEnd   = runEnd   - context;
                foldVisitor.visit(new Fold(runStart, foldStart, foldEnd, foldEnd - foldStart));
                for (int r = runEnd - context; r < runEnd; r++) {
                    rowVisitor.visit(r);
                }
            }
            i = runEnd;
        }
    }

    // ------------------------------------------------------------------ //
    //  Visitor interfaces (used by the two-pass implementation)           //
    // ------------------------------------------------------------------ //

    @FunctionalInterface
    public interface RowVisitor  { void visit(int abs); }

    @FunctionalInterface
    public interface FoldVisitor { void visit(Fold fold); }
}
