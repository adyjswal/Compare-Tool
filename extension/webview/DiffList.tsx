import { useLayoutEffect, useRef, useState } from "react";
import { FixedSizeList } from "react-window";
import type { ListChildComponentProps } from "react-window";
import type { DiffRow } from "@large-file-compare/engine";

/** Fixed row height (px) — must match `.row` line-height in styles.css. */
const ROW_HEIGHT = 20;

/**
 * Virtualized diff view. `react-window` keeps only the visible rows (plus a
 * small overscan) in the DOM, so a 300k-row diff stays responsive.
 */
export function DiffList({ rows }: { rows: DiffRow[] }) {
  const height = useAvailableHeight();

  return (
    <div className="diff-list" ref={height.ref}>
      {height.value > 0 && (
        <FixedSizeList
          height={height.value}
          width="100%"
          itemCount={rows.length}
          itemSize={ROW_HEIGHT}
          itemData={rows}
          overscanCount={20}
        >
          {Row}
        </FixedSizeList>
      )}
    </div>
  );
}

function Row({ index, style, data }: ListChildComponentProps<DiffRow[]>) {
  const row = data[index];
  const marker = MARKERS[row.status];

  // Unified view: show the "current" side (right for added/changed, left
  // otherwise). Full text — and the old value for changed rows — go in the
  // tooltip, since rows are single-line with fixed height.
  const text = row.status === "added" || row.status === "changed" ? row.right : row.left;
  const title =
    row.status === "changed" ? `${row.right ?? ""}\n(was: ${row.left ?? ""})` : (text ?? "");

  return (
    <div className={`row row-${row.status}`} style={style} title={title}>
      <span className="marker">{marker}</span>
      <span className="text">{text ?? ""}</span>
    </div>
  );
}

const MARKERS: Record<DiffRow["status"], string> = {
  added: "+",
  removed: "-",
  changed: "~",
  unchanged: " ",
};

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
