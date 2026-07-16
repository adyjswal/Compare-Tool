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

interface ToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  caseSensitiveSearch: boolean;
  onCaseSensitiveSearchChange: (value: boolean) => void;
  onlyMatches: boolean;
  onOnlyMatchesChange: (value: boolean) => void;
  /** Step to the next (+1) or previous (-1) match. */
  onFindNav: (direction: 1 | -1) => void;
  /** Total matching rows, and the 0-based position of the current one (-1 = none yet). */
  matchCount: number;
  matchPos: number;
  totalCount: number;
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
  matchCount,
  matchPos,
  totalCount,
  sort,
  onSortChange,
  ignoreCaseSort,
  onIgnoreCaseSortChange,
}: ToolbarProps) {
  const finding = query !== "";
  const hasMatches = matchCount > 0;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onFindNav(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group search-group">
        <input
          type="search"
          className="search-input"
          placeholder="Find in both files…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Find text on either side"
        />
        <label className="check" title="Match case">
          <input
            type="checkbox"
            checked={caseSensitiveSearch}
            onChange={(event) => onCaseSensitiveSearchChange(event.target.checked)}
          />
          Aa
        </label>

        <div className="find-nav" role="group" aria-label="Find navigation">
          <button
            type="button"
            className="find-step"
            disabled={!hasMatches}
            title="Previous match (Shift+Enter)"
            onClick={() => onFindNav(-1)}
          >
            ◂
          </button>
          <button
            type="button"
            className="find-step"
            disabled={!hasMatches}
            title="Next match (Enter)"
            onClick={() => onFindNav(1)}
          >
            ▸
          </button>
        </div>

        <span className="match-count">
          {!finding
            ? `${totalCount.toLocaleString()} rows`
            : !hasMatches
              ? "No results"
              : matchPos >= 0
                ? `${matchPos + 1} of ${matchCount.toLocaleString()}`
                : `${matchCount.toLocaleString()} matches`}
        </span>

        <label className={`check${finding ? "" : " disabled"}`} title="Hide non-matching rows">
          <input
            type="checkbox"
            checked={onlyMatches}
            disabled={!finding}
            onChange={(event) => onOnlyMatchesChange(event.target.checked)}
          />
          Only matches
        </label>
      </div>

      <div className="toolbar-group sort-group">
        <label className="sort-label" htmlFor="sort-select">
          Sort
        </label>
        <select
          id="sort-select"
          className="sort-select"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as SortChoice)}
        >
          <option value="original">Original order</option>
          <option value="alpha-asc">Alphabetical (A→Z)</option>
          <option value="alpha-desc">Alphabetical (Z→A)</option>
          <option value="num-asc">Numeric (0→9)</option>
          <option value="num-desc">Numeric (9→0)</option>
        </select>
        <label
          className={`check${alphaSort(sort) ? "" : " disabled"}`}
          title="Case-insensitive alphabetical sort"
        >
          <input
            type="checkbox"
            checked={ignoreCaseSort}
            disabled={!alphaSort(sort)}
            onChange={(event) => onIgnoreCaseSortChange(event.target.checked)}
          />
          Ignore case
        </label>
      </div>
    </div>
  );
}
