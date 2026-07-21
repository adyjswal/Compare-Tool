import { describe, expect, it } from "vitest";
import {
  clampFirstRow,
  computeGeometry,
  firstRowToScrollTop,
  scrollTopToFirstRow,
  wheelDeltaToRows,
} from "../webview/scrollMapping";

const ROW = 20;
// A safe cap ~90% of a ~14.3M px browser clamp, like a real machine.
const SAFE = Math.floor(14_300_000 * 0.9);

/** (total rows, viewport height) cases: edge, fits, scale=1, and scaled. */
const CASES: Array<[number, number]> = [
  [0, 850],
  [1, 850],
  [10, 850], // fits inside the viewport
  [40, 850],
  [100_000, 850], // scale = 1
  [100_000, 810], // scale = 1, viewport NOT a multiple of the row height
  [1_000_000, 850], // scaled (common case)
  [1_562_779, 850], // scaled (a real large file)
  [5_000_000, 850], // scaled (the ceiling)
];

describe("computeGeometry", () => {
  it("keeps the scrollable height within the safe cap", () => {
    for (const [total, vh] of CASES) {
      const g = computeGeometry(total, ROW, vh, SAFE);
      expect(g.scaledHeight).toBeLessThanOrEqual(Math.max(ROW, SAFE));
      expect(g.scale).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not scroll when everything fits", () => {
    const g = computeGeometry(10, ROW, 850, SAFE); // 200px content < 850px viewport
    expect(g.maxFirstRow).toBe(0);
    expect(g.maxScrollTop).toBe(0);
    expect(g.scale).toBe(1);
  });
});

describe("scroll mapping guarantees", () => {
  it("row 0 sits at scrollTop 0", () => {
    for (const [total, vh] of CASES) {
      const g = computeGeometry(total, ROW, vh, SAFE);
      expect(scrollTopToFirstRow(0, g)).toBe(0);
      expect(firstRowToScrollTop(0, g)).toBe(0);
    }
  });

  it("scrolling fully down reaches the last possible first-row", () => {
    for (const [total, vh] of CASES) {
      const g = computeGeometry(total, ROW, vh, SAFE);
      expect(scrollTopToFirstRow(g.maxScrollTop, g)).toBe(g.maxFirstRow);
    }
  });

  it("scroll-beyond: an overflowing list can lift its LAST row to the top", () => {
    for (const [total, vh] of CASES) {
      if (total * ROW <= vh) continue; // only overflowing lists get scroll-beyond
      const g = computeGeometry(total, ROW, vh, SAFE);
      expect(g.maxFirstRow).toBe(total - 1);
    }
  });

  it("stays within [0, maxFirstRow] across the whole scroll range", () => {
    for (const [total, vh] of CASES) {
      const g = computeGeometry(total, ROW, vh, SAFE);
      for (let k = 0; k <= 40; k++) {
        const r = scrollTopToFirstRow((g.maxScrollTop * k) / 40, g);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(g.maxFirstRow);
      }
    }
  });

  it("is pixel-exact and round-trips when unscaled (scale = 1)", () => {
    for (const [total, vh] of CASES) {
      const g = computeGeometry(total, ROW, vh, SAFE);
      if (g.scale !== 1 || g.maxFirstRow === 0) continue;
      const step = Math.max(1, Math.floor(g.maxFirstRow / 5000));
      for (let r = 0; r <= g.maxFirstRow; r += step) {
        expect(scrollTopToFirstRow(firstRowToScrollTop(r, g), g)).toBe(r);
      }
      // The extreme row round-trips exactly too.
      expect(scrollTopToFirstRow(firstRowToScrollTop(g.maxFirstRow, g), g)).toBe(g.maxFirstRow);
    }
  });

  it("clampFirstRow bounds any index", () => {
    const g = computeGeometry(1000, ROW, 850, SAFE);
    expect(clampFirstRow(-5, g)).toBe(0);
    expect(clampFirstRow(10 ** 9, g)).toBe(g.maxFirstRow);
    expect(clampFirstRow(500, g)).toBe(500);
  });
});

describe("wheelDeltaToRows", () => {
  const vis = 42;
  it("returns 0 only for a zero delta", () => {
    expect(wheelDeltaToRows(0, 0, ROW, vis)).toBe(0);
  });

  it("moves at least one row for any non-zero delta (never stalls)", () => {
    expect(wheelDeltaToRows(1, 0, ROW, vis)).toBe(1); // tiny pixel delta down
    expect(wheelDeltaToRows(-1, 0, ROW, vis)).toBe(-1); // tiny pixel delta up
  });

  it("converts pixels, lines and pages to whole rows", () => {
    expect(wheelDeltaToRows(100, 0, ROW, vis)).toBe(5); // 100px / 20 = 5 rows
    expect(wheelDeltaToRows(3, 1, ROW, vis)).toBe(3); // 3 lines = 3 rows
    expect(wheelDeltaToRows(1, 2, ROW, vis)).toBe(vis - 1); // page down
    expect(wheelDeltaToRows(-1, 2, ROW, vis)).toBe(-(vis - 1)); // page up (direction only)
  });
});
