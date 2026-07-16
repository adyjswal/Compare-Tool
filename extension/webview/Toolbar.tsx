import type { KeyboardEvent } from "react";

/**
 * The find + sort toolbar shown above the diff.
 *
 * "Find" highlights the query on both sides and steps through matching rows
 * (Enter / Shift+Enter, or the ◂ ▸ buttons) in top-to-bottom document order —
 * a row counts once even if the text is on both sides. "Only matches"
 * additionally hides the non-matching rows. Sort is heavier (it re-orders and
 * re-compares the whole file) so it's handled by the host; this component just
 * reports the chosen option upward.
 */

/** The sort choices offered in the dropdown. */
export type SortChoice = "original" | "alpha-asc" | "alpha-desc" | "num-asc" | "num-desc";

/** How rows are matched: by the whole line, or by a delimited key column. */
export type CompareBy = "line" | "column";

interface ToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  caseSensitiveSearch: boolean;
  onCaseSensitiveSearchChange: (value: boolean) => void;
  onlyMatches: boolean;
  onOnlyMatchesChange: (value: boolean) => void;
  /** Step to the next (+1) or previous (-1) match (Enter / Shift+Enter). */
  onFindNav: (direction: 1 | -1) => void;
  compareBy: CompareBy;
  onCompareByChange: (value: CompareBy) => void;
  delimiter: string;
  onDelimiterChange: (value: string) => void;
  keyColumn: number;
  onKeyColumnChange: (value: number) => void;
  sort: SortChoice;
  onSortChange: (sort: SortChoice) => void;
  ignoreCaseSort: boolean;
  onIgnoreCaseSortChange: (value: boolean) => void;
}

/** Sort is by whole line; `ignoreCase` only affects the alphabetical options. */
const alphaSort = (sort: SortChoice) => sort === "alpha-asc" || sort === "alpha-desc";

export function Toolbar({
  query,
  onQueryChange,
  caseSensitiveSearch,
  onCaseSensitiveSearchChange,
  onlyMatches,
  onOnlyMatchesChange,
  onFindNav,
  compareBy,
  onCompareByChange,
  delimiter,
  onDelimiterChange,
  keyColumn,
  onKeyColumnChange,
  sort,
  onSortChange,
  ignoreCaseSort,
  onIgnoreCaseSortChange,
}: ToolbarProps) {
  const finding = query !== "";
  const byColumn = compareBy === "column";

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onFindNav(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group search-group">
        <div className="search-box">
          <input
            type="search"
            className="search-input"
            placeholder="Find in both files…"
            title="Enter = next match, Shift+Enter = previous"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Find text on either side"
          />
          <button
            type="button"
            className={`in-search-toggle${caseSensitiveSearch ? " active" : ""}`}
            aria-pressed={caseSensitiveSearch}
            title="Match case"
            onClick={() => onCaseSensitiveSearchChange(!caseSensitiveSearch)}
          >
            Aa
          </button>
        </div>

        {finding && (
          <label className="check" title="Hide the rows that don't match your search">
            <input
              type="checkbox"
              checked={onlyMatches}
              onChange={(event) => onOnlyMatchesChange(event.target.checked)}
            />
            Only matches
          </label>
        )}
      </div>

      <div className="toolbar-group compare-group">
        <label className="sort-label" htmlFor="compare-by">
          Compare
        </label>
        <select
          id="compare-by"
          className="sort-select"
          value={compareBy}
          onChange={(event) => onCompareByChange(event.target.value as CompareBy)}
          title="Match rows by the whole line, or by a key column (e.g. a SQL/CSV id)"
        >
          <option value="line">Whole line</option>
          <option value="column">By key column</option>
        </select>
        {byColumn && (
          <>
            <select
              className="sort-select"
              value={delimiter}
              onChange={(event) => onDelimiterChange(event.target.value)}
              aria-label="Column delimiter"
              title="Column delimiter"
            >
              <option value=",">Comma</option>
              <option value={"\t"}>Tab</option>
              <option value="|">Pipe</option>
              <option value=";">Semicolon</option>
            </select>
            <label className="key-col" title="1-based key column">
              Key col
              <input
                type="number"
                min={1}
                className="key-input"
                value={keyColumn}
                onChange={(event) =>
                  onKeyColumnChange(Math.max(1, Math.floor(Number(event.target.value) || 1)))
                }
              />
            </label>
          </>
        )}
      </div>

      <div className="toolbar-group sort-group">
        <label className="sort-label" htmlFor="sort-select">
          Sort
        </label>
        <select
          id="sort-select"
          className="sort-select"
          value={sort}
          disabled={byColumn}
          title={byColumn ? "Sorting doesn't apply when comparing by key column" : undefined}
          onChange={(event) => onSortChange(event.target.value as SortChoice)}
        >
          <option value="original">Original order</option>
          <option value="alpha-asc">Alphabetical (A→Z)</option>
          <option value="alpha-desc">Alphabetical (Z→A)</option>
          <option value="num-asc">Numeric (0→9)</option>
          <option value="num-desc">Numeric (9→0)</option>
        </select>
        {alphaSort(sort) && !byColumn && (
          <label className="check" title="Sort case-insensitively (A = a)">
            <input
              type="checkbox"
              checked={ignoreCaseSort}
              onChange={(event) => onIgnoreCaseSortChange(event.target.checked)}
            />
            Ignore case
          </label>
        )}
      </div>
    </div>
  );
}
