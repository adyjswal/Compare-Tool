import { describe, expect, it } from "vitest";
import { filterRows } from "../src/filter";
import { DiffRow } from "../src/types";

const rows: DiffRow[] = [
  { status: "unchanged", left: "alpha", right: "alpha" },
  { status: "removed", left: "BETA" },
  { status: "added", right: "gamma" },
];

describe("filterRows", () => {
  it("returns all rows for an empty query", () => {
    expect(filterRows(rows, "")).toHaveLength(3);
  });

  it("matches on either side, case-insensitively by default", () => {
    expect(filterRows(rows, "beta")).toEqual([{ status: "removed", left: "BETA" }]);
    expect(filterRows(rows, "GAMMA")).toEqual([{ status: "added", right: "gamma" }]);
  });

  it("respects case-sensitive matching when asked", () => {
    expect(filterRows(rows, "beta", { caseInsensitive: false })).toHaveLength(0);
    expect(filterRows(rows, "BETA", { caseInsensitive: false })).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    filterRows(rows, "alpha");
    expect(rows).toHaveLength(3);
  });
});
