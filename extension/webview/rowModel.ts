/**
 * Display-row model for the "unchanged rows" view.
 *
 * The diff view is a windowed virtual list indexed by *absolute* row (an index
 * into the status column, `0..total-1`). To hide or collapse unchanged rows we
 * insert a mapping layer: a *display index* (what the virtual list actually
 * renders, `0..count-1`) maps to either an absolute row or a **fold marker**
 * standing in for a collapsed run of unchanged rows.
 *
 * A fold is rendered as one normal-height row, so the scaled virtualizer (see
 * scrollMapping.ts / DiffList.tsx) is unaffected — only the index space changes.
 *
 * Three modes:
 *  - "all"       — every row (identity mapping; nothing is allocated).
 *  - "changes"   — only rows that differ (unchanged rows hidden entirely).
 *  - "collapsed" — GitHub-style: a few context rows around each change, with
 *                  long unchanged runs folded into an expandable "⋯ N unchanged
 *                  lines" marker.
 *
 * No React or DOM here, so it is unit-testable in plain Node.
 */

/** Which unchanged-row view is active. */
export type ViewMode = "all" | "collapsed" | "changes";

/**
 * A collapsed run of unchanged rows. `[start, end)` is the folded (hidden)
 * range; `count = end - start`. `runStart` is the first row of the *whole*
 * unchanged run this fold belongs to — a stable key for the expanded set (it
 * doesn't move when context size changes), so expansion survives rebuilds.
 */
export interface Fold {
  runStart: number;
  start: number;
  end: number;
  count: number;
}

/**
 * The display list derived from the status column. `null` fields mean "identity
 * / not needed" (the "all" mode fast path — no per-row allocation).
 */
export interface RowModel {
  /** Number of display rows the virtual list should render. */
  count: number;
  /**
   * Display index → row. `null` = identity (display index *is* the absolute
   * row). Otherwise: value `>= 0` is an absolute row; a negative value encodes
   * a fold id as `-1 - value` (index into `folds`).
   */
  map: Int32Array | null;
  /** Fold markers, indexed by fold id. Empty unless a run was collapsed. */
  folds: Fold[];
  /**
   * Absolute row → display index. `null` = identity. A hidden row maps to the
   * display index of the fold that covers it (collapsed mode) or to the nearest
   * following visible row (changes mode) — so jumping to it still lands close.
   */
  absToDisplay: Int32Array | null;
  /**
   * Per-display-row status code for the overview ruler (fold rows encode as 0 /
   * unchanged). `null` = use the original status column directly ("all" mode).
   */
  displayStatuses: Uint8Array | null;
}

/** Default number of context rows kept on each side of a collapsed run. */
export const CONTEXT_ROWS = 3;

/** The identity model: render every row as-is (no mapping, no allocation). */
function identityModel(total: number): RowModel {
  return { count: total, map: null, folds: [], absToDisplay: null, displayStatuses: null };
}

/**
 * Build the display model for a status column under the given view mode.
 *
 * @param statuses  per-row status code (0 unchanged, 1 added, 2 removed, 3 changed)
 * @param mode      which unchanged-row view is active
 * @param context   context rows kept on each side of a fold (collapsed mode)
 * @param expanded  set of run-start indices the user has expanded (collapsed mode)
 */
export function buildRowModel(
  statuses: Uint8Array,
  mode: ViewMode,
  context: number,
  expanded: Set<number>,
): RowModel {
  const total = statuses.length;
  if (mode === "all" || total === 0) {
    return identityModel(total);
  }
  if (mode === "changes") {
    return buildChangesModel(statuses, total);
  }
  return buildCollapsedModel(statuses, total, Math.max(0, context), expanded);
}

/** "Only changes": keep rows whose status !== 0; drop the rest. */
function buildChangesModel(statuses: Uint8Array, total: number): RowModel {
  // Count first so the arrays are sized exactly (no growth churn at 1M rows).
  let count = 0;
  for (let i = 0; i < total; i++) {
    if (statuses[i] !== 0) count++;
  }
  const map = new Int32Array(count);
  const displayStatuses = new Uint8Array(count);
  const absToDisplay = new Int32Array(total);
  let d = 0;
  for (let i = 0; i < total; i++) {
    if (statuses[i] !== 0) {
      map[d] = i;
      displayStatuses[d] = statuses[i];
      absToDisplay[i] = d;
      d++;
    } else {
      // Hidden row: point at the next visible display row (clamped at the end).
      absToDisplay[i] = Math.min(d, Math.max(0, count - 1));
    }
  }
  return { count, map, folds: [], absToDisplay, displayStatuses };
}

/**
 * "Collapsed": context rows around each change; unchanged runs longer than
 * `2 * context` become a single fold (unless the user expanded that run).
 */
function buildCollapsedModel(
  statuses: Uint8Array,
  total: number,
  context: number,
  expanded: Set<number>,
): RowModel {
  // Two passes: one to size the arrays, one to fill them. Keeping the shape
  // logic in a single generator avoids the two passes drifting apart.
  let count = 0;
  let foldCount = 0;
  forEachDisplaySlot(statuses, total, context, expanded, {
    row: () => {
      count++;
    },
    fold: () => {
      count++;
      foldCount++;
    },
  });

  const map = new Int32Array(count);
  const displayStatuses = new Uint8Array(count);
  const absToDisplay = new Int32Array(total);
  const folds: Fold[] = new Array(foldCount);
  let d = 0;
  let f = 0;
  forEachDisplaySlot(statuses, total, context, expanded, {
    row: (abs) => {
      map[d] = abs;
      displayStatuses[d] = statuses[abs];
      absToDisplay[abs] = d;
      d++;
    },
    fold: (fold) => {
      map[d] = -1 - f;
      displayStatuses[d] = 0;
      // Every hidden row in the folded range points at this fold's display row.
      for (let i = fold.start; i < fold.end; i++) {
        absToDisplay[i] = d;
      }
      folds[f] = fold;
      f++;
      d++;
    },
  });

  return { count, map, folds, absToDisplay, displayStatuses };
}

/**
 * Walk the status column and emit the sequence of display slots (real rows and
 * fold markers) for collapsed mode, calling the visitor for each. Shared by the
 * size and fill passes so they can never disagree.
 */
function forEachDisplaySlot(
  statuses: Uint8Array,
  total: number,
  context: number,
  expanded: Set<number>,
  visit: { row: (abs: number) => void; fold: (fold: Fold) => void },
): void {
  let i = 0;
  while (i < total) {
    if (statuses[i] !== 0) {
      visit.row(i);
      i++;
      continue;
    }
    // Maximal unchanged run [runStart, runEnd).
    const runStart = i;
    let runEnd = i + 1;
    while (runEnd < total && statuses[runEnd] === 0) {
      runEnd++;
    }
    const runLen = runEnd - runStart;
    // Show the whole run when it's short or the user expanded it; otherwise keep
    // `context` rows on each side and fold the middle.
    if (expanded.has(runStart) || runLen <= 2 * context) {
      for (let r = runStart; r < runEnd; r++) {
        visit.row(r);
      }
    } else {
      for (let r = runStart; r < runStart + context; r++) {
        visit.row(r);
      }
      const foldStart = runStart + context;
      const foldEnd = runEnd - context;
      visit.fold({ runStart, start: foldStart, end: foldEnd, count: foldEnd - foldStart });
      for (let r = runEnd - context; r < runEnd; r++) {
        visit.row(r);
      }
    }
    i = runEnd;
  }
}
