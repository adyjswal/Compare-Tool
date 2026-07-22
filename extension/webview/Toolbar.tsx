import type { KeyboardEvent, RefObject } from "react";
import type { ViewMode } from "./rowModel";

/**
 * The find + sort toolbar shown above the diff.
 *
 * "Find" highlights the query on both sides and steps through matching rows
 * (Enter / Shift+Enter, or the nav bar) in top-to-bottom document order — a row
 * counts once even if the text is on both sides. Sort is heavier (it re-orders
 * and re-compares on the host); this component just reports the choice.
 */

/** The sort choices offered in the dropdown. */
export type SortChoice = "original" | "alpha-asc" | "alpha-desc" | "num-asc" | "num-desc";

interface ToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  caseSensitiveSearch: boolean;
  onCaseSensitiveSearchChange: (value: boolean) => void;
  isRegex: boolean;
  onIsRegexChange: (v: boolean) => void;
  /** Shows a red border on the find input when the regex is invalid. */
  isRegexError: boolean;
  /** Step to the next (+1) or previous (-1) match (Enter / Shift+Enter). */
  onFindNav: (direction: 1 | -1) => void;
  /** Ref forwarded from App so Ctrl+F can focus this input. */
  findInputRef?: RefObject<HTMLInputElement>;
  pairChanged: boolean;
  onPairChangedChange: (value: boolean) => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (value: boolean) => void;
  sort: SortChoice;
  onSortChange: (sort: SortChoice) => void;
  /** Which unchanged-row view is active (all / collapsed / only changes). */
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** Key-column compare: match rows by one delimited column instead of the whole line. */
  keyEnabled: boolean;
  onKeyEnabledChange: (value: boolean) => void;
  keyDelimiter: string;
  onKeyDelimiterChange: (value: string) => void;
  keyColumn: number;
  onKeyColumnChange: (value: number) => void;
  /** Expand all folds (collapsed mode only). */
  onExpandAll?: () => void;
  /** Collapse all folds (collapsed mode only). */
  onCollapseAll?: () => void;
  /** Number of folds present in the current model; used to disable the buttons. */
  foldsCount?: number;
  /** When true (default), long lines wrap inside each pane; when false, panes scroll horizontally. */
  wordWrap: boolean;
  onWordWrapChange: (value: boolean) => void;
}

export function Toolbar({
  query,
  onQueryChange,
  caseSensitiveSearch,
  onCaseSensitiveSearchChange,
  isRegex,
  onIsRegexChange,
  isRegexError,
  onFindNav,
  findInputRef,
  pairChanged,
  onPairChangedChange,
  ignoreWhitespace,
  onIgnoreWhitespaceChange,
  sort,
  onSortChange,
  viewMode,
  onViewModeChange,
  keyEnabled,
  onKeyEnabledChange,
  keyDelimiter,
  onKeyDelimiterChange,
  keyColumn,
  onKeyColumnChange,
  onExpandAll,
  onCollapseAll,
  foldsCount = 0,
  wordWrap,
  onWordWrapChange,
}: ToolbarProps) {
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
            ref={findInputRef}
            type="search"
            className={`search-input${isRegexError ? " search-input--error" : ""}`}
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
          <button
            type="button"
            className={`in-search-toggle${isRegex ? " active" : ""}`}
            aria-pressed={isRegex}
            title="Use regular expression"
            onClick={() => onIsRegexChange(!isRegex)}
          >
            .*
          </button>
        </div>
      </div>

      <div className="toolbar-group view-group">
        <span className="sort-label">Unchanged</span>
        <div className="view-toggle" role="group" aria-label="Unchanged rows view">
          <button
            type="button"
            className={viewMode === "all" ? "active" : ""}
            aria-pressed={viewMode === "all"}
            title="Show every row"
            onClick={() => onViewModeChange("all")}
          >
            All
          </button>
          <button
            type="button"
            className={viewMode === "collapsed" ? "active" : ""}
            aria-pressed={viewMode === "collapsed"}
            title="Collapse long unchanged runs into expandable folds"
            onClick={() => onViewModeChange("collapsed")}
          >
            Collapsed
          </button>
          <button
            type="button"
            className={viewMode === "changes" ? "active" : ""}
            aria-pressed={viewMode === "changes"}
            title="Hide unchanged rows entirely — show only differences"
            onClick={() => onViewModeChange("changes")}
          >
            Only changes
          </button>
        </div>
        {viewMode === "collapsed" && (
          <>
            <button
              type="button"
              disabled={foldsCount === 0}
              title="Expand all folded unchanged runs"
              onClick={onExpandAll}
            >
              Expand All
            </button>
            <button
              type="button"
              disabled={foldsCount === 0}
              title="Collapse all expanded unchanged runs"
              onClick={onCollapseAll}
            >
              Collapse All
            </button>
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
          disabled={keyEnabled}
          title={keyEnabled ? "Disabled while comparing by key column" : undefined}
          onChange={(event) => onSortChange(event.target.value as SortChoice)}
        >
          <option value="original">Original order</option>
          <option value="alpha-asc">Alphabetical (A→Z)</option>
          <option value="alpha-desc">Alphabetical (Z→A)</option>
          <option value="num-asc">Numeric (0→9)</option>
          <option value="num-desc">Numeric (9→0)</option>
        </select>
      </div>

      <div className="toolbar-group key-group">
        <label
          className="check"
          title="Match rows by one delimited column (a record's key) instead of the whole line. Same key + different content = a 'changed' row — handy for reconciling reordered CSV/SQL exports."
        >
          <input
            type="checkbox"
            checked={keyEnabled}
            onChange={(event) => onKeyEnabledChange(event.target.checked)}
          />
          Compare by key column
        </label>
        {keyEnabled && (
          <span className="key-col">
            <label htmlFor="key-delim">delim</label>
            <select
              id="key-delim"
              className="sort-select"
              value={keyDelimiter}
              onChange={(event) => onKeyDelimiterChange(event.target.value)}
            >
              <option value=",">Comma ,</option>
              <option value={"\t"}>Tab ⇥</option>
              <option value="|">Pipe |</option>
              <option value=";">Semicolon ;</option>
            </select>
            <label htmlFor="key-col">col</label>
            <input
              id="key-col"
              className="key-input"
              type="number"
              min={1}
              value={keyColumn}
              title="1-based column number to match on"
              onChange={(event) => onKeyColumnChange(Number(event.target.value))}
            />
          </span>
        )}
      </div>

      {sort === "original" && !keyEnabled && (
        <div className="toolbar-group">
          <label
            className="check"
            title="On: an edited line is shown as one 'changed' row with the exact change highlighted. Off: it's shown as a separate removed line + added line, like git."
          >
            <input
              type="checkbox"
              checked={pairChanged}
              onChange={(event) => onPairChangedChange(event.target.checked)}
            />
            Show edits as changed
          </label>
        </div>
      )}

      <div className="toolbar-group">
        <label
          className="check"
          title="On: ignore leading/trailing whitespace — lines that differ only in spacing count as unchanged. Off: compare whitespace exactly, like git."
        >
          <input
            type="checkbox"
            checked={ignoreWhitespace}
            onChange={(event) => onIgnoreWhitespaceChange(event.target.checked)}
          />
          Ignore whitespace
        </label>
      </div>

      <div className="toolbar-group">
        <div className="view-toggle" role="group" aria-label="Word wrap">
          <button
            type="button"
            className={wordWrap ? "active" : ""}
            aria-pressed={wordWrap}
            title="Toggle word wrap — when off, long lines scroll horizontally"
            onClick={() => onWordWrapChange(!wordWrap)}
          >
            ↵ Wrap
          </button>
        </div>
      </div>
    </div>
  );
}
