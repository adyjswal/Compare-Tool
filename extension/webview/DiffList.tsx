import {
  forwardRef,
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

  useImperativeHandle(
    ref,
    () => ({
      scrollToRow(index: number) {
        const list = mode === "unified" ? unifiedListRef.current : leftListRef.current;
        list?.scrollToItem(index, "center");
      },
    }),
    [mode],
  );

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
        {height.value > 0 &&
          (mode === "sideBySide" ? (
            <SideBySide
              rows={rows}
              lineNos={lineNos}
              height={height.value}
              currentIndex={currentIndex}
              query={query}
              caseSensitive={caseSensitive}
              leftListRef={leftListRef}
            />
          ) : (
            <Unified
              rows={rows}
              height={height.value}
              currentIndex={currentIndex}
              query={query}
              caseSensitive={caseSensitive}
              listRef={unifiedListRef}
            />
          ))}
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

function SideBySide({
  rows,
  lineNos,
  height,
  currentIndex,
  query,
  caseSensitive,
  leftListRef,
}: {
  rows: DiffRow[];
  lineNos: LineNo[];
  height: number;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
  leftListRef: RefObject<FixedSizeList>;
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
}

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
        {highlight(text, data.query, data.caseSensitive)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Unified: single pane
 * ------------------------------------------------------------------ */

interface UnifiedData {
  rows: DiffRow[];
  minWidth: string;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
}

function Unified({
  rows,
  height,
  currentIndex,
  query,
  caseSensitive,
  listRef,
}: {
  rows: DiffRow[];
  height: number;
  currentIndex: number | null;
  query: string;
  caseSensitive: boolean;
  listRef: RefObject<FixedSizeList>;
}) {
  const minWidth = useMemo(() => {
    const longest = Math.max(rowMaxLen(rows, "left"), rowMaxLen(rows, "right"));
    return contentWidth(longest, /* gutterCh */ 2);
  }, [rows]);
  const itemData: UnifiedData = { rows, minWidth, currentIndex, query, caseSensitive };
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
    >
      {UnifiedRow}
    </FixedSizeList>
  );
}

/** Single column: shows the "current" side, with the old value in the tooltip. */
function UnifiedRow({ index, style, data }: ListChildComponentProps<UnifiedData>) {
  const row = data.rows[index];
  const text = row.status === "added" || row.status === "changed" ? row.right : row.left;
  const title =
    row.status === "changed" ? `${row.right ?? ""}\n(was: ${row.left ?? ""})` : (text ?? "");
  const rowStyle: CSSProperties = { ...style, minWidth: data.minWidth };
  const current = index === data.currentIndex ? " row-current" : "";
  return (
    <div className={`row row-${row.status}${current}`} style={rowStyle} title={title}>
      <span className="marker">{MARKERS[row.status]}</span>
      <span className="text">{highlight(text ?? "", data.query, data.caseSensitive)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

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
