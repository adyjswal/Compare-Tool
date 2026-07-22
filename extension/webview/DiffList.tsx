import {
  forwardRef,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  ReactNode,
  RefObject,
} from "react";
import type { DiffStatus } from "@large-file-compare/engine";
import {
  clampFirstRow,
  computeGeometry,
  firstRowToScrollTop,
  scrollTopToFirstRow,
} from "./scrollMapping";
import type { Fold } from "./rowModel";
import { copyToClipboard } from "./clipboard";

/** Imperative API: scroll a given row into view (used by chip navigation). */
export interface DiffListHandle {
  scrollToRow(index: number): void;
}

/**
 * One row supplied by the host-backed windowing layer. `status` and the line
 * numbers come from local metadata (always available); `left`/`right` text is
 * fetched on demand — `loaded` is false until this row's window has arrived.
 */
export interface WindowRow {
  status: DiffStatus;
  left: string;
  right: string;
  leftNo: number | null;
  rightNo: number | null;
  loaded: boolean;
  /** Absolute row index (into the status column); -1 for a fold marker. */
  abs: number;
  /** When set, this display slot is a collapsed-run marker, not a real row. */
  fold?: Fold;
}

/** Fixed row height (px) — must match `.row` line-height in styles.css. */
const ROW_HEIGHT = 20;

/** Extra rows rendered above/below the viewport, to cushion fast scrolling. */
const OVERSCAN = 20;

/* ------------------------------------------------------------------ *
 * Browser max element height probe (for scaled scrolling)
 * ------------------------------------------------------------------ */

/** Conservative fallback if the DOM probe can't run (works at any DPR). */
const FALLBACK_MAX_HEIGHT = 8_000_000;

let cachedMaxHeight: number | null = null;

/**
 * Binary-search the tallest element height the browser will actually render.
 * The result is in CSS px, so it already accounts for Windows display scaling
 * / devicePixelRatio. Runs once; the value is cached at module scope.
 */
function measureMaxElementHeight(): number {
  try {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;top:-4px;left:-4px;width:1px;visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
    let lo = 1_000_000;
    let hi = 100_000_000;
    for (let i = 0; i < 40 && hi - lo > 8192; i++) {
      const mid = Math.floor((lo + hi) / 2);
      probe.style.height = `${mid}px`;
      // offsetHeight reflects the clamped, laid-out box height.
      if (probe.offsetHeight >= mid - 2) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    document.body.removeChild(probe);
    return lo > 0 ? lo : FALLBACK_MAX_HEIGHT;
  } catch {
    return FALLBACK_MAX_HEIGHT;
  }
}

/** Safe cap = 90% of the measured limit, leaving headroom for rounding. */
function computeSafeCap(): number {
  if (cachedMaxHeight === null) {
    const measured = measureMaxElementHeight();
    cachedMaxHeight = Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_MAX_HEIGHT;
  }
  return Math.floor(cachedMaxHeight * 0.9);
}

/** React hook: measure the cap after mount; falls back until then. */
function useSafeCap(): number {
  const [cap, setCap] = useState(() =>
    Math.floor((cachedMaxHeight ?? FALLBACK_MAX_HEIGHT) * 0.9),
  );
  useLayoutEffect(() => {
    const c = computeSafeCap();
    setCap((prev) => (prev !== c ? c : prev));
  }, []);
  return cap;
}

/* ------------------------------------------------------------------ *
 * Scaled virtualizer: one scroll container, capped height, mapped rows
 * ------------------------------------------------------------------ */

interface ScaledHandle {
  scrollToRow(index: number): void;
}

interface ScaledVirtualizerProps {
  total: number;
  viewportHeight: number;
  safeCap: number;
  minWidth: string;
  className: string;
  /** Render one row with the given absolute-position style (includes minWidth). */
  renderRow: (index: number, style: CSSProperties) => ReactNode;
  /** DOM ref to the scroll container (used for two-pane scroll sync). */
  outerRef?: MutableRefObject<HTMLDivElement | null>;
  /** Notifies the parent of the current first-visible row (for the ruler). */
  onFirstRowChange?: (firstRow: number) => void;
  /** Reports the visible+overscan range so its text can be fetched on demand. */
  onVisibleRange?: (start: number, stop: number) => void;
}

/**
 * Virtualizes a list whose true height can exceed the browser's element-height
 * limit. The outer element is capped at `safeCap`; a proportional mapping turns
 * its scrollTop into the first visible row, and only that window of rows is in
 * the DOM (positioned inside a sticky layer pinned to the viewport top).
 */
const ScaledVirtualizer = memo(
  forwardRef<ScaledHandle, ScaledVirtualizerProps>(function ScaledVirtualizer(
    { total, viewportHeight, safeCap, minWidth, className, renderRow, outerRef, onFirstRowChange, onVisibleRange },
    ref,
  ) {
    const outer = useRef<HTMLDivElement | null>(null);
    const [firstRow, setFirstRowState] = useState(0);
    // Authoritative, synchronously-updated current first row. Handlers read this
    // *between* renders (a trackpad fires a burst of events far faster than React
    // re-renders), so it must not lag behind — `firstRow` state only drives what
    // gets painted.
    const firstRowRef = useRef(0);
    // Carried-over fractional rows from sub-row pixel / trackpad wheel deltas.
    const wheelAccum = useRef(0);

    const geom = useMemo(
      () => computeGeometry(total, ROW_HEIGHT, viewportHeight, safeCap),
      [total, viewportHeight, safeCap],
    );
    const geomRef = useRef(geom);
    geomRef.current = geom;

    const setOuter = useCallback(
      (el: HTMLDivElement | null) => {
        outer.current = el;
        if (outerRef) {
          outerRef.current = el;
        }
      },
      [outerRef],
    );

    const commitFirstRow = useCallback(
      (r: number) => {
        const clamped = clampFirstRow(r, geomRef.current);
        firstRowRef.current = clamped; // synchronous — never lags a render
        setFirstRowState((prev) => (prev === clamped ? prev : clamped));
        onFirstRowChange?.(clamped);
      },
      [onFirstRowChange],
    );

    // Native scroll (scrollbar-thumb drag, or the wheel when unscaled): map the
    // element's scrollTop to a row.
    const onScroll = useCallback(() => {
      const el = outer.current;
      if (el) {
        commitFirstRow(scrollTopToFirstRow(el.scrollTop, geomRef.current));
      }
    }, [commitFirstRow]);

    // Move to an exact row: update the row synchronously, then drive scrollTop
    // (the resulting scroll event keeps the two-pane mirror in sync).
    const goToRow = useCallback(
      (r: number) => {
        const clamped = clampFirstRow(r, geomRef.current);
        commitFirstRow(clamped);
        const el = outer.current;
        if (el) {
          const top = firstRowToScrollTop(clamped, geomRef.current);
          if (Math.round(el.scrollTop) !== top) {
            el.scrollTop = top;
          }
        }
      },
      [commitFirstRow],
    );

    // Wheel handling. Unscaled (small files): let the browser scroll natively —
    // smooth and pixel-exact. Scaled: native scrolling would move `scale`× too
    // fast (the element is compressed), so intercept and step by the *exact*
    // number of rows the delta represents, accumulating sub-row pixel/trackpad
    // deltas so a gentle scroll stays gentle (no forced minimum, no burst-stall
    // — `firstRowRef` is synchronous).
    useEffect(() => {
      const el = outer.current;
      if (!el) {
        return;
      }
      const handler = (e: WheelEvent) => {
        if (e.deltaY === 0) {
          return; // horizontal scroll: leave it to the browser
        }
        const g = geomRef.current;
        if (g.scale === 1) {
          return; // native scroll is exact and smooth at 1:1
        }
        e.preventDefault();
        let rows: number;
        if (e.deltaMode === 1) {
          rows = e.deltaY; // lines → rows
        } else if (e.deltaMode === 2) {
          rows = e.deltaY * Math.max(1, g.visibleRows - 1); // pages
        } else {
          rows = e.deltaY / g.rowHeight; // pixels → rows (fractional)
        }
        // Drop the leftover fraction on a direction change so it feels crisp.
        if (rows > 0 !== wheelAccum.current > 0) {
          wheelAccum.current = 0;
        }
        wheelAccum.current += rows;
        const whole = Math.trunc(wheelAccum.current);
        if (whole !== 0) {
          wheelAccum.current -= whole;
          goToRow(firstRowRef.current + whole);
        }
      };
      el.addEventListener("wheel", handler, { passive: false });
      return () => el.removeEventListener("wheel", handler);
    }, [goToRow]);

    const onKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLDivElement>) => {
        const g = geomRef.current;
        const page = Math.max(1, g.visibleRows - 1);
        let next: number;
        switch (e.key) {
          case "ArrowDown":
            next = firstRowRef.current + 1;
            break;
          case "ArrowUp":
            next = firstRowRef.current - 1;
            break;
          case "PageDown":
            next = firstRowRef.current + page;
            break;
          case "PageUp":
            next = firstRowRef.current - page;
            break;
          case "Home":
            next = 0;
            break;
          case "End":
            next = g.maxFirstRow;
            break;
          default:
            return;
        }
        e.preventDefault();
        goToRow(next);
      },
      [goToRow],
    );

    // Geometry change (resize / new file): keep firstRow valid and re-sync the
    // element's scrollTop to match.
    useLayoutEffect(() => {
      const clamped = clampFirstRow(firstRowRef.current, geom);
      if (clamped !== firstRowRef.current) {
        firstRowRef.current = clamped;
        setFirstRowState(clamped);
        onFirstRowChange?.(clamped);
      }
      const el = outer.current;
      if (el) {
        const top = firstRowToScrollTop(clamped, geom);
        if (Math.round(el.scrollTop) !== top) {
          el.scrollTop = top;
        }
      }
    }, [geom, onFirstRowChange]);

    // Report the visible window so the host can be asked for its text.
    useEffect(() => {
      if (!onVisibleRange || total === 0) {
        return;
      }
      const start = Math.max(0, firstRow - OVERSCAN);
      const stop = Math.min(total - 1, firstRow + geom.visibleRows + OVERSCAN);
      onVisibleRange(start, stop);
    }, [firstRow, geom.visibleRows, total, onVisibleRange]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToRow(index: number) {
          const g = geomRef.current;
          goToRow(index - Math.floor(g.visibleRows / 2));
        },
      }),
      [goToRow],
    );

    const start = Math.max(0, firstRow - OVERSCAN);
    const stop = total === 0 ? -1 : Math.min(total - 1, firstRow + geom.visibleRows + OVERSCAN);
    const rows: ReactNode[] = [];
    for (let i = start; i <= stop; i++) {
      rows.push(
        renderRow(i, {
          position: "absolute",
          top: (i - firstRow) * ROW_HEIGHT,
          left: 0,
          width: "100%",
          height: ROW_HEIGHT,
          minWidth,
        }),
      );
    }

    return (
      <div
        ref={setOuter}
        className={className}
        style={{ height: viewportHeight, overflow: "auto", width: "100%" }}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        <div className="scroll-spacer" style={{ height: geom.scaledHeight, minWidth }}>
          <div className="sticky-window" style={{ height: viewportHeight, minWidth }}>
            {rows}
          </div>
        </div>
      </div>
    );
  }),
);

interface DiffListProps {
  total: number;
  /** Per-row status code (0 unchanged, 1 added, 2 removed, 3 changed). */
  statuses: Uint8Array;
  /** Row accessor: status + line numbers always; text once its window loads. */
  getRow: (index: number) => WindowRow;
  /** Called with the visible (+overscan) range so its text can be fetched. */
  onVisibleRange: (start: number, stop: number) => void;
  /** Expand a collapsed run (by its run-start index) when its fold is clicked. */
  onExpandFold: (runStart: number) => void;
  /** Select a row (by absolute index) — clicking marks "you are here". */
  onSelectRow: (abs: number) => void;
  leftMaxLen: number;
  rightMaxLen: number;
  leftName: string;
  rightName: string;
  /** Display index of the selected/parked row, or null. */
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
  /** When false, panes do not wrap and scroll horizontally instead. Default true. */
  wordWrap: boolean;
}

/**
 * Virtualized, windowed side-by-side diff view. Only visible rows are in the
 * DOM, and only their *text* is fetched from the host on demand — so the tool
 * scales to millions of rows without shipping all the text to the webview.
 * Scaled scrolling (see scrollMapping.ts) keeps every row reachable even past
 * the browser's element-height limit. Two scroll-synced panes; long lines
 * scroll horizontally with pinned line-number gutters.
 */
export const DiffList = forwardRef<DiffListHandle, DiffListProps>(function DiffList(
  { total, statuses, getRow, onVisibleRange, onExpandFold, onSelectRow, leftMaxLen, rightMaxLen, leftName, rightName, currentIndex, query, caseSensitive, wordWrap },
  ref,
) {
  const height = useAvailableHeight();
  const safeCap = useSafeCap();
  const leftPaneRef = useRef<ScaledHandle>(null);
  // First visible row of the driving pane — feeds the overview ruler.
  const [firstRow, setFirstRow] = useState(0);
  // Right-click "copy" menu: which display row, and where to place the menu.
  const [menu, setMenu] = useState<{ x: number; y: number; row: WindowRow } | null>(null);

  const scrollToRow = useCallback((index: number) => {
    leftPaneRef.current?.scrollToRow(index);
  }, []);

  useImperativeHandle(ref, () => ({ scrollToRow }), [scrollToRow]);

  const openMenu = useCallback((x: number, y: number, row: WindowRow) => {
    setMenu({ x, y, row });
  }, []);

  // Ctrl/Cmd+C copies the selected row (both sides) — unless the user has an
  // actual text selection, in which case the browser's native copy wins.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === "c" && (e.ctrlKey || e.metaKey))) {
        return;
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString() !== "") {
        return; // let native selection copy happen
      }
      if (currentIndex === null) {
        return;
      }
      const row = getRow(currentIndex);
      if (row.fold) {
        return;
      }
      e.preventDefault();
      void copyToClipboard(`${row.left}\t${row.right}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentIndex, getRow]);

  // Synthetic scrollTop so the ruler's existing firstRow = scrollTop/rowHeight
  // math keeps working unchanged.
  const syntheticScrollTop = firstRow * ROW_HEIGHT;

  return (
    <div className="diff-area">
      <div className="sxs-headers">
        <span className="pane-title" title={leftName}>
          {leftName}
        </span>
        <span className="pane-title" title={rightName}>
          {rightName}
        </span>
      </div>

      <div className="diff-body" ref={height.ref}>
        <div className="diff-content">
          {total === 0 ? (
            <div className="empty-rows">No rows to display.</div>
          ) : height.value > 0 ? (
            <SideBySide
              total={total}
              getRow={getRow}
              viewportHeight={height.value}
              safeCap={safeCap}
              leftMinWidth={contentWidth(leftMaxLen, 6)}
              rightMinWidth={contentWidth(rightMaxLen, 6)}
              currentIndex={currentIndex}
              query={query}
              caseSensitive={caseSensitive}
              wordWrap={wordWrap}
              leftPaneRef={leftPaneRef}
              onFirstRowChange={setFirstRow}
              onVisibleRange={onVisibleRange}
              onExpandFold={onExpandFold}
              onSelectRow={onSelectRow}
              onContextMenu={openMenu}
            />
          ) : null}
          {menu && <CopyMenu x={menu.x} y={menu.y} row={menu.row} onClose={() => setMenu(null)} />}
        </div>
        {total > 0 && height.value > 0 && (
          <OverviewRuler
            statuses={statuses}
            height={height.value}
            currentIndex={currentIndex}
            scrollTop={syntheticScrollTop}
            rowHeight={ROW_HEIGHT}
            onJump={scrollToRow}
          />
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * Side-by-side: two synced panes
 * ------------------------------------------------------------------ */

const SideBySide = memo(function SideBySide({
  total,
  getRow,
  viewportHeight,
  safeCap,
  leftMinWidth,
  rightMinWidth,
  currentIndex,
  query,
  caseSensitive,
  wordWrap,
  leftPaneRef,
  onFirstRowChange,
  onVisibleRange,
  onExpandFold,
  onSelectRow,
  onContextMenu,
}: {
  total: number;
  getRow: (index: number) => WindowRow;
  viewportHeight: number;
  safeCap: number;
  leftMinWidth: string;
  rightMinWidth: string;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
  wordWrap: boolean;
  leftPaneRef: RefObject<ScaledHandle>;
  onFirstRowChange: (firstRow: number) => void;
  onVisibleRange: (start: number, stop: number) => void;
  onExpandFold: (runStart: number) => void;
  onSelectRow: (abs: number) => void;
  onContextMenu: (x: number, y: number, row: WindowRow) => void;
}) {
  const leftOuter = useRef<HTMLDivElement | null>(null);
  const rightOuter = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const a = leftOuter.current;
    const b = rightOuter.current;
    if (!a || !b) {
      return;
    }
    let locked = false;
    const mirror = (src: HTMLDivElement, dst: HTMLDivElement) => () => {
      if (locked) {
        return;
      }
      locked = true;
      if (dst.scrollTop !== src.scrollTop) {
        dst.scrollTop = src.scrollTop;
      }
      if (dst.scrollLeft !== src.scrollLeft) {
        dst.scrollLeft = src.scrollLeft;
      }
      requestAnimationFrame(() => {
        locked = false;
      });
    };
    const onLeft = mirror(a, b);
    const onRight = mirror(b, a);
    a.addEventListener("scroll", onLeft, { passive: true });
    b.addEventListener("scroll", onRight, { passive: true });
    return () => {
      a.removeEventListener("scroll", onLeft);
      b.removeEventListener("scroll", onRight);
    };
  }, [viewportHeight]);

  return (
    <div className="sxs-panes">
      <Pane
        side="left"
        total={total}
        getRow={getRow}
        viewportHeight={viewportHeight}
        safeCap={safeCap}
        minWidth={leftMinWidth}
        currentIndex={currentIndex}
        query={query}
        caseSensitive={caseSensitive}
        wordWrap={wordWrap}
        outerRef={leftOuter}
        handleRef={leftPaneRef}
        onFirstRowChange={onFirstRowChange}
        onVisibleRange={onVisibleRange}
        onExpandFold={onExpandFold}
        onSelectRow={onSelectRow}
        onContextMenu={onContextMenu}
      />
      <Pane
        side="right"
        total={total}
        getRow={getRow}
        viewportHeight={viewportHeight}
        safeCap={safeCap}
        minWidth={rightMinWidth}
        currentIndex={currentIndex}
        query={query}
        caseSensitive={caseSensitive}
        wordWrap={wordWrap}
        outerRef={rightOuter}
        onExpandFold={onExpandFold}
        onSelectRow={onSelectRow}
        onContextMenu={onContextMenu}
      />
    </div>
  );
});

function Pane({
  side,
  total,
  getRow,
  viewportHeight,
  safeCap,
  minWidth,
  currentIndex,
  query,
  caseSensitive,
  wordWrap,
  outerRef,
  handleRef,
  onFirstRowChange,
  onVisibleRange,
  onExpandFold,
  onSelectRow,
  onContextMenu,
}: {
  side: "left" | "right";
  total: number;
  getRow: (index: number) => WindowRow;
  viewportHeight: number;
  safeCap: number;
  minWidth: string;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
  wordWrap: boolean;
  outerRef: MutableRefObject<HTMLDivElement | null>;
  handleRef?: RefObject<ScaledHandle>;
  onFirstRowChange?: (firstRow: number) => void;
  onVisibleRange?: (start: number, stop: number) => void;
  onExpandFold: (runStart: number) => void;
  onSelectRow: (abs: number) => void;
  onContextMenu: (x: number, y: number, row: WindowRow) => void;
}) {
  const renderRow = useCallback(
    (index: number, style: CSSProperties): ReactNode => {
      const row = getRow(index);
      if (row.fold) {
        // A collapsed run: one full-width, clickable marker (both panes show it).
        return (
          <button
            key={index}
            type="button"
            className="row fold-row"
            style={style}
            title="Click to expand these unchanged lines"
            onClick={() => onExpandFold(row.fold!.runStart)}
          >
            <span className="fold-label">
              ⋯ {row.fold.count.toLocaleString()} unchanged {row.fold.count === 1 ? "line" : "lines"}
            </span>
          </button>
        );
      }
      const text = side === "left" ? row.left : row.right;
      const no = side === "left" ? row.leftNo : row.rightNo;
      const current = index === currentIndex ? " row-current" : "";
      return (
        <div
          key={index}
          className={`row side row-${row.status}${current}`}
          style={style}
          onClick={() => onSelectRow(row.abs)}
          onContextMenu={(e) => {
            e.preventDefault();
            onSelectRow(row.abs);
            onContextMenu(e.clientX, e.clientY, row);
          }}
        >
          <span className="lineno">{no ?? ""}</span>
          <span className="cell" title={row.loaded ? text : undefined}>
            {row.loaded ? renderSide(row, side, query, caseSensitive) : <span className="cell-loading">⋯</span>}
          </span>
        </div>
      );
    },
    [getRow, side, currentIndex, query, caseSensitive, onExpandFold, onSelectRow, onContextMenu],
  );

  return (
    <ScaledVirtualizer
      ref={handleRef}
      className={`pane pane-${side}${wordWrap ? "" : " no-wrap"}`}
      total={total}
      viewportHeight={viewportHeight}
      safeCap={safeCap}
      minWidth={minWidth}
      renderRow={renderRow}
      outerRef={outerRef}
      onFirstRowChange={onFirstRowChange}
      onVisibleRange={onVisibleRange}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Overview ruler (change map)
 * ------------------------------------------------------------------ */

const RULER_WIDTH = 14;
const RULER_HALF = 7;
const RED = "rgba(248,81,73,0.85)"; // removed / changed (old side)
const GREEN = "rgba(46,160,67,0.85)"; // added / changed (new side)

/**
 * VS Code-style change map: left half red where a row is removed/changed, right
 * half green where added/changed, a viewport box, click-to-jump. Reads the
 * status column directly (no text needed), so it works with windowed data.
 */
function OverviewRuler({
  statuses,
  height,
  currentIndex,
  scrollTop,
  rowHeight,
  onJump,
}: {
  statuses: Uint8Array;
  height: number;
  currentIndex: number | null;
  scrollTop: number;
  rowHeight: number;
  onJump: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerColorRef = useRef("");
  const pixels = Math.max(1, Math.floor(height));
  const total = statuses.length;

  const channels = useMemo(() => {
    const left = new Uint8Array(pixels);
    const right = new Uint8Array(pixels);
    for (let i = 0; i < total; i++) {
      const s = statuses[i]; // 0 unchanged, 1 added, 2 removed, 3 changed
      if (s === 0) {
        continue;
      }
      const y = (((i + 0.5) / total) * pixels) | 0;
      if (s === 2 || s === 3) {
        left[y] = 1;
      }
      if (s === 1 || s === 3) {
        right[y] = 1;
      }
    }
    return { left, right };
  }, [statuses, pixels, total]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const backingW = RULER_WIDTH * dpr;
    const backingH = pixels * dpr;
    if (canvas.width !== backingW) {
      canvas.width = backingW;
    }
    if (canvas.height !== backingH) {
      canvas.height = backingH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, RULER_WIDTH, pixels);

    const { left, right } = channels;
    for (let y = 0; y < pixels; y++) {
      if (left[y]) {
        ctx.fillStyle = RED;
        ctx.fillRect(0, y, RULER_HALF, 2);
      }
      if (right[y]) {
        ctx.fillStyle = GREEN;
        ctx.fillRect(RULER_HALF, y, RULER_WIDTH - RULER_HALF, 2);
      }
    }

    if (total > 0 && rowHeight > 0) {
      const firstRow = scrollTop / rowHeight;
      const visibleRows = pixels / rowHeight;
      const rawY0 = Math.max(0, (firstRow / total) * pixels);
      const rawY1 = Math.min(pixels, ((firstRow + visibleRows) / total) * pixels);
      const boxH = Math.max(2, rawY1 - rawY0);
      const y0 = Math.max(0, Math.min(rawY0, pixels - boxH));
      ctx.fillStyle = "rgba(128,128,128,0.22)";
      ctx.fillRect(0, y0, RULER_WIDTH, boxH);
      ctx.strokeStyle = "rgba(160,160,160,0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, y0 + 0.5, RULER_WIDTH - 1, boxH - 1);
    }

    if (currentIndex !== null && currentIndex >= 0 && total > 0) {
      if (!markerColorRef.current) {
        markerColorRef.current =
          getComputedStyle(canvas).getPropertyValue("--vscode-focusBorder").trim() || "#4daafc";
      }
      const y = (((currentIndex + 0.5) / total) * pixels) | 0;
      ctx.fillStyle = markerColorRef.current;
      ctx.fillRect(0, Math.max(0, y - 1), RULER_WIDTH, 3);
    }
  }, [channels, currentIndex, pixels, total, scrollTop, rowHeight]);

  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientY - rect.top) / rect.height;
    const index = Math.min(total - 1, Math.max(0, Math.floor(fraction * total)));
    onJump(index);
  };

  return (
    <canvas
      className="overview-ruler"
      ref={canvasRef}
      style={{ width: RULER_WIDTH, height: pixels }}
      onClick={onClick}
      title="Click to jump to that position"
    />
  );
}

/* ------------------------------------------------------------------ *
 * Copy context menu
 * ------------------------------------------------------------------ */

/**
 * A small right-click menu offering to copy a row's left / right / both sides.
 * Closes on any outside click, Escape, or after an action. Positioned at the
 * cursor, nudged back on-screen if it would overflow the right/bottom edge.
 */
function CopyMenu({
  x,
  y,
  row,
  onClose,
}: {
  x: number;
  y: number;
  row: WindowRow;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - width - 4),
      y: Math.min(y, window.innerHeight - height - 4),
    });
  }, [x, y]);

  useEffect(() => {
    // Dismiss on a press outside the menu (but not inside — otherwise this
    // capture-phase handler would unmount the menu before an item's click).
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) {
        return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const act = (text: string) => {
    void copyToClipboard(text);
    onClose();
  };

  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      <button type="button" className="context-item" role="menuitem" onClick={() => act(row.left)}>
        Copy left line
      </button>
      <button type="button" className="context-item" role="menuitem" onClick={() => act(row.right)}>
        Copy right line
      </button>
      <button
        type="button"
        className="context-item"
        role="menuitem"
        onClick={() => act(`${row.left}\t${row.right}`)}
      >
        Copy row (both)
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Inline (word-level) diff + Find highlight (computed for visible rows only)
 * ------------------------------------------------------------------ */

const INLINE_MAX_CHARS = 20_000;

interface Inline {
  left: [number, number];
  right: [number, number];
}

/** Word-level diff: trim common leading/trailing tokens, mark the middle span. */
function computeInline(left: string, right: string): Inline | null {
  if (left.length + right.length > INLINE_MAX_CHARS) {
    return null;
  }
  const a = tokenize(left);
  const b = tokenize(right);
  let prefix = 0;
  const maxPrefix = Math.min(a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) {
    prefix++;
  }
  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (suffix < maxSuffix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix++;
  }
  return {
    left: changedRange(a, prefix, a.length - suffix),
    right: changedRange(b, prefix, b.length - suffix),
  };
}

function tokenize(text: string): string[] {
  return text.match(/\w+|\s+|[^\w\s]+/g) ?? [];
}

function changedRange(tokens: string[], midStart: number, midEnd: number): [number, number] {
  let start = 0;
  for (let i = 0; i < midStart; i++) {
    start += tokens[i].length;
  }
  let end = start;
  for (let i = midStart; i < midEnd; i++) {
    end += tokens[i].length;
  }
  return [start, end];
}

function renderSide(row: WindowRow, side: "left" | "right", query: string, caseSensitive: boolean): ReactNode {
  const text = side === "left" ? row.left : row.right;
  if (row.status === "changed") {
    const inline = computeInline(row.left, row.right);
    if (inline) {
      return renderChanged(text, side === "left" ? inline.left : inline.right, side === "left" ? "word-del" : "word-add", query, caseSensitive);
    }
  }
  return highlight(text, query, caseSensitive);
}

function renderChanged(
  text: string,
  [changeStart, changeEnd]: [number, number],
  cls: string,
  query: string,
  caseSensitive: boolean,
): ReactNode {
  const matches = query === "" ? [] : findRanges(text, query, caseSensitive);
  const cuts = new Set<number>([0, text.length]);
  if (changeEnd > changeStart) {
    cuts.add(changeStart);
    cuts.add(changeEnd);
  }
  for (const [s, e] of matches) {
    cuts.add(s);
    cuts.add(e);
  }
  const points = [...cuts].sort((x, y) => x - y);
  const nodes: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a >= b) {
      continue;
    }
    const changed = changeEnd > changeStart && a >= changeStart && b <= changeEnd;
    const isMatch = matches.some(([s, e]) => a >= s && b <= e);
    let inner: ReactNode = text.slice(a, b);
    if (isMatch) {
      inner = <mark className="find-hit">{inner}</mark>;
    }
    nodes.push(
      changed ? (
        <span className={cls} key={i}>
          {inner}
        </span>
      ) : (
        <Fragment key={i}>{inner}</Fragment>
      ),
    );
  }
  return nodes;
}

function findRanges(text: string, query: string, caseSensitive: boolean): Array<[number, number]> {
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      break;
    }
    ranges.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return ranges;
}

function highlight(text: string, query: string, caseSensitive: boolean): ReactNode {
  if (query === "" || text === "") {
    return text;
  }
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let key = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      parts.push(text.slice(from));
      break;
    }
    if (at > from) {
      parts.push(text.slice(from, at));
    }
    parts.push(
      <mark className="find-hit" key={key++}>
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  return parts;
}

/**
 * Turn a character count into a CSS width covering the gutter, cell padding and
 * a little slack. Monospace font makes `ch` an accurate per-character unit.
 */
function contentWidth(chars: number, gutterCh: number): string {
  if (chars === 0) {
    return "100%";
  }
  return `calc(${chars + gutterCh + 2}ch + 24px)`;
}

/** Track a container's height so the virtual list can fill the panel. */
function useAvailableHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = () => setValue(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, value };
}
