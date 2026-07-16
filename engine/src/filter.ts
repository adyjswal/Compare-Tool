/**
 * Filtering diff rows by a keyword.
 *
 * This backs the search box in the UI: given the full diff, return only the
 * rows whose left or right text contains the query. Case-insensitive by default
 * (what people expect from a search box). An empty query returns everything.
 */
import { DiffRow } from "./types";

export interface FilterOptions {
  /** Match ignoring case. Default: true. */
  caseInsensitive?: boolean;
}

/** Return the subset of `rows` matching `query` on either side. */
export function filterRows(
  rows: readonly DiffRow[],
  query: string,
  options: FilterOptions = {},
): DiffRow[] {
  const caseInsensitive = options.caseInsensitive ?? true;
  const needle = caseInsensitive ? query.toLowerCase() : query;

  if (needle === "") {
    return [...rows];
  }

  return rows.filter((row) => {
    const left = row.left ?? "";
    const right = row.right ?? "";
    if (caseInsensitive) {
      return left.toLowerCase().includes(needle) || right.toLowerCase().includes(needle);
    }
    return left.includes(needle) || right.includes(needle);
  });
}
