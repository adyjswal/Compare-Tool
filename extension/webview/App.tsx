import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffResultMessage } from "../src/protocol";
import type { DiffRow, DiffStatus, SortOptions } from "@large-file-compare/engine";
import { getVsCodeApi } from "./vscodeApi";
import { Header } from "./Header";
import { Toolbar } from "./Toolbar";
import type { SortChoice } from "./Toolbar";
import { DiffList } from "./DiffList";
import type { DiffListHandle, LineNo, ViewMode } from "./DiffList";

/** A fresh set of per-status navigation cursors ("before the first"). */
function emptyCursors(): Record<DiffStatus, number> {
  return { unchanged: -1, added: -1, removed: -1, changed: -1 };
}

/** Advance a cursor within a list of indices, wrapping at both ends. */
function nextPos(pos: number, length: number, direction: 1 | -1): number {
  if (pos < 0) {
    return direction === 1 ? 0 : length - 1;
  }
  return (pos + direction + length) % length;
}

export function App() {
  const [data, setData] = useState<DiffResultMessage | null>(null);
  const [mode, setMode] = useState<ViewMode>("sideBySide");

  // Find (client-side) and sort (host round-trip) state.
  const [query, setQuery] = useState("");
  const [caseSensitiveSearch, setCaseSensitiveSearch] = useState(false);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [sort, setSort] = useState<SortChoice>("original");
  const [ignoreCaseSort, setIgnoreCaseSort] = useState(false);

  // Track which comparison is on screen so a *new* one (panel reused for a
  // different file pair) resets the toolbar; re-sorts keep the same id.
  const comparisonId = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string } | undefined;
      if (message?.type === "diffResult") {
        const result = message as DiffResultMessage;
        if (result.comparisonId !== comparisonId.current) {
          comparisonId.current = result.comparisonId;
          setQuery("");
          setCaseSensitiveSearch(false);
          setOnlyMatches(false);
          setSort("original");
          setIgnoreCaseSort(false);
        }
        setData(result);
      }
    };
    window.addEventListener("message", onMessage);

    // Tell the host we've mounted; it will (re)send the pending result.
    getVsCodeApi().postMessage({ type: "ready" });

    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Line numbers are derived from the full result (before filtering) so a
  // filtered view still shows each line's real position. A row with a left
  // side advances the left counter; a row with a right side advances the right.
  const lineNos = useMemo<LineNo[]>(() => {
    const rows = data?.rows ?? [];
    let left = 0;
    let right = 0;
    return rows.map((row) => ({
      left: row.left !== undefined ? ++left : null,
      right: row.right !== undefined ? ++right : null,
    }));
  }, [data]);

  // "Only matches" narrows the view to matching rows; each surviving row keeps
  // its original line numbers.
  const visible = useMemo(() => {
    const rows = data?.rows ?? [];
    if (!onlyMatches || query === "") {
      return { rows, lineNos };
    }
    const needle = caseSensitiveSearch ? query : query.toLowerCase();
    const outRows: DiffRow[] = [];
    const outNos: LineNo[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rowMatches(rows[i].left, rows[i].right, needle, caseSensitiveSearch)) {
        outRows.push(rows[i]);
        outNos.push(lineNos[i]);
      }
    }
    return { rows: outRows, lineNos: outNos };
  }, [data, lineNos, query, caseSensitiveSearch, onlyMatches]);

  // ---- Navigation shared by Find and the chips ----
  const diffRef = useRef<DiffListHandle>(null);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);

  const jumpTo = (rowIndex: number) => {
    setCurrentIndex(rowIndex);
    diffRef.current?.scrollToRow(rowIndex);
  };

  // Find: indices (into the visible rows) whose left or right text matches.
  const matchIndices = useMemo(() => {
    const rows = visible.rows;
    if (query === "") {
      return [];
    }
    const needle = caseSensitiveSearch ? query : query.toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rowMatches(rows[i].left, rows[i].right, needle, caseSensitiveSearch)) {
        out.push(i);
      }
    }
    return out;
  }, [visible.rows, query, caseSensitiveSearch]);

  const [matchPos, setMatchPos] = useState(-1);
  // New search (or the row set changed): forget where we were.
  useEffect(() => setMatchPos(-1), [matchIndices]);

  const handleFindNav = (direction: 1 | -1) => {
    if (matchIndices.length === 0) {
      return;
    }
    const pos = nextPos(matchPos, matchIndices.length, direction);
    setMatchPos(pos);
    jumpTo(matchIndices[pos]);
  };

  // Chips: step through the visible rows of a given status.
  const occurrences = useMemo(() => {
    const map: Record<DiffStatus, number[]> = {
      unchanged: [],
      added: [],
      removed: [],
      changed: [],
    };
    visible.rows.forEach((row, index) => map[row.status].push(index));
    return map;
  }, [visible.rows]);

  const chipCursors = useRef<Record<DiffStatus, number>>(emptyCursors());
  // The navigable set changed: reset cursors and drop the current-row marker.
  useEffect(() => {
    chipCursors.current = emptyCursors();
    setCurrentIndex(null);
  }, [occurrences]);

  const navCounts = useMemo<Record<DiffStatus, number>>(
    () => ({
      unchanged: occurrences.unchanged.length,
      added: occurrences.added.length,
      removed: occurrences.removed.length,
      changed: occurrences.changed.length,
    }),
    [occurrences],
  );

  const handleChipNav = (status: DiffStatus, direction: 1 | -1) => {
    const indices = occurrences[status];
    if (indices.length === 0) {
      return;
    }
    const pos = nextPos(chipCursors.current[status], indices.length, direction);
    chipCursors.current[status] = pos;
    jumpTo(indices[pos]);
  };

  // Ask the host to re-sort whenever the sort choice (or its case option) changes.
  useEffect(() => {
    getVsCodeApi().postMessage({ type: "sort", options: toSortOptions(sort, ignoreCaseSort) });
  }, [sort, ignoreCaseSort]);

  if (!data) {
    return <div className="placeholder">Comparing…</div>;
  }

  return (
    <div className="app">
      <Header
        data={data}
        mode={mode}
        onModeChange={setMode}
        onNavigate={handleChipNav}
        navCounts={navCounts}
      />
      <Toolbar
        query={query}
        onQueryChange={setQuery}
        caseSensitiveSearch={caseSensitiveSearch}
        onCaseSensitiveSearchChange={setCaseSensitiveSearch}
        onlyMatches={onlyMatches}
        onOnlyMatchesChange={setOnlyMatches}
        onFindNav={handleFindNav}
        matchCount={matchIndices.length}
        matchPos={matchPos}
        totalCount={data.rows.length}
        sort={sort}
        onSortChange={setSort}
        ignoreCaseSort={ignoreCaseSort}
        onIgnoreCaseSortChange={setIgnoreCaseSort}
      />
      <DiffList
        ref={diffRef}
        rows={visible.rows}
        lineNos={visible.lineNos}
        mode={mode}
        leftName={data.left.name}
        rightName={data.right.name}
        currentIndex={currentIndex}
        query={query}
        caseSensitive={caseSensitiveSearch}
      />
    </div>
  );
}

/** Does either side of a row contain the needle? Mirrors the engine's filter. */
function rowMatches(
  left: string | undefined,
  right: string | undefined,
  needle: string,
  caseSensitive: boolean,
): boolean {
  const l = left ?? "";
  const r = right ?? "";
  if (caseSensitive) {
    return l.includes(needle) || r.includes(needle);
  }
  return l.toLowerCase().includes(needle) || r.toLowerCase().includes(needle);
}

/** Map a toolbar choice to engine sort options (null = original order). */
function toSortOptions(sort: SortChoice, ignoreCase: boolean): SortOptions | null {
  switch (sort) {
    case "original":
      return null;
    case "alpha-asc":
      return { mode: "alphabetical", direction: "asc", caseInsensitive: ignoreCase, trim: true };
    case "alpha-desc":
      return { mode: "alphabetical", direction: "desc", caseInsensitive: ignoreCase, trim: true };
    case "num-asc":
      return { mode: "numeric", direction: "asc", caseInsensitive: false, trim: true };
    case "num-desc":
      return { mode: "numeric", direction: "desc", caseInsensitive: false, trim: true };
  }
}
