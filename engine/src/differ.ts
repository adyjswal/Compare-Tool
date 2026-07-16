/**
 * Comparing two (already sorted) line lists.
 *
 * Two modes, per the design we agreed on:
 *
 *  - Whole-line (default): a set difference. Uses the `diff` package's
 *    `diffArrays` over the two line arrays, so lines present on only one side
 *    become `added`/`removed` and shared lines are `unchanged`. Duplicates are
 *    preserved (3 copies on the left vs 1 on the right → 2 `removed`).
 *
 *  - Key column: record reconciliation. Rows are matched by a delimited key
 *    column; a matching key with different content is a `changed` row. This is
 *    the real replacement for the "sort + eyeball in Excel" workflow.
 *
 * `trim` / `caseInsensitive` control how equality is judged in both modes.
 */
import { diffArrays } from "diff";
import { extractColumn } from "./sorter";
import { ColumnSpec, DiffOptions, DiffResult, DiffRow, DiffStatus, DiffSummary } from "./types";

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
    : diffWholeLine(left, right, normalize);

  return { rows, summary: summarize(rows) };
}

/* ------------------------------------------------------------------ *
 * Whole-line set difference (via the `diff` package)
 * ------------------------------------------------------------------ */

function diffWholeLine(
  left: readonly string[],
  right: readonly string[],
  normalize: (s: string) => string,
): DiffRow[] {
  const changes = diffArrays(left as string[], right as string[], {
    comparator: (a, b) => normalize(a) === normalize(b),
  });

  const rows: DiffRow[] = [];
  for (const change of changes) {
    if (change.added) {
      for (const line of change.value) rows.push({ status: "added", right: line });
    } else if (change.removed) {
      for (const line of change.value) rows.push({ status: "removed", left: line });
    } else {
      // Common run: equal under the current comparator. We show one
      // representation for both sides (they only differ by case/whitespace).
      for (const line of change.value) rows.push({ status: "unchanged", left: line, right: line });
    }
  }
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
