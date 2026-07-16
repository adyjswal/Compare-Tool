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
import type { CSSProperties, ReactNode, RefObject } from "react";
import { FixedSizeList } from "react-window";
import type { ListChildComponentProps } from "react-window";
import type { DiffRow } from "@large-file-compare/engine";

/** Which layout the diff is shown in. */
export type ViewMode = "sideBySide" | "unified";

/** Imperative API: scroll a given row into view (used by chip navigation). */
export interface DiffListHandle {
  scrollToRow(index: number): void;
}

/** Fixed row height (px) — must match `.row` line-height in styles.css. */
const ROW_HEIGHT = 20;

const MARKERS: Record<DiffRow["status"], string> = {
  added: "+",
  removed: "-",
  changed: "~",
  unchanged: " ",
};

/** Per-row line numbers for each side (null where that side has no line). */
export interface LineNo {
  left: number | null;
  right: number | null;
}

interface DiffListProps {
  rows: DiffRow[];
  /** Parallel to `rows`; computed once over the full result so it survives filtering. */
  lineNos: LineNo[];
  mode: ViewMode;
  leftName: string;
  rightName: string;
  /** Row index (into `rows`) to mark as the current navigation target, if any. */
  currentIndex: number | null;
  /** Find query: matching substrings are highlighted in the row text. */
  query: string;
  caseSensitive: boolean;
}

/**
 * Virtualized diff view. `react-window` keeps only the visible rows (plus a
 * small overscan) in the DOM, so a 300k-row diff stays responsive in either
 * layout.
 *
 * Side-by-side renders the two files as *separate* scroll containers whose
 * vertical AND horizontal scroll positions are kept in lock-step (like VS
 * Code's diff): dragging either scrollbar — or scrolling to the right end of a
 * long line — moves both panes together. Long lines are reachable because each
 * row is widened to the longest line on its side (`min-width`), which turns on
 * the horizontal scrollbar; line numbers stay pinned with `position: sticky`.
 *
 * Exposes a `scrollToRow` handle so the header chips can jump to a row. We only
 * drive the left (or unified) list; the scroll-sync mirrors it to the other
 * pane, so both stay aligned.
 */
export const DiffList = forwardRef<DiffListHandle, DiffListProps>(function DiffList(
  { rows, lineNos, mode, leftName, rightName, currentIndex, query, caseSensitive },
  ref,
) {
  const height = useAvailableHeight();
  const leftListRef = useRef<FixedSizeList>(null);
  const unifiedListRef = useRef<FixedSizeList>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const scrollToRow = useCallback(
    (index: number) => {
      const list = mode === "unified" ? unifiedListRef.current : leftListRef.current;
      list?.scrollToItem(index, "center");
    },
    [mode],
  );

  // Track vertical scroll so the ruler can draw the current viewport box.
  const onListScroll = useCallback((e: { scrollOffset: number }) => {
    setScrollTop(e.scrollOffset);
  }, []);

  useImperativeHandle(ref, () => ({ scrollToRow }), [scrollToRow]);

  return (
    <div className="diff-area">
      {mode === "sideBySide" && (
        <div className="sxs-headers">
          <span className="pane-title" title={leftName}>
            {leftName}
          </span>
          <span className="pane-title" title={rightName}>
            {rightName}
          </span>
        </div>
      )}

      <div className="diff-body" ref={height.ref}>
        <div className="diff-content">
          {rows.length === 0 ? (
            <div className="empty-rows">
              {query === "" ? "No rows to display." : "No rows match your search."}
            </div>
          ) : height.value > 0 ? (
            mode === "sideBySide" ? (
              <SideBySide
                rows={rows}
                lineNos={lineNos}
                height={height.value}
                currentIndex={currentIndex}
                query={query}
                caseSensitive={caseSensitive}
                leftListRef={leftListRef}
                onScroll={onListScroll}
              />
            ) : (
              <Unified
                rows={rows}
                lineNos={lineNos}
                height={height.value}
                currentIndex={currentIndex}
                query={query}
                caseSensitive={caseSensitive}
                listRef={unifiedListRef}
                onScroll={onListScroll}
              />
            )
          ) : null}
        </div>
        {rows.length > 0 && height.value > 0 && (
          <OverviewRuler
            rows={rows}
            height={height.value}
            currentIndex={currentIndex}
            scrollTop={scrollTop}
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

interface PaneData {
  rows: DiffRow[];
  lineNos: LineNo[];
  side: "left" | "right";
  minWidth: string;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
}

const SideBySide = memo(function SideBySide({
  rows,
  lineNos,
  height,
  currentIndex,
  query,
  caseSensitive,
  leftListRef,
  onScroll,
}: {
  rows: DiffRow[];
  lineNos: LineNo[];
  height: number;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
  leftListRef: RefObject<FixedSizeList>;
  onScroll: (e: { scrollOffset: number }) => void;
}) {
  const leftOuter = useRef<HTMLDivElement | null>(null);
  const rightOuter = useRef<HTMLDivElement | null>(null);

  // Keep the two panes' scroll positions in lock-step. A guard flag stops the
  // programmatic scroll of one pane from bouncing back and re-scrolling the
  // other; it's released on the next frame.
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
    // Re-bind when the lists (re)mount as the measured height becomes available.
  }, [height]);

  const leftMinWidth = useMemo(() => rowMinWidth(rows, "left"), [rows]);
  const rightMinWidth = useMemo(() => rowMinWidth(rows, "right"), [rows]);

  return (
    <div className="sxs-panes">
      <Pane
        side="left"
        rows={rows}
        lineNos={lineNos}
        height={height}
        minWidth={leftMinWidth}
        currentIndex={currentIndex}
        query={query}
        caseSensitive={caseSensitive}
        outerRef={leftOuter}
        listRef={leftListRef}
        onScroll={onScroll}
      />
      <Pane
        side="right"
        rows={rows}
        lineNos={lineNos}
        height={height}
        minWidth={rightMinWidth}
        currentIndex={currentIndex}
        query={query}
        caseSensitive={caseSensitive}
        outerRef={rightOuter}
      />
    </div>
  );
});

function Pane({
  side,
  rows,
  lineNos,
  height,
  minWidth,
  currentIndex,
  query,
  caseSensitive,
  outerRef,
  listRef,
  onScroll,
}: {
  side: "left" | "right";
  rows: DiffRow[];
  lineNos: LineNo[];
  height: number;
  minWidth: string;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
  outerRef: RefObject<HTMLDivElement | null>;
  listRef?: RefObject<FixedSizeList>;
  onScroll?: (e: { scrollOffset: number }) => void;
}) {
  const itemData: PaneData = { rows, lineNos, side, minWidth, currentIndex, query, caseSensitive };
  return (
    <FixedSizeList
      ref={listRef}
      className={`pane pane-${side}`}
      height={height}
      width="100%"
      itemCount={rows.length}
      itemSize={ROW_HEIGHT}
      itemData={itemData}
      overscanCount={20}
      outerRef={outerRef}
      onScroll={onScroll}
    >
      {PaneRow}
    </FixedSizeList>
  );
}

/** One file's line: pinned line number + full-width (scrollable) content. */
function PaneRow({ index, style, data }: ListChildComponentProps<PaneData>) {
  const row = data.rows[index];
  const text = (data.side === "left" ? row.left : row.right) ?? "";
  const no = data.side === "left" ? data.lineNos[index].left : data.lineNos[index].right;
  const rowStyle: CSSProperties = { ...style, minWidth: data.minWidth };
  const current = index === data.currentIndex ? " row-current" : "";
  return (
    <div className={`row side row-${row.status}${current}`} style={rowStyle}>
      <span className="lineno">{no ?? ""}</span>
      <span className="cell" title={text}>
        {renderSide(row, data.side, data.query, data.caseSensitive)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Unified: single pane
 * ------------------------------------------------------------------ */

interface UnifiedData {
  rows: DiffRow[];
  lineNos: LineNo[];
  minWidth: string;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
}

const Unified = memo(function Unified({
  rows,
  lineNos,
  height,
  currentIndex,
  query,
  caseSensitive,
  listRef,
  onScroll,
}: {
  rows: DiffRow[];
  lineNos: LineNo[];
  height: number;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
  listRef: RefObject<FixedSizeList>;
  onScroll: (e: { scrollOffset: number }) => void;
}) {
  const minWidth = useMemo(() => {
    const longest = Math.max(rowMaxLen(rows, "left"), rowMaxLen(rows, "right"));
    // Two line-number gutters (old + new) sit before the text.
    return contentWidth(longest, /* gutterCh */ 12);
  }, [rows]);
  const itemData: UnifiedData = { rows, lineNos, minWidth, currentIndex, query, caseSensitive };
  return (
    <FixedSizeList
      ref={listRef}
      className="unified-list"
      height={height}
      width="100%"
      itemCount={rows.length}
      itemSize={ROW_HEIGHT}
      itemData={itemData}
      overscanCount={20}
      onScroll={onScroll}
    >
      {UnifiedRow}
    </FixedSizeList>
  );
});

/** Single column with old|new line-number gutters (GitHub-style unified diff). */
function UnifiedRow({ index, style, data }: ListChildComponentProps<UnifiedData>) {
  const row = data.rows[index];
  const nos = data.lineNos[index];
  const text = row.status === "added" || row.status === "changed" ? row.right : row.left;
  const title =
    row.status === "changed" ? `${row.right ?? ""}\n(was: ${row.left ?? ""})` : (text ?? "");
  const rowStyle: CSSProperties = { ...style, minWidth: data.minWidth };
  const current = index === data.currentIndex ? " row-current" : "";
  return (
    <div className={`row row-${row.status}${current}`} style={rowStyle} title={title}>
      <span className="lineno lineno-old">{nos.left ?? ""}</span>
      <span className="lineno lineno-new">{nos.right ?? ""}</span>
      <span className="marker">{MARKERS[row.status]}</span>
      <span className="text">{renderUnifiedText(row, text, data.query, data.caseSensitive)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Overview ruler (change map)
 * ------------------------------------------------------------------ */

const RULER_WIDTH = 14;
const RULER_HALF = 7;
const RED = "rgba(248,81,73,0.85)"; // removed / changed (old side)
const GREEN = "rgba(46,160,67,0.85)"; // added / changed (new side)

/**
 * A VS Code-style change map down the right edge. Two channels mirror the two
 * panes: the left half is red where a row is removed or changed (the "old"
 * side), the right half is green where it's added or changed (the "new" side).
 * A translucent box marks the current viewport, and clicking jumps there.
 *
 * Scales to 1M rows: the O(total) pass that buckets rows into per-pixel channel
 * bits runs only when rows/height change (memoized); scrolling or moving the
 * marker only repaints from the bits (O(pixels)).
 */
function OverviewRuler({
  rows,
  height,
  currentIndex,
  scrollTop,
  rowHeight,
  onJump,
}: {
  rows: DiffRow[];
  height: number;
  currentIndex: number | null;
  scrollTop: number;
  rowHeight: number;
  onJump: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerColorRef = useRef("");
  const pixels = Math.max(1, Math.floor(height));
  const total = rows.length;

  // Per-pixel presence bits for each channel across the entire file.
  const channels = useMemo(() => {
    const left = new Uint8Array(pixels);
    const right = new Uint8Array(pixels);
    if (total > 0) {
      for (let i = 0; i < total; i++) {
        const status = rows[i].status;
        if (status === "unchanged") {
          continue;
        }
        // Band centre, so the lit pixel resolves back to this row under the
        // click mapping floor(fraction * total) — no boundary off-by-one.
        const y = (((i + 0.5) / total) * pixels) | 0;
        if (status === "removed" || status === "changed") {
          left[y] = 1;
        }
        if (status === "added" || status === "changed") {
          right[y] = 1;
        }
      }
    }
    return { left, right };
  }, [rows, pixels, total]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    // Only resize when the backing store actually changes — assigning width/
    // height (even the same value) reallocates the bitmap.
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
    // Absolute transform (not cumulative scale) so skipping the resize is safe.
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

    // Viewport box: where the panes are currently scrolled to.
    if (total > 0 && rowHeight > 0) {
      const firstRow = scrollTop / rowHeight;
      const visibleRows = pixels / rowHeight;
      const rawY0 = Math.max(0, (firstRow / total) * pixels);
      const rawY1 = Math.min(pixels, ((firstRow + visibleRows) / total) * pixels);
      const boxH = Math.max(2, rawY1 - rawY0);
      // Keep the (min-height) box inside the canvas at the very bottom.
      const y0 = Math.max(0, Math.min(rawY0, pixels - boxH));
      ctx.fillStyle = "rgba(128,128,128,0.22)";
      ctx.fillRect(0, y0, RULER_WIDTH, boxH);
      ctx.strokeStyle = "rgba(160,160,160,0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, y0 + 0.5, RULER_WIDTH - 1, boxH - 1);
    }

    // Current navigation target, most prominent.
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
    // Inverse of the tick mapping y = floor(i/total * pixels).
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
 * Inline (word-level) diff for `changed` rows
 * ------------------------------------------------------------------ */

/** The changed character range [start, end) on each side of a `changed` row. */
interface Inline {
  left: [number, number];
  right: [number, number];
}

/** Skip inline diffing past this combined length — a whole-line highlight is
 *  used instead, so a pathological long line can never cost anything. */
const INLINE_MAX_CHARS = 20_000;

// Computed at most once per row (keyed by the row object) and shared by both
// panes; entries are freed automatically when a comparison's rows are replaced.
const inlineCache = new WeakMap<DiffRow, Inline | null>();

/** Inline diff for a `changed` row, or null if it's too long / not applicable. */
function getInline(row: DiffRow): Inline | null {
  if (inlineCache.has(row)) {
    return inlineCache.get(row) ?? null;
  }
  const result =
    row.left !== undefined && row.right !== undefined
      ? computeInline(row.left, row.right)
      : null;
  inlineCache.set(row, result);
  return result;
}

/**
 * Word-level diff by trimming the common leading and trailing tokens, leaving
 * the differing middle span. Returns the changed char range on each side.
 * O(token count) — no DP, so it can't blow up. It marks one contiguous changed
 * region per line, which is exactly right for the common "one value changed".
 */
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

/** Split into word / whitespace / punctuation runs; joining them is lossless. */
function tokenize(text: string): string[] {
  return text.match(/\w+|\s+|[^\w\s]+/g) ?? [];
}

/** Char offsets [start, end) of tokens [midStart, midEnd). */
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

/** Render one side's cell: inline word highlight for changed rows, else plain. */
function renderSide(
  row: DiffRow,
  side: "left" | "right",
  query: string,
  caseSensitive: boolean,
): ReactNode {
  const text = (side === "left" ? row.left : row.right) ?? "";
  if (row.status === "changed") {
    const inline = getInline(row);
    if (inline) {
      return renderChanged(text, side === "left" ? inline.left : inline.right, side === "left" ? "word-del" : "word-add", query, caseSensitive);
    }
  }
  return highlight(text, query, caseSensitive);
}

/** Render the unified single column: inline highlight on the "new" side. */
function renderUnifiedText(
  row: DiffRow,
  text: string | undefined,
  query: string,
  caseSensitive: boolean,
): ReactNode {
  if (row.status === "changed") {
    const inline = getInline(row);
    if (inline) {
      return renderChanged(row.right ?? "", inline.right, "word-add", query, caseSensitive);
    }
  }
  return highlight(text ?? "", query, caseSensitive);
}

/**
 * Render a changed line's text with BOTH the changed-word styling (`cls` over
 * the [start,end) range) and the Find highlight, over the *full* text — so a
 * query that straddles the changed/unchanged boundary is still highlighted. We
 * cut the text at every relevant boundary, then style each run by whether it's
 * inside the changed range and/or inside a match.
 */
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

/** Char ranges [start, end) of every occurrence of `query` in `text`. */
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

/**
 * Wrap every occurrence of `query` in `text` with a <mark> so Find matches are
 * visible in the line. Runs only for the handful of on-screen rows, so it's
 * cheap even on a huge diff. Empty query returns the text untouched.
 */
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

/** Longest line length (chars) on one side of the diff. */
function rowMaxLen(rows: DiffRow[], side: "left" | "right"): number {
  let max = 0;
  for (let i = 0; i < rows.length; i++) {
    const value = side === "left" ? rows[i].left : rows[i].right;
    if (value && value.length > max) {
      max = value.length;
    }
  }
  return max;
}

/** `min-width` for a side-by-side row: line-number gutter + longest line. */
function rowMinWidth(rows: DiffRow[], side: "left" | "right"): string {
  return contentWidth(rowMaxLen(rows, side), /* gutterCh */ 6);
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
