/**
 * Sorting lines.
 *
 * We use the classic "decorate → sort → undecorate" pattern: compute each
 * line's comparison key exactly once, sort on the precomputed keys, then return
 * the original lines in the new order. This matters at 200k–300k lines, where
 * recomputing the key inside every comparison would be wasteful.
 *
 * The sort is stable (V8's Array.prototype.sort is), so lines with equal keys
 * keep their original relative order regardless of direction.
 */
import { ColumnSpec, DEFAULT_SORT_OPTIONS, SortOptions } from "./types";

/** Sort `lines` according to `options`, returning a new array (input untouched). */
export function sortLines(lines: readonly string[], options?: Partial<SortOptions>): string[] {
  const opts: SortOptions = { ...DEFAULT_SORT_OPTIONS, ...options };
  const keyOf = makeKeyFn(opts);
  const decorated = lines.map((line) => ({ line, key: keyOf(line) }));

  const direction = opts.direction === "desc" ? -1 : 1;
  if (opts.mode === "numeric") {
    decorated.sort((a, b) => compareNumeric(a.key as number, b.key as number) * direction);
  } else {
    decorated.sort((a, b) => compareString(a.key as string, b.key as string) * direction);
  }

  return decorated.map((d) => d.line);
}

/**
 * Extract the sort/compare key from a line: pick a column (or the whole line),
 * optionally trim, then either parse a number (numeric mode) or lower-case it
 * (case-insensitive alphabetical mode).
 */
function makeKeyFn(opts: SortOptions): (line: string) => string | number {
  return (line: string) => {
    let field = opts.column ? extractColumn(line, opts.column) : line;
    if (opts.trim) {
      field = field.trim();
    }
    if (opts.mode === "numeric") {
      return parseNumeric(field);
    }
    return opts.caseInsensitive ? field.toLowerCase() : field;
  };
}

/**
 * Return the value of a 1-based delimited column, or "" if the column is
 * missing. Shared with the differ so key extraction stays consistent.
 */
export function extractColumn(line: string, column: ColumnSpec): string {
  const parts = line.split(column.delimiter);
  const index = column.index - 1; // 1-based → 0-based
  return index >= 0 && index < parts.length ? parts[index] : "";
}

/** Parse a numeric key. Blank fields and non-numbers become NaN. */
function parseNumeric(field: string): number {
  if (field.trim() === "") {
    return NaN;
  }
  // parseFloat is lenient (e.g. "12 items" → 12), which matches the intuitive
  // idea of a "numeric" sort better than a strict Number() parse.
  return parseFloat(field);
}

/**
 * Numeric comparison where non-numeric values (NaN) sort to the end in
 * ascending order. (In descending order they flip to the front — an accepted
 * v1 simplification.)
 */
function compareNumeric(a: number, b: number): number {
  const aNaN = Number.isNaN(a);
  const bNaN = Number.isNaN(b);
  if (aNaN && bNaN) return 0;
  if (aNaN) return 1;
  if (bNaN) return -1;
  return a - b;
}

/** Plain Unicode code-unit comparison (what a C-locale `sort` does). */
function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
