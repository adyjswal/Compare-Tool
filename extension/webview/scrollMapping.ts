/**
 * Pure math for "scaled scrolling".
 *
 * A virtual list stacks all rows into one element of height `rows × rowHeight`.
 * Browsers refuse to render an element past a hard maximum height (tens of
 * millions of px), so past that point the scrollbar can't reach the last rows.
 * To scale beyond it we cap the scrollable element at a safe height and map
 * scroll position ↔ row index *proportionally*.
 *
 * Below the cap `scale === 1` and the mapping is pixel-exact — identical to a
 * normal 1:1 virtual list, so small files behave exactly as before. Above the
 * cap only free-hand scrollbar-thumb dragging is coarse (rounded to the nearest
 * row); wheel / keyboard / scroll-to-row callers step `firstRow` directly and
 * stay exact.
 *
 * No React or DOM here, so it is unit-testable in plain Node.
 */

export interface ScrollGeometry {
  total: number;
  rowHeight: number;
  viewportHeight: number;
  /** Height actually given to the scrollable element (≤ safeCap, ≤ contentH). */
  scaledHeight: number;
  /** Virtual px per scaled px (≥ 1). 1 means no scaling / pixel-exact. */
  scale: number;
  /** Largest value the element's scrollTop can take. */
  maxScrollTop: number;
  /** Rows fully or partially visible in the viewport. */
  visibleRows: number;
  /** Largest valid first-visible row, so the very last row is reachable. */
  maxFirstRow: number;
}

/** Derive all scroll geometry for a list. Pure; safe for any non-negative input. */
export function computeGeometry(
  total: number,
  rowHeight: number,
  viewportHeight: number,
  safeCap: number,
): ScrollGeometry {
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const contentHeight = total * rowHeight;
  const overflow = contentHeight > viewportHeight;
  // "Scroll beyond last row" (like VS Code's scrollBeyondLastLine): pad the
  // scroll range with up to one screen of empty space so the last row can be
  // lifted to the top and fully seen, instead of sitting clipped at the bottom
  // edge. With that padding the top-most reachable row is the last row itself.
  const beyondRows = overflow ? Math.max(0, visibleRows - 1) : 0;
  const scrollHeight = (total + beyondRows) * rowHeight;
  // Never below one row; never above the caller's safe cap.
  const cap = Math.max(rowHeight, safeCap);
  const scaledHeight = Math.min(scrollHeight, cap);
  const scale = scrollHeight > scaledHeight && scaledHeight > 0 ? scrollHeight / scaledHeight : 1;
  const maxScrollTop = Math.max(0, scaledHeight - viewportHeight);
  const maxFirstRow = overflow ? Math.max(0, total - 1) : 0;
  return { total, rowHeight, viewportHeight, scaledHeight, scale, maxScrollTop, visibleRows, maxFirstRow };
}

/** Map a (scaled) scrollTop to the first visible row. Rounds → coarse when scaled. */
export function scrollTopToFirstRow(scrollTop: number, g: ScrollGeometry): number {
  if (g.maxScrollTop <= 0 || g.maxFirstRow <= 0) {
    return 0;
  }
  const t = Math.min(g.maxScrollTop, Math.max(0, scrollTop));
  // Unscaled: pixel-exact, identical to a normal 1:1 virtual list.
  if (g.scale === 1) {
    return Math.min(g.maxFirstRow, Math.floor(t / g.rowHeight));
  }
  const row = Math.round((t / g.maxScrollTop) * g.maxFirstRow);
  return Math.min(g.maxFirstRow, Math.max(0, row));
}

/** Map a first-visible row to the (scaled) scrollTop that shows it at the top. */
export function firstRowToScrollTop(firstRow: number, g: ScrollGeometry): number {
  if (g.maxFirstRow <= 0 || g.maxScrollTop <= 0) {
    return 0;
  }
  const r = Math.min(g.maxFirstRow, Math.max(0, firstRow));
  // Unscaled: exact pixel offset (round-trips perfectly through the mapping).
  if (g.scale === 1) {
    return Math.min(g.maxScrollTop, r * g.rowHeight);
  }
  const top = Math.round((r / g.maxFirstRow) * g.maxScrollTop);
  return Math.min(g.maxScrollTop, Math.max(0, top));
}

/** Clamp a row index into the valid [0, maxFirstRow] range. */
export function clampFirstRow(firstRow: number, g: ScrollGeometry): number {
  return Math.min(g.maxFirstRow, Math.max(0, firstRow));
}

// WheelEvent.deltaMode values (avoids relying on the DOM enum in tests).
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/**
 * Convert a wheel event's vertical delta into a whole number of rows to step.
 * Always non-zero when `deltaY` is non-zero, so a small pixel delta still moves
 * at least one row (exact stepping regardless of scale).
 */
export function wheelDeltaToRows(
  deltaY: number,
  deltaMode: number,
  rowHeight: number,
  visibleRows: number,
): number {
  if (deltaY === 0) {
    return 0;
  }
  const dir = deltaY > 0 ? 1 : -1;
  if (deltaMode === DOM_DELTA_LINE) {
    return Math.trunc(deltaY) || dir;
  }
  if (deltaMode === DOM_DELTA_PAGE) {
    return dir * Math.max(1, visibleRows - 1);
  }
  // DOM_DELTA_PIXEL (the common case).
  void DOM_DELTA_PIXEL;
  const rows = Math.round(deltaY / rowHeight);
  return rows === 0 ? dir : rows;
}
