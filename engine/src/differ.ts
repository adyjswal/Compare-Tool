/**
 * Comparing two line lists.
 *
 * Three behaviors, chosen by the caller (the extension decides whether it
 * sorted the input, and passes options accordingly):
 *
 *  - Whole-line, "positional" (default): compare files in their existing order.
 *    Uses the `diff` package's `diffArrays` (an LCS/Myers diff); a removed line
 *    paired with the added line that replaced it becomes a `changed` row — the
 *    familiar side-by-side diff. Use when line order is meaningful.
 *
 *  - Whole-line, "set": same `diffArrays` comparison but with no pairing, so a
 *    modified line stays as a separate `removed` + `added`. Use after sorting,
 *    where line positions are no longer meaningful.
 *
 *  - Key column: record reconciliation. Rows are matched by a delimited key
 *    column; a matching key with different content is a `changed` row. This is
 *    the "sort + eyeball in Excel" replacement.
 *
 * In every mode, duplicates are preserved and `trim` / `caseInsensitive`
 * control how equality is judged.
 */
import { diffArrays } from "diff";
import { extractColumn } from "./sorter";
import {
  ColumnSpec,
  DiffMode,
  DiffOptions,
  DiffResult,
  DiffRow,
  DiffStatus,
  DiffSummary,
} from "./types";

/** Compare two line lists and return categorized rows plus a summary. */
export function diffLines(
  left: readonly string[],
  right: readonly string[],
  options: DiffOptions = {},
): DiffResult {
  const trim = options.trim ?? true;
  const caseInsensitive = options.caseInsensitive ?? false;
  const normalize = makeNormalizer(trim, caseInsensitive);

  const rows = options.key
    ? diffByKey(left, right, options.key, normalize)
    : diffWholeLine(left, right, options.mode ?? "positional", normalize);

  return { rows, summary: summarize(rows) };
}

/* ------------------------------------------------------------------ *
 * Whole-line comparison (via the `diff` package)
 * ------------------------------------------------------------------ */

function diffWholeLine(
  left: readonly string[],
  right: readonly string[],
  mode: DiffMode,
  normalize: (s: string) => string,
): DiffRow[] {
  const changes = diffArrays(left as string[], right as string[], {
    comparator: (a, b) => normalize(a) === normalize(b),
  });
  return mode === "positional" ? toRowsPositional(changes) : toRowsSet(changes);
}

type ArrayChange = { value: string[]; added?: boolean; removed?: boolean };

/**
 * "set" mode: emit each run as-is. Modified lines surface as separate
 * `removed` + `added` — appropriate once the input has been sorted.
 */
function toRowsSet(changes: ArrayChange[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const change of changes) {
    if (change.added) {
      for (const line of change.value) rows.push({ status: "added", right: line });
    } else if (change.removed) {
      for (const line of change.value) rows.push({ status: "removed", left: line });
    } else {
      for (const line of change.value) rows.push({ status: "unchanged", left: line, right: line });
    }
  }
  return rows;
}

/**
 * "positional" mode: pair a run of removed lines with the run of added lines
 * that replaced it into `changed` rows (leftovers stay pure removed/added).
 *
 * We buffer pending removed/added lines and flush them at each unchanged
 * boundary, so pairing is localized to one modified block and works regardless
 * of the order `diffArrays` happens to emit removed vs added.
 */
function toRowsPositional(changes: ArrayChange[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let pendingRemoved: string[] = [];
  let pendingAdded: string[] = [];

  const flush = () => {
    const paired = Math.min(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < paired; i++) {
      rows.push({ status: "changed", left: pendingRemoved[i], right: pendingAdded[i] });
    }
    for (let i = paired; i < pendingRemoved.length; i++) {
      rows.push({ status: "removed", left: pendingRemoved[i] });
    }
    for (let i = paired; i < pendingAdded.length; i++) {
      rows.push({ status: "added", right: pendingAdded[i] });
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const change of changes) {
    if (change.removed) {
      pendingRemoved.push(...change.value);
    } else if (change.added) {
      pendingAdded.push(...change.value);
    } else {
      flush();
      for (const line of change.value) rows.push({ status: "unchanged", left: line, right: line });
    }
  }
  flush();
  return rows;
}

/* ------------------------------------------------------------------ *
 * Key-based reconciliation (enables `changed`)
 * ------------------------------------------------------------------ */

function diffByKey(
  left: readonly string[],
  right: readonly string[],
  key: ColumnSpec,
  normalize: (s: string) => string,
): DiffRow[] {
  const keyOf = (line: string) => normalize(extractColumn(line, key));
  const leftGroups = groupByKey(left, keyOf);
  const rightGroups = groupByKey(right, keyOf);

  // Deterministic output: walk the union of keys in sorted order.
  const keys = [...new Set([...leftGroups.keys(), ...rightGroups.keys()])].sort();

  const rows: DiffRow[] = [];
  for (const k of keys) {
    const leftLines = leftGroups.get(k) ?? [];
    const rightLines = rightGroups.get(k) ?? [];
    const pairs = Math.max(leftLines.length, rightLines.length);

    // Pair rows sharing a key positionally; leftovers are added/removed.
    for (let i = 0; i < pairs; i++) {
      const leftLine = leftLines[i];
      const rightLine = rightLines[i];

      if (leftLine !== undefined && rightLine !== undefined) {
        const status: DiffStatus =
          normalize(leftLine) === normalize(rightLine) ? "unchanged" : "changed";
        rows.push({ status, left: leftLine, right: rightLine });
      } else if (leftLine !== undefined) {
        rows.push({ status: "removed", left: leftLine });
      } else if (rightLine !== undefined) {
        rows.push({ status: "added", right: rightLine });
      }
    }
  }
  return rows;
}

function groupByKey(
  lines: readonly string[],
  keyOf: (line: string) => string,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const line of lines) {
    const k = keyOf(line);
    const bucket = groups.get(k);
    if (bucket) {
      bucket.push(line);
    } else {
      groups.set(k, [line]);
    }
  }
  return groups;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Build a normalizer that applies trim/lower-case for equality checks, caching
 * per unique string so we don't re-normalize the same line many times during a
 * large comparison.
 */
function makeNormalizer(trim: boolean, caseInsensitive: boolean): (s: string) => string {
  const cache = new Map<string, string>();
  return (s: string) => {
    const cached = cache.get(s);
    if (cached !== undefined) {
      return cached;
    }
    let n = s;
    if (trim) n = n.trim();
    if (caseInsensitive) n = n.toLowerCase();
    cache.set(s, n);
    return n;
  };
}

function summarize(rows: readonly DiffRow[]): DiffSummary {
  const summary: DiffSummary = {
    unchanged: 0,
    added: 0,
    removed: 0,
    changed: 0,
    total: rows.length,
  };
  for (const row of rows) {
    summary[row.status]++;
  }
  return summary;
}
