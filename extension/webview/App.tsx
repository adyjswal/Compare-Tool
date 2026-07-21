import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FileInfo,
  FindResultMessage,
  ReadyResultMessage,
  StatusMessage,
  WindowMessage,
} from "../src/protocol";
import type { CompareOptions } from "../src/worker/messages";
import type { DiffStatus, DiffSummary, SortOptions } from "@large-file-compare/engine";
import { getVsCodeApi } from "./vscodeApi";
import { Header } from "./Header";
import { Toolbar } from "./Toolbar";
import type { SortChoice } from "./Toolbar";
import { NavBar } from "./NavBar";
import { DiffList } from "./DiffList";
import type { DiffListHandle, WindowRow } from "./DiffList";
import { buildRowModel, CONTEXT_ROWS } from "./rowModel";
import type { ViewMode } from "./rowModel";

/** Metadata for the comparison on screen (the row text is fetched on demand). */
interface Meta {
  comparisonId: number;
  left: FileInfo;
  right: FileInfo;
  summary: DiffSummary;
  leftMaxLen: number;
  rightMaxLen: number;
}

/** What the navigation bar is stepping through. */
type NavTarget = { kind: "find" } | { kind: "status"; status: DiffStatus };

const STATUS: DiffStatus[] = ["unchanged", "added", "removed", "changed"];
const EMPTY = new Int32Array(0);
const EMPTY_STATUSES = new Uint8Array(0);

/** Advance a cursor within a list of indices, wrapping at both ends. */
function nextPos(pos: number, length: number, direction: 1 | -1): number {
  if (pos < 0) {
    return direction === 1 ? 0 : length - 1;
  }
  return (pos + direction + length) % length;
}

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [statuses, setStatuses] = useState<Uint8Array | null>(null);
  const [phase, setPhase] = useState<StatusMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped whenever a text window arrives, to re-render the rows that just
  // loaded (getRow depends on it so the memoized panes refresh).
  const [loadTick, setLoadTick] = useState(0);

  // Find + sort (host round-trips) state.
  const [query, setQuery] = useState("");
  const [caseSensitiveSearch, setCaseSensitiveSearch] = useState(false);
  const [sort, setSort] = useState<SortChoice>("original");
  const [pairChanged, setPairChanged] = useState(true);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);

  // Unchanged-rows view (feature 1 & 2): "all" shows every row, "changes" hides
  // unchanged rows, "collapsed" folds long unchanged runs. `expanded` holds the
  // run-start indices the user has clicked open in collapsed mode.
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const comparisonId = useRef<number | undefined>(undefined);
  // On-demand text cache (one slot per row; undefined until fetched).
  const leftText = useRef<(string | undefined)[]>([]);
  const rightText = useRef<(string | undefined)[]>([]);
  const requested = useRef<Set<number>>(new Set());

  const [matchIndices, setMatchIndices] = useState<Int32Array | null>(null);
  const findToken = useRef(0);

  const [nav, setNav] = useState<NavTarget | null>(null);
  const [navPos, setNavPos] = useState(-1);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const diffRef = useRef<DiffListHandle>(null);
  // An absolute row waiting to be scrolled to once the display model rebuilds
  // (used when jumping into a fold we just expanded — its display index only
  // exists after the rebuild).
  const pendingScroll = useRef<number | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string } | undefined;
      if (message?.type === "status") {
        setError(null);
        setPhase(message as StatusMessage);
        return;
      }
      if (message?.type === "error") {
        setPhase(null);
        setError((message as { message: string }).message);
        return;
      }
      if (message?.type === "ready-result") {
        const m = message as ReadyResultMessage;
        setError(null);
        setPhase(null);
        if (m.comparisonId !== comparisonId.current) {
          comparisonId.current = m.comparisonId;
          setQuery("");
          setCaseSensitiveSearch(false);
          setSort("original");
          setPairChanged(true);
          setIgnoreWhitespace(true);
          setViewMode("all");
        }
        // Rows changed (fresh compare or recompute): drop cached text + nav, and
        // any fold expansions (row indices are no longer meaningful).
        leftText.current = new Array(m.statuses.length);
        rightText.current = new Array(m.statuses.length);
        requested.current = new Set();
        setExpanded(new Set());
        setMatchIndices(null);
        setNav(null);
        setNavPos(-1);
        setCurrentIndex(null);
        setStatuses(m.statuses);
        setMeta({
          comparisonId: m.comparisonId,
          left: m.left,
          right: m.right,
          summary: m.summary,
          leftMaxLen: m.leftMaxLen,
          rightMaxLen: m.rightMaxLen,
        });
        setLoadTick((t) => t + 1);
        return;
      }
      if (message?.type === "window") {
        const m = message as WindowMessage;
        if (m.comparisonId !== comparisonId.current) {
          return;
        }
        for (let i = 0; i < m.indices.length; i++) {
          const idx = m.indices[i];
          leftText.current[idx] = m.lefts[i];
          rightText.current[idx] = m.rights[i];
        }
        setLoadTick((t) => t + 1);
        return;
      }
      if (message?.type === "find-result") {
        const m = message as FindResultMessage;
        if (m.comparisonId !== comparisonId.current || m.token !== findToken.current) {
          return;
        }
        setMatchIndices(m.indices);
        return;
      }
    };
    window.addEventListener("message", onMessage);
    getVsCodeApi().postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Find runs on the host (it holds all the text). Debounced; re-run when the
  // query, case option, or the underlying rows (recompute) change.
  useEffect(() => {
    if (!statuses || query === "") {
      setMatchIndices(null);
      return;
    }
    const token = ++findToken.current;
    const timer = setTimeout(() => {
      getVsCodeApi().postMessage({ type: "find", token, query, caseSensitive: caseSensitiveSearch });
    }, 150);
    return () => clearTimeout(timer);
  }, [query, caseSensitiveSearch, statuses]);

  // Per-row line numbers, derived once from the status column (prefix sums).
  const { leftNo, rightNo } = useMemo(() => {
    const n = statuses?.length ?? 0;
    const l = new Int32Array(n);
    const r = new Int32Array(n);
    let lc = 0;
    let rc = 0;
    for (let i = 0; i < n; i++) {
      const s = statuses![i]; // 0 unchanged, 1 added, 2 removed, 3 changed
      l[i] = s === 0 || s === 2 || s === 3 ? ++lc : 0;
      r[i] = s === 0 || s === 1 || s === 3 ? ++rc : 0;
    }
    return { leftNo: l, rightNo: r };
  }, [statuses]);

  // Row indices grouped by status, for chip navigation.
  const occurrences = useMemo(() => {
    const map: Record<DiffStatus, number[]> = { unchanged: [], added: [], removed: [], changed: [] };
    if (statuses) {
      for (let i = 0; i < statuses.length; i++) {
        map[STATUS[statuses[i]]].push(i);
      }
    }
    return map;
  }, [statuses]);

  const navCounts = useMemo<Record<DiffStatus, number>>(
    () => ({
      unchanged: occurrences.unchanged.length,
      added: occurrences.added.length,
      removed: occurrences.removed.length,
      changed: occurrences.changed.length,
    }),
    [occurrences],
  );

  // The display model maps the virtual list's display indices to absolute rows
  // (or fold markers) per the current view mode. "all" is a zero-alloc identity.
  const model = useMemo(
    () => buildRowModel(statuses ?? EMPTY_STATUSES, viewMode, CONTEXT_ROWS, expanded),
    [statuses, viewMode, expanded],
  );

  // A row for the list, addressed by *display* index. A fold slot returns a
  // marker (`fold` set); otherwise it's a real row: status + line numbers from
  // local metadata, text from the on-demand cache (loaded=false until it lands).
  const getRow = useCallback(
    (displayIndex: number): WindowRow => {
      const v = model.map ? model.map[displayIndex] : displayIndex;
      if (model.map && v < 0) {
        const fold = model.folds[-1 - v];
        return { status: "unchanged", left: "", right: "", leftNo: null, rightNo: null, loaded: true, abs: -1, fold };
      }
      const abs = v;
      const s = statuses ? statuses[abs] : 0;
      const lt = leftText.current[abs];
      return {
        status: STATUS[s],
        left: lt ?? "",
        right: rightText.current[abs] ?? "",
        leftNo: leftNo[abs] || null,
        rightNo: rightNo[abs] || null,
        loaded: lt !== undefined,
        abs,
      };
      // loadTick in deps: identity changes when the cache fills, so the
      // memoized panes re-render the rows that just loaded.
    },
    [statuses, leftNo, rightNo, loadTick, model],
  );

  // Ask the host for the text of any visible rows we don't have yet. `start` /
  // `stop` are display indices; fold slots carry no text and are skipped.
  const onVisibleRange = useCallback(
    (start: number, stop: number) => {
      const need: number[] = [];
      for (let d = Math.max(0, start); d <= stop && d < model.count; d++) {
        const v = model.map ? model.map[d] : d;
        if (model.map && v < 0) {
          continue; // fold marker
        }
        const abs = v;
        if (leftText.current[abs] === undefined && !requested.current.has(abs)) {
          requested.current.add(abs);
          need.push(abs);
        }
      }
      if (need.length > 0) {
        getVsCodeApi().postMessage({ type: "getWindow", indices: need });
      }
    },
    [model],
  );

  // Display index for an absolute row under the current model (identity in "all").
  const displayOf = useCallback(
    (abs: number) => (model.absToDisplay ? model.absToDisplay[abs] : abs),
    [model],
  );

  const jumpTo = (abs: number) => {
    setCurrentIndex(abs);
    // If the target is hidden inside a fold, expand its run first; the scroll
    // then happens once the model has rebuilt (see the pendingScroll effect).
    if (model.map && model.absToDisplay) {
      const v = model.map[model.absToDisplay[abs]];
      if (v < 0) {
        const fold = model.folds[-1 - v];
        if (abs >= fold.start && abs < fold.end) {
          pendingScroll.current = abs;
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(fold.runStart);
            return next;
          });
          return;
        }
      }
    }
    diffRef.current?.scrollToRow(displayOf(abs));
  };

  // After the model rebuilds (e.g. a fold we expanded), scroll to the row that
  // was waiting — its display index only exists now.
  useEffect(() => {
    if (pendingScroll.current !== null) {
      const abs = pendingScroll.current;
      pendingScroll.current = null;
      diffRef.current?.scrollToRow(model.absToDisplay ? model.absToDisplay[abs] : abs);
    }
  }, [model]);

  // Switching view mode discards fold expansions (they belong to the old view).
  const changeViewMode = (next: ViewMode) => {
    setViewMode(next);
    setExpanded(new Set());
  };

  const expandFold = (runStart: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(runStart);
      return next;
    });
  };

  const matches: Int32Array | number[] = matchIndices ?? EMPTY;
  const navIndices: Int32Array | number[] = nav
    ? nav.kind === "find"
      ? matches
      : occurrences[nav.status]
    : EMPTY;

  // The navigable set changed (recompute / new find): forget position + marker.
  useEffect(() => {
    setNavPos(-1);
    setCurrentIndex(null);
  }, [occurrences, matchIndices]);

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

  const findStep = (direction: 1 | -1) => {
    const len = matches.length;
    if (len === 0) {
      return;
    }
    const base = nav && nav.kind === "find" ? navPos : -1;
    const pos = nextPos(base, len, direction);
    setNav({ kind: "find" });
    setNavPos(pos);
    jumpTo(matches[pos]);
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

  const dismissNav = () => {
    setNav(null);
    setNavPos(-1);
    setCurrentIndex(null);
  };

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

  // ---- Ask the host to re-compare with new sort / key options ----
  const requestCompare = (next: {
    sort: SortChoice;
    pair: boolean;
    ws: boolean;
  }) => {
    const options: CompareOptions = {
      sort: toSortOptions(next.sort),
      key: null,
      pairChanged: next.pair,
      ignoreWhitespace: next.ws,
    };
    getVsCodeApi().postMessage({ type: "compare", options });
  };

  const current = {
    sort,
    pair: pairChanged,
    ws: ignoreWhitespace,
  };

  const onSortChange = (nextSort: SortChoice) => {
    setSort(nextSort);
    requestCompare({ ...current, sort: nextSort });
  };
  const onPairChangedChange = (value: boolean) => {
    setPairChanged(value);
    requestCompare({ ...current, pair: value });
  };
  const onIgnoreWhitespaceChange = (value: boolean) => {
    setIgnoreWhitespace(value);
    requestCompare({ ...current, ws: value });
  };

  if (error) {
    return <div className="placeholder error-view">{error}</div>;
  }
  if (!meta || !statuses) {
    return <LoadingView phase={phase} />;
  }

  const banner = statusBanner(meta);
  const navLabel = nav ? (nav.kind === "find" ? "matches" : nav.status) : "";
  const navTone = nav ? (nav.kind === "find" ? "find" : nav.status) : "find";

  return (
    <div className="app">
      <Header
        data={meta}
        onNavigate={handleChip}
        navCounts={navCounts}
        onReload={() => getVsCodeApi().postMessage({ type: "reload" })}
        onSwap={() => getVsCodeApi().postMessage({ type: "swap" })}
        onOpenSide={(side) => getVsCodeApi().postMessage({ type: "openSide", side })}
        onExport={() => getVsCodeApi().postMessage({ type: "export" })}
      />
      <Toolbar
        query={query}
        onQueryChange={setQuery}
        caseSensitiveSearch={caseSensitiveSearch}
        onCaseSensitiveSearchChange={setCaseSensitiveSearch}
        onFindNav={findStep}
        pairChanged={pairChanged}
        onPairChangedChange={onPairChangedChange}
        ignoreWhitespace={ignoreWhitespace}
        onIgnoreWhitespaceChange={onIgnoreWhitespaceChange}
        sort={sort}
        onSortChange={onSortChange}
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
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
        total={model.count}
        statuses={model.displayStatuses ?? statuses}
        getRow={getRow}
        onVisibleRange={onVisibleRange}
        onExpandFold={expandFold}
        onSelectRow={setCurrentIndex}
        leftMaxLen={meta.leftMaxLen}
        rightMaxLen={meta.rightMaxLen}
        leftName={meta.left.name}
        rightName={meta.right.name}
        currentIndex={currentIndex === null ? null : displayOf(currentIndex)}
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

/** A friendly banner for the notable "nothing to look at" cases, or null. */
function statusBanner(meta: Meta): { tone: "info" | "ok"; text: string } | null {
  if (meta.left.empty && meta.right.empty) {
    return { tone: "info", text: "Both files are empty — nothing to compare." };
  }
  const { summary } = meta;
  const differences = summary.added + summary.removed + summary.changed;
  if (summary.total > 0 && differences === 0) {
    return {
      tone: "ok",
      text: `The files are identical — ${summary.total.toLocaleString()} lines, no differences.`,
    };
  }
  return null;
}

/** Map a toolbar choice to engine sort options (null = original order). */
function toSortOptions(sort: SortChoice): SortOptions | null {
  switch (sort) {
    case "original":
      return null;
    case "alpha-asc":
      return { mode: "alphabetical", direction: "asc", caseInsensitive: true, trim: true };
    case "alpha-desc":
      return { mode: "alphabetical", direction: "desc", caseInsensitive: true, trim: true };
    case "num-asc":
      return { mode: "numeric", direction: "asc", caseInsensitive: false, trim: true };
    case "num-desc":
      return { mode: "numeric", direction: "desc", caseInsensitive: false, trim: true };
  }
}
