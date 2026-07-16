import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffResultMessage, FileInfo, StatusMessage } from "../src/protocol";
import type { CompareOptions } from "../src/worker/messages";
import type { DiffRow, DiffStatus, DiffSummary, SortOptions } from "@large-file-compare/engine";
import { getVsCodeApi } from "./vscodeApi";
import { Header } from "./Header";
import { Toolbar } from "./Toolbar";
import type { CompareBy, SortChoice } from "./Toolbar";
import { NavBar } from "./NavBar";
import { DiffList } from "./DiffList";
import type { DiffListHandle, LineNo, ViewMode } from "./DiffList";

/** A completed comparison, with row objects rebuilt from the columnar payload. */
interface Comparison {
  comparisonId: number;
  left: FileInfo;
  right: FileInfo;
  summary: DiffSummary;
  rows: DiffRow[];
}

/** What the navigation bar is stepping through. */
type NavTarget = { kind: "find" } | { kind: "status"; status: DiffStatus };

const STATUS: DiffStatus[] = ["unchanged", "added", "removed", "changed"];

/** Advance a cursor within a list of indices, wrapping at both ends. */
function nextPos(pos: number, length: number, direction: 1 | -1): number {
  if (pos < 0) {
    return direction === 1 ? 0 : length - 1;
  }
  return (pos + direction + length) % length;
}

export function App() {
  const [data, setData] = useState<Comparison | null>(null);
  const [phase, setPhase] = useState<StatusMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("sideBySide");

  // Find (client-side) and sort (host round-trip) state.
  const [query, setQuery] = useState("");
  const [caseSensitiveSearch, setCaseSensitiveSearch] = useState(false);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [sort, setSort] = useState<SortChoice>("original");
  const [ignoreCaseSort, setIgnoreCaseSort] = useState(false);

  // Key-column compare (whole-line by default).
  const [compareBy, setCompareBy] = useState<CompareBy>("line");
  const [delimiter, setDelimiter] = useState(",");
  const [keyColumn, setKeyColumn] = useState(1);

  const comparisonId = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string } | undefined;
      if (message?.type === "status") {
        setError(null);
        setPhase(message as StatusMessage);
      } else if (message?.type === "error") {
        setPhase(null);
        setError((message as { message: string }).message);
      } else if (message?.type === "diffResult") {
        const result = message as DiffResultMessage;
        setPhase(null);
        setError(null);
        if (result.comparisonId !== comparisonId.current) {
          comparisonId.current = result.comparisonId;
          setQuery("");
          setCaseSensitiveSearch(false);
          setOnlyMatches(false);
          setSort("original");
          setIgnoreCaseSort(false);
          setCompareBy("line");
          setDelimiter(",");
          setKeyColumn(1);
          setNav(null);
          setNavPos(-1);
        }
        setData({
          comparisonId: result.comparisonId,
          left: result.left,
          right: result.right,
          summary: result.summary,
          rows: rowsFromColumnar(result.statuses, result.lefts, result.rights),
        });
      }
    };
    window.addEventListener("message", onMessage);
    getVsCodeApi().postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const lineNos = useMemo<LineNo[]>(() => {
    const rows = data?.rows ?? [];
    let left = 0;
    let right = 0;
    return rows.map((row) => ({
      left: row.left !== undefined ? ++left : null,
      right: row.right !== undefined ? ++right : null,
    }));
  }, [data]);

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

  const navCounts = useMemo<Record<DiffStatus, number>>(
    () => ({
      unchanged: occurrences.unchanged.length,
      added: occurrences.added.length,
      removed: occurrences.removed.length,
      changed: occurrences.changed.length,
    }),
    [occurrences],
  );

  // ---- Unified navigation (chips + Find share one bar) ----
  const diffRef = useRef<DiffListHandle>(null);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [nav, setNav] = useState<NavTarget | null>(null);
  const [navPos, setNavPos] = useState(-1);

  const jumpTo = (rowIndex: number) => {
    setCurrentIndex(rowIndex);
    diffRef.current?.scrollToRow(rowIndex);
  };

  const navIndices = nav ? (nav.kind === "find" ? matchIndices : occurrences[nav.status]) : [];

  // The navigable set changed (filter / sort / new comparison): forget position
  // and drop the current-row marker.
  useEffect(() => {
    setNavPos(-1);
    setCurrentIndex(null);
  }, [occurrences, matchIndices]);

  // Typing in Find makes it the navigation target; clearing it releases the bar.
  useEffect(() => {
    if (query !== "") {
      setNav({ kind: "find" });
    } else {
      setNav((prev) => (prev && prev.kind === "find" ? null : prev));
    }
  }, [query]);

  const go = (dir: "first" | "prev" | "next" | "last") => {
    const len = navIndices.length;
    if (len === 0) {
      return;
    }
    const pos =
      dir === "first" ? 0 : dir === "last" ? len - 1 : nextPos(navPos, len, dir === "next" ? 1 : -1);
    setNavPos(pos);
    jumpTo(navIndices[pos]);
  };

  // Enter / Shift+Enter in the Find box always steps through matches.
  const findStep = (direction: 1 | -1) => {
    const len = matchIndices.length;
    if (len === 0) {
      return;
    }
    const base = nav && nav.kind === "find" ? navPos : -1;
    const pos = nextPos(base, len, direction);
    setNav({ kind: "find" });
    setNavPos(pos);
    jumpTo(matchIndices[pos]);
  };

  const handleChip = (status: DiffStatus) => {
    const indices = occurrences[status];
    if (indices.length === 0) {
      return;
    }
    setNav({ kind: "status", status });
    setNavPos(0);
    jumpTo(indices[0]);
  };

  // Dismiss the nav bar: back to normal, clearing the current-row marker.
  const dismissNav = () => {
    setNav(null);
    setNavPos(-1);
    setCurrentIndex(null);
  };

  // Escape closes the nav bar (like a find widget) while it's open.
  useEffect(() => {
    if (!nav) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissNav();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  // ---- Ask the host (worker) to re-compare with new sort / key options ----
  const requestCompare = (next: {
    sort: SortChoice;
    ignoreCase: boolean;
    by: CompareBy;
    delim: string;
    col: number;
  }) => {
    const options: CompareOptions =
      next.by === "column"
        ? { sort: null, key: { delimiter: next.delim, index: next.col } }
        : { sort: toSortOptions(next.sort, next.ignoreCase), key: null };
    getVsCodeApi().postMessage({ type: "compare", options });
  };

  const current = { sort, ignoreCase: ignoreCaseSort, by: compareBy, delim: delimiter, col: keyColumn };

  const onSortChange = (nextSort: SortChoice) => {
    setSort(nextSort);
    requestCompare({ ...current, sort: nextSort });
  };
  const onIgnoreCaseSortChange = (value: boolean) => {
    setIgnoreCaseSort(value);
    requestCompare({ ...current, ignoreCase: value });
  };
  const onCompareByChange = (value: CompareBy) => {
    setCompareBy(value);
    requestCompare({ ...current, by: value });
  };
  const onDelimiterChange = (value: string) => {
    setDelimiter(value);
    if (compareBy === "column") {
      requestCompare({ ...current, delim: value });
    }
  };
  const onKeyColumnChange = (value: number) => {
    setKeyColumn(value);
    if (compareBy === "column") {
      requestCompare({ ...current, col: value });
    }
  };

  if (error) {
    return <div className="placeholder error-view">{error}</div>;
  }
  if (!data) {
    return <LoadingView phase={phase} />;
  }

  const banner = statusBanner(data);
  const navLabel = nav ? (nav.kind === "find" ? "matches" : nav.status) : "";
  const navTone = nav ? (nav.kind === "find" ? "find" : nav.status) : "find";

  return (
    <div className="app">
      <Header
        data={data}
        mode={mode}
        onModeChange={setMode}
        onNavigate={handleChip}
        navCounts={navCounts}
        onReload={() => getVsCodeApi().postMessage({ type: "reload" })}
      />
      <Toolbar
        query={query}
        onQueryChange={setQuery}
        caseSensitiveSearch={caseSensitiveSearch}
        onCaseSensitiveSearchChange={setCaseSensitiveSearch}
        onlyMatches={onlyMatches}
        onOnlyMatchesChange={setOnlyMatches}
        onFindNav={findStep}
        compareBy={compareBy}
        onCompareByChange={onCompareByChange}
        delimiter={delimiter}
        onDelimiterChange={onDelimiterChange}
        keyColumn={keyColumn}
        onKeyColumnChange={onKeyColumnChange}
        sort={sort}
        onSortChange={onSortChange}
        ignoreCaseSort={ignoreCaseSort}
        onIgnoreCaseSortChange={onIgnoreCaseSortChange}
      />
      {nav && (
        <NavBar
          label={navLabel}
          tone={navTone}
          pos={navPos}
          total={navIndices.length}
          onGo={go}
          onClose={dismissNav}
        />
      )}
      {phase && <div className="banner banner-info">Re-comparing…</div>}
      {banner && <div className={`banner banner-${banner.tone}`}>{banner.text}</div>}
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

/** Loading / progress screen with a Cancel button. */
function LoadingView({ phase }: { phase: StatusMessage | null }) {
  const text =
    phase?.phase === "reading"
      ? phase.lines
        ? `Reading files… ${phase.lines.toLocaleString()} lines`
        : "Reading files…"
      : "Comparing…";
  return (
    <div className="loading-view">
      <div className="loading-text">{text}</div>
      <button
        type="button"
        className="cancel-button"
        onClick={() => getVsCodeApi().postMessage({ type: "cancel" })}
      >
        Cancel
      </button>
    </div>
  );
}

/** Rebuild row objects from the columnar payload (absence implied by status). */
function rowsFromColumnar(statuses: Uint8Array, lefts: string[], rights: string[]): DiffRow[] {
  const n = statuses.length;
  const rows = new Array<DiffRow>(n);
  for (let i = 0; i < n; i++) {
    const status = STATUS[statuses[i]];
    if (status === "added") {
      rows[i] = { status, right: rights[i] };
    } else if (status === "removed") {
      rows[i] = { status, left: lefts[i] };
    } else {
      rows[i] = { status, left: lefts[i], right: rights[i] };
    }
  }
  return rows;
}

/** A friendly banner for the notable "nothing to look at" cases, or null. */
function statusBanner(data: Comparison): { tone: "info" | "ok"; text: string } | null {
  if (data.left.empty && data.right.empty) {
    return { tone: "info", text: "Both files are empty — nothing to compare." };
  }
  const { summary } = data;
  const differences = summary.added + summary.removed + summary.changed;
  if (summary.total > 0 && differences === 0) {
    return {
      tone: "ok",
      text: `The files are identical — ${summary.total.toLocaleString()} lines, no differences.`,
    };
  }
  return null;
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
