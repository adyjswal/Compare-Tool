/**
 * Shared types for the engine. These describe the *options* callers pass in and
 * the *results* they get back. Keeping them in one place makes the public API
 * easy to see at a glance and easy to reuse from another IDE host later.
 */

/* ------------------------------------------------------------------ *
 * Sorting
 * ------------------------------------------------------------------ */

/** How two sort keys are compared. */
export type SortMode = "alphabetical" | "numeric";

/** Sort order. "asc" = A→Z / low→high, "desc" = Z→A / high→low. */
export type SortDirection = "asc" | "desc";

/**
 * Points at a single delimited column within a line (for CSV/SQL-style rows).
 * `index` is 1-based: column 1 is the first field.
 */
export interface ColumnSpec {
  /** The separator between columns, e.g. "," (default), "\t", "|", ";". */
  delimiter: string;
  /** 1-based column number to use as the sort/compare key. */
  index: number;
}

/** Everything that controls how a set of lines is sorted. */
export interface SortOptions {
  mode: SortMode;
  direction: SortDirection;
  /** Compare case-insensitively (alphabetical mode only). */
  caseInsensitive: boolean;
  /** Trim leading/trailing whitespace from the key before comparing. */
  trim: boolean;
  /** When set, sort by this one column instead of the whole line. */
  column?: ColumnSpec;
}

/** Sensible defaults: A→Z, whole-line, trim on, case-sensitive. */
export const DEFAULT_SORT_OPTIONS: SortOptions = {
  mode: "alphabetical",
  direction: "asc",
  caseInsensitive: false,
  trim: true,
};

/* ------------------------------------------------------------------ *
 * Diffing
 * ------------------------------------------------------------------ */

/**
 * Category for a single row of diff output.
 * - `unchanged` — present (and equal) on both sides
 * - `added`     — present only on the right (second file)
 * - `removed`   — present only on the left (first file)
 * - `changed`   — same key on both sides but different content (key mode only)
 */
export type DiffStatus = "unchanged" | "added" | "removed" | "changed";

/**
 * One row of the comparison, holding the line from each side where it exists.
 * `left` is the first file, `right` is the second. Either may be undefined
 * (e.g. an `added` row has no `left`).
 */
export interface DiffRow {
  status: DiffStatus;
  left?: string;
  right?: string;
}

/** Per-category counts for a whole comparison. */
export interface DiffSummary {
  unchanged: number;
  added: number;
  removed: number;
  changed: number;
  /** Total number of rows (sum of the four categories). */
  total: number;
}

/** The full result of comparing two files. */
export interface DiffResult {
  rows: DiffRow[];
  summary: DiffSummary;
}

/** Options that control how two line lists are compared. */
export interface DiffOptions {
  /**
   * When set, rows are matched by this key column instead of by the whole line.
   * Matching keys with differing content become `changed` rows. When omitted,
   * the comparison is a plain set difference (added/removed/unchanged only).
   */
  key?: ColumnSpec;
  /** Trim each line before comparing. Default: true. */
  trim?: boolean;
  /** Compare case-insensitively. Default: false. */
  caseInsensitive?: boolean;
}
