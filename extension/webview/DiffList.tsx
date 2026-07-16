import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { FixedSizeList } from "react-window";
import type { ListChildComponentProps } from "react-window";
import type { DiffRow } from "@large-file-compare/engine";

/** Which layout the diff is shown in. */
export type ViewMode = "sideBySide" | "unified";

/** Fixed row height (px) — must match `.row` line-height in styles.css. */
const ROW_HEIGHT = 20;

const MARKERS: Record<DiffRow["status"], string> = {
  added: "+",
  removed: "-",
  changed: "~",
  unchanged: " ",
};

/** Per-row line numbers for each side (null where that side has no line). */
interface LineNo {
  left: number | null;
  right: number | null;
}

interface RowData {
  rows: DiffRow[];
  lineNos: LineNo[];
}

interface DiffListProps {
  rows: DiffRow[];
  mode: ViewMode;
  leftName: string;
  rightName: string;
}

/**
 * Virtualized diff view. `react-window` keeps only the visible rows (plus a
 * small overscan) in the DOM, so a 300k-row diff stays responsive in either
 * layout. Both layouts read the same `DiffRow` (which carries left + right).
 */
export function DiffList({ rows, mode, leftName, rightName }: DiffListProps) {
  const height = useAvailableHeight();

  // Reconstruct each file's line numbers from the ordered rows: a row with a
  // left side advances the left counter, a right side advances the right one.
  // In compare-as-is (positional/set) mode these equal the real file line
  // numbers; in sorted/key mode they reflect the displayed order.
  const lineNos = useMemo<LineNo[]>(() => {
    let left = 0;
    let right = 0;
    return rows.map((row) => ({
      left: row.left !== undefined ? ++left : null,
      right: row.right !== undefined ? ++right : null,
    }));
  }, [rows]);

  const itemData: RowData = { rows, lineNos };
  const RowComponent = mode === "unified" ? UnifiedRow : SideBySideRow;

  return (
    <div className="diff-area">
      {mode === "sideBySide" && (
        <div className="columns-header">
          <span className="lineno" />
          <span className="cell cell-left" title={leftName}>
            {leftName}
          </span>
          <span className="lineno" />
          <span className="cell cell-right" title={rightName}>
            {rightName}
          </span>
        </div>
      )}

      <div className="diff-list" ref={height.ref}>
        {height.value > 0 && (
          <FixedSizeList
            height={height.value}
            width="100%"
            itemCount={rows.length}
            itemSize={ROW_HEIGHT}
            itemData={itemData}
            overscanCount={20}
          >
            {RowComponent}
          </FixedSizeList>
        )}
      </div>
    </div>
  );
}

/** Two columns with per-side line numbers: left = first file, right = second. */
function SideBySideRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const row = data.rows[index];
  const nos = data.lineNos[index];
  const left = row.left ?? "";
  const right = row.right ?? "";
  return (
    <div className={`row sxs row-${row.status}`} style={style}>
      <span className="lineno">{nos.left ?? ""}</span>
      <span className="cell cell-left" title={left}>
        {left}
      </span>
      <span className="lineno">{nos.right ?? ""}</span>
      <span className="cell cell-right" title={right}>
        {right}
      </span>
    </div>
  );
}

/** Single column: shows the "current" side, with the old value in the tooltip. */
function UnifiedRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const row = data.rows[index];
  const text = row.status === "added" || row.status === "changed" ? row.right : row.left;
  const title =
    row.status === "changed" ? `${row.right ?? ""}\n(was: ${row.left ?? ""})` : (text ?? "");
  return (
    <div className={`row row-${row.status}`} style={style} title={title}>
      <span className="marker">{MARKERS[row.status]}</span>
      <span className="text">{text ?? ""}</span>
    </div>
  );
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
