import { describe, expect, it } from "vitest";
import { diffLines } from "../src/differ";

describe("diffLines — positional mode (compare as-is, default)", () => {
  it("categorizes added / removed / unchanged", () => {
    const { summary } = diffLines(["a", "b", "c"], ["a", "c", "d"]);
    expect(summary.unchanged).toBe(2); // a, c
    expect(summary.removed).toBe(1); // b
    expect(summary.added).toBe(1); // d
    expect(summary.changed).toBe(0);
  });

  it("pairs a modified line into a single changed row", () => {
    const { rows, summary } = diffLines(["a", "b", "c"], ["a", "B", "c"]);
    expect(summary.changed).toBe(1);
    expect(summary.unchanged).toBe(2);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
    expect(rows.find((r) => r.status === "changed")).toEqual({
      status: "changed",
      left: "b",
      right: "B",
    });
  });

  it("pairs what it can and leaves the rest as removed/added", () => {
    // Block of 2 removed vs 1 added → 1 changed pair + 1 leftover removed.
    const { summary } = diffLines(["a", "x", "y", "d"], ["a", "X", "d"]);
    expect(summary.unchanged).toBe(2); // a, d
    expect(summary.changed).toBe(1); // x → X
    expect(summary.removed).toBe(1); // y
    expect(summary.added).toBe(0);
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

describe("diffLines — set mode (after sorting)", () => {
  it("does NOT pair; a modified line stays as removed + added", () => {
    const { summary } = diffLines(["a", "b", "c"], ["a", "B", "c"], { mode: "set" });
    expect(summary.unchanged).toBe(2);
    expect(summary.removed).toBe(1); // b
    expect(summary.added).toBe(1); // B
    expect(summary.changed).toBe(0);
  });
});

describe("diffLines — prefix/suffix trimming (large-file fast path)", () => {
  it("keeps the diff correct when a change is buried between long equal runs", () => {
    // Long identical prefix + suffix with a single changed line in the middle.
    const prefix = Array.from({ length: 500 }, (_, i) => `p${i}`);
    const suffix = Array.from({ length: 500 }, (_, i) => `s${i}`);
    const left = [...prefix, "middle-old", ...suffix];
    const right = [...prefix, "middle-new", ...suffix];

    const { rows, summary } = diffLines(left, right);
    expect(summary.unchanged).toBe(1000);
    expect(summary.changed).toBe(1);
    expect(summary.added + summary.removed).toBe(0);
    expect(rows.find((r) => r.status === "changed")).toEqual({
      status: "changed",
      left: "middle-old",
      right: "middle-new",
    });
    // Row order is preserved: the change sits right after the 500-line prefix.
    expect(rows[500]).toEqual({ status: "changed", left: "middle-old", right: "middle-new" });
  });

  it("shows each side's own text for an unchanged row (not a mirror of the left)", () => {
    // Equal under trim+case, but the original text differs per side.
    const { rows } = diffLines(["Hello "], ["hello"], { trim: true, caseInsensitive: true });
    expect(rows).toEqual([{ status: "unchanged", left: "Hello ", right: "hello" }]);
  });

  it("does NOT flag unrelated lines as changed — reports removed + added instead", () => {
    // A block replaced by an unrelated block (e.g. one table swapped for another).
    const left = ["shared", "readiness_score INT CHECK (x)", "blockers TEXT", "tail"];
    const right = ["shared", "status VARCHAR(50) DEFAULT 'draft'", "priority VARCHAR(20)", "tail"];
    const { summary } = diffLines(left, right);
    expect(summary.changed).toBe(0); // nothing is a genuine edit of the other
    expect(summary.removed).toBe(2);
    expect(summary.added).toBe(2);
    expect(summary.unchanged).toBe(2); // shared, tail
  });

  it("still flags a genuine value edit (mostly identical line) as changed", () => {
    const { rows, summary } = diffLines(
      ["    email VARCHAR(255) NOT NULL DEFAULT 'old@x.com',"],
      ["    email VARCHAR(255) NOT NULL DEFAULT 'new@x.com',"],
    );
    expect(summary.changed).toBe(1);
    expect(rows[0]).toEqual({
      status: "changed",
      left: "    email VARCHAR(255) NOT NULL DEFAULT 'old@x.com',",
      right: "    email VARCHAR(255) NOT NULL DEFAULT 'new@x.com',",
    });
  });

  it("does not fabricate a 'changed' from coincidental token/structure overlap", () => {
    // Share only a keyword / a value / nothing meaningful → removed + added.
    expect(diffLines(["return return return return"], ["return null throw"]).summary.changed).toBe(
      0,
    );
    expect(diffLines(["max_connections: 100"], ["port: 100"]).summary.changed).toBe(0);
    expect(diffLines([";"], [")"]).summary.changed).toBe(0);
  });

  it("recognizes a rename with identical content as changed (kebab → fused)", () => {
    expect(diffLines(["user-name: John Smith"], ["username: John Smith"]).summary.changed).toBe(1);
  });

  it("does not pair boilerplate-similar-but-unrelated lines as changed (~0.5)", () => {
    // Share 'CREATE TABLE (' structure but are different tables -> removed + added.
    const s = diffLines(["CREATE TABLE on_prem_servers ("], ["CREATE TABLE cloud_resources ("]).summary;
    expect(s.changed).toBe(0);
    expect(s.removed).toBe(1);
    expect(s.added).toBe(1);
  });

  it("pairChanged:false gives git-style output (never pairs; only added/removed)", () => {
    const s = diffLines(["a", "b", "c"], ["a", "B", "c"], { pairChanged: false }).summary;
    expect(s.changed).toBe(0);
    expect(s.unchanged).toBe(2); // a, c
    expect(s.removed).toBe(1); // b
    expect(s.added).toBe(1); // B
  });

  it("keeps every line exactly once, in order (truthful partition)", () => {
    const left = ["a", "id SERIAL,", "gone1", "gone2", "b"];
    const right = ["a", "id UUID,", "fresh1", "fresh2", "fresh3", "b"];
    const { rows } = diffLines(left, right);
    const leftOut = rows.filter((r) => r.left !== undefined).map((r) => r.left);
    const rightOut = rows.filter((r) => r.right !== undefined).map((r) => r.right);
    expect(leftOut).toEqual(left); // same lines, same order, no drops/dupes
    expect(rightOut).toEqual(right);
  });

  it("handles 200k lines with scattered differences without hanging", () => {
    // Every 10th line differs. With a naive Myers diff this is ~O(N·D) and hangs;
    // patience anchoring on the many unique unchanged lines keeps it fast. If this
    // test finishes at all, the pathological case is handled.
    const n = 200_000;
    const left: string[] = [];
    const right: string[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 10 === 3) {
        left.push(`row ${i} OLD`);
        right.push(`row ${i} NEW`);
      } else {
        left.push(`row ${i}`);
        right.push(`row ${i}`);
      }
    }
    const { summary } = diffLines(left, right);
    expect(summary.changed).toBe(n / 10);
    expect(summary.unchanged).toBe(n - n / 10);
    expect(summary.added + summary.removed).toBe(0);
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
