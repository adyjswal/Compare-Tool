import { describe, expect, it } from "vitest";
import { sortLines } from "../src/sorter";

describe("sortLines", () => {
  it("sorts alphabetically A→Z by default", () => {
    expect(sortLines(["banana", "apple", "cherry"])).toEqual(["apple", "banana", "cherry"]);
  });

  it("sorts Z→A when direction is desc", () => {
    expect(sortLines(["apple", "cherry", "banana"], { direction: "desc" })).toEqual([
      "cherry",
      "banana",
      "apple",
    ]);
  });

  it("numeric mode: 2 sorts before 10 (not lexicographic)", () => {
    // Lexicographic: "1" < "10" < "2".
    expect(sortLines(["10", "2", "1"])).toEqual(["1", "10", "2"]);
    // Numeric: 1 < 2 < 10.
    expect(sortLines(["10", "2", "1"], { mode: "numeric" })).toEqual(["1", "2", "10"]);
  });

  it("case-insensitive changes ordering of mixed-case values", () => {
    // Case-sensitive: uppercase "B" (66) sorts before lowercase "a" (97).
    expect(sortLines(["B", "a"])).toEqual(["B", "a"]);
    // Case-insensitive: "a" before "b".
    expect(sortLines(["B", "a"], { caseInsensitive: true })).toEqual(["a", "B"]);
  });

  it("trims whitespace before comparing (default on)", () => {
    expect(sortLines(["  b", "a "])).toEqual(["a ", "  b"]);
    // With trim off, the leading spaces sort before any letter.
    expect(sortLines(["  b", "a "], { trim: false })).toEqual(["  b", "a "]);
  });

  it("sorts by a 1-based column with a delimiter", () => {
    const rows = ["3,foo", "1,bar", "2,baz"];
    // Numeric sort on column 1.
    expect(sortLines(rows, { mode: "numeric", column: { delimiter: ",", index: 1 } })).toEqual([
      "1,bar",
      "2,baz",
      "3,foo",
    ]);
    // Alphabetical sort on column 2 (bar < baz < foo).
    expect(sortLines(rows, { column: { delimiter: ",", index: 2 } })).toEqual([
      "1,bar",
      "2,baz",
      "3,foo",
    ]);
  });

  it("is stable for equal keys", () => {
    const rows = ["1,first", "1,second", "1,third"];
    expect(sortLines(rows, { column: { delimiter: ",", index: 1 } })).toEqual(rows);
  });

  it("does not mutate the input array", () => {
    const input = ["b", "a"];
    sortLines(input);
    expect(input).toEqual(["b", "a"]);
  });
});
