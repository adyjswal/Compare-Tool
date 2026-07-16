import { describe, expect, it } from "vitest";
import { diffLines } from "../src/differ";

describe("diffLines — whole-line set difference", () => {
  it("categorizes added / removed / unchanged", () => {
    const { summary } = diffLines(["a", "b", "c"], ["a", "c", "d"]);
    expect(summary.unchanged).toBe(2); // a, c
    expect(summary.removed).toBe(1); // b
    expect(summary.added).toBe(1); // d
    expect(summary.changed).toBe(0);
  });

  it("preserves duplicates (multiplicity matters)", () => {
    // Left has three "a", right has one → two of them are "removed".
    const { summary } = diffLines(["a", "a", "a", "b"], ["a", "b"]);
    expect(summary.unchanged).toBe(2); // one "a" + "b"
    expect(summary.removed).toBe(2); // the two extra "a"
    expect(summary.added).toBe(0);
  });

  it("treats lines equal under trim/case options as unchanged", () => {
    const { summary } = diffLines(["Hello ", "world"], ["hello", "world"], {
      trim: true,
      caseInsensitive: true,
    });
    expect(summary.unchanged).toBe(2);
    expect(summary.added + summary.removed + summary.changed).toBe(0);
  });
});

describe("diffLines — key-based reconciliation", () => {
  const key = { delimiter: ",", index: 1 };

  it("flags same key + different content as changed", () => {
    const left = ["1,alice", "2,bob"];
    const right = ["1,alicia", "2,bob", "3,carol"];
    const { rows, summary } = diffLines(left, right, { key });

    expect(summary.changed).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(0);

    const changed = rows.find((r) => r.status === "changed");
    expect(changed).toEqual({ status: "changed", left: "1,alice", right: "1,alicia" });
  });

  it("flags a key present only on the left as removed", () => {
    const { summary } = diffLines(["9,ghost", "1,x"], ["1,x"], { key });
    expect(summary.removed).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.changed).toBe(0);
  });
});
