import { describe, expect, it } from "vitest";
import { buildRowModel } from "../webview/rowModel";
import type { RowModel } from "../webview/rowModel";

/** Build a status column from a compact string: u/a/r/c → 0/1/2/3. */
function statuses(spec: string): Uint8Array {
  const code: Record<string, number> = { u: 0, a: 1, r: 2, c: 3 };
  return Uint8Array.from([...spec], (ch) => {
    const v = code[ch];
    if (v === undefined) throw new Error(`bad status char: ${ch}`);
    return v;
  });
}

/** Expand a model into the absolute row / fold sequence it renders. */
function display(model: RowModel, total: number): Array<number | { fold: [number, number] }> {
  const out: Array<number | { fold: [number, number] }> = [];
  for (let d = 0; d < model.count; d++) {
    const v = model.map ? model.map[d] : d;
    if (model.map && v < 0) {
      const fold = model.folds[-1 - v];
      out.push({ fold: [fold.start, fold.end] });
    } else {
      out.push(v);
    }
  }
  void total;
  return out;
}

describe("buildRowModel — all", () => {
  it("is identity (no allocation) regardless of content", () => {
    const s = statuses("uacru");
    const m = buildRowModel(s, "all", 3, new Set());
    expect(m.count).toBe(5);
    expect(m.map).toBeNull();
    expect(m.absToDisplay).toBeNull();
    expect(m.displayStatuses).toBeNull();
    expect(m.folds).toEqual([]);
  });

  it("empty input is identity", () => {
    const m = buildRowModel(statuses(""), "changes", 3, new Set());
    expect(m.count).toBe(0);
    expect(m.map).toBeNull();
  });
});

describe("buildRowModel — changes", () => {
  it("keeps only rows that differ, in order", () => {
    const s = statuses("uuacuuruu"); // changes at 2(a),3(c),6(r)
    const m = buildRowModel(s, "changes", 3, new Set());
    expect(display(m, s.length)).toEqual([2, 3, 6]);
    expect([...m.displayStatuses!]).toEqual([1, 3, 2]);
  });

  it("maps a hidden row to the next visible display row", () => {
    const s = statuses("uuacuuruu");
    const m = buildRowModel(s, "changes", 3, new Set());
    // rows 0,1 (unchanged) -> first visible display (0); row 4,5 -> display of row 6 (2)
    expect(m.absToDisplay![0]).toBe(0);
    expect(m.absToDisplay![2]).toBe(0); // the 'a' row itself
    expect(m.absToDisplay![4]).toBe(2); // next visible is row 6 at display 2
    expect(m.absToDisplay![8]).toBe(2); // trailing unchanged clamps to last visible
  });

  it("all-unchanged collapses to an empty list", () => {
    const s = statuses("uuuu");
    const m = buildRowModel(s, "changes", 3, new Set());
    expect(m.count).toBe(0);
  });
});

describe("buildRowModel — collapsed", () => {
  it("folds a long unchanged run into one marker with context on each side", () => {
    // 10 unchanged then a change. context=3 → show 0,1,2, fold [3,7), show 7,8,9, then 10.
    const s = statuses("uuuuuuuuuuc");
    const m = buildRowModel(s, "collapsed", 3, new Set());
    expect(display(m, s.length)).toEqual([0, 1, 2, { fold: [3, 7] }, 7, 8, 9, 10]);
    const fold = m.folds[0];
    expect(fold).toMatchObject({ runStart: 0, start: 3, end: 7, count: 4 });
  });

  it("does not fold a run of exactly 2*context", () => {
    const s = statuses("uuuuuuc"); // 6 unchanged = 2*3, then change
    const m = buildRowModel(s, "collapsed", 3, new Set());
    expect(m.folds).toHaveLength(0);
    expect(display(m, s.length)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("expanding a run (by its run-start) reveals every row", () => {
    const s = statuses("uuuuuuuuuuc");
    const m = buildRowModel(s, "collapsed", 3, new Set([0]));
    expect(m.folds).toHaveLength(0);
    expect(display(m, s.length)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("folds each long run independently; changed rows always show", () => {
    // run A (8 u), change, run B (8 u), change
    const s = statuses("uuuuuuuucuuuuuuuuc");
    const m = buildRowModel(s, "collapsed", 3, new Set());
    expect(m.folds).toHaveLength(2);
    expect(display(m, s.length)).toEqual([
      0, 1, 2, { fold: [3, 5] }, 5, 6, 7, // run A [0,8)
      8, // change
      9, 10, 11, { fold: [12, 14] }, 14, 15, 16, // run B [9,17)
      17, // change
    ]);
  });

  it("hidden rows in a fold map to the fold's display index", () => {
    const s = statuses("uuuuuuuuuuc");
    const m = buildRowModel(s, "collapsed", 3, new Set());
    // Fold sits at display index 3 (after rows 0,1,2). Rows 3..6 are hidden.
    expect(m.absToDisplay![4]).toBe(3);
    expect(m.absToDisplay![6]).toBe(3);
    // Visible rows map to their own display index.
    expect(m.absToDisplay![7]).toBe(4);
    expect(m.absToDisplay![10]).toBe(7);
  });
});
