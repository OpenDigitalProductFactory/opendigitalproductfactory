import { describe, it, expect } from "vitest";
import {
  textMatches,
  findMatches,
  stepMatch,
  escapeRegExp,
  countOccurrences,
  replaceInText,
} from "./grid-find-replace";

describe("textMatches", () => {
  it("is case-insensitive substring by default", () => {
    expect(textMatches("Hello World", "world")).toBe(true);
    expect(textMatches("Hello World", "WORLD")).toBe(true);
  });
  it("respects matchCase", () => {
    expect(textMatches("Hello", "hello", { matchCase: true })).toBe(false);
    expect(textMatches("Hello", "Hello", { matchCase: true })).toBe(true);
  });
  it("wholeCell requires full equality", () => {
    expect(textMatches("cat", "cat", { wholeCell: true })).toBe(true);
    expect(textMatches("category", "cat", { wholeCell: true })).toBe(false);
  });
  it("empty query never matches", () => {
    expect(textMatches("anything", "")).toBe(false);
  });
});

describe("findMatches", () => {
  // 2×3 grid; getText(r,c)
  const grid = [
    ["apple", "banana", "cherry"],
    ["apricot", "berry", "Apple pie"],
  ];
  const getText = (r: number, c: number) => grid[r]![c]!;

  it("returns matches in row-major order", () => {
    expect(findMatches(1, 2, getText, "ap")).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 1, col: 2 },
    ]);
  });
  it("case-sensitive narrows the set", () => {
    expect(findMatches(1, 2, getText, "Apple", { matchCase: true })).toEqual([{ row: 1, col: 2 }]);
  });
  it("whole-cell only exact cells", () => {
    expect(findMatches(1, 2, getText, "apple", { wholeCell: true })).toEqual([{ row: 0, col: 0 }]);
  });
  it("empty query yields nothing", () => {
    expect(findMatches(1, 2, getText, "")).toEqual([]);
  });
});

describe("stepMatch", () => {
  it("advances with wraparound", () => {
    expect(stepMatch(0, 3, 1)).toBe(1);
    expect(stepMatch(2, 3, 1)).toBe(0);
  });
  it("goes back with wraparound", () => {
    expect(stepMatch(0, 3, -1)).toBe(2);
  });
  it("returns -1 when there are no matches", () => {
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });
});

describe("escapeRegExp", () => {
  it("escapes regex metacharacters so queries are literal", () => {
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
    expect(countOccurrences("a.b.c", ".", {})).toBe(2); // literal dot, not 'any char'
  });
});

describe("countOccurrences", () => {
  it("counts case-insensitively by default", () => {
    expect(countOccurrences("aAaA", "a")).toBe(4);
  });
  it("counts case-sensitively when asked", () => {
    expect(countOccurrences("aAaA", "a", { matchCase: true })).toBe(2);
  });
  it("whole-cell is 0 or 1", () => {
    expect(countOccurrences("cat", "cat", { wholeCell: true })).toBe(1);
    expect(countOccurrences("cats", "cat", { wholeCell: true })).toBe(0);
  });
  it("empty query counts zero", () => {
    expect(countOccurrences("abc", "")).toBe(0);
  });
});

describe("replaceInText", () => {
  it("replaces every occurrence (case-insensitive default)", () => {
    expect(replaceInText("Foo foo FOO", "foo", "bar")).toBe("bar bar bar");
  });
  it("respects matchCase", () => {
    expect(replaceInText("Foo foo", "foo", "bar", { matchCase: true })).toBe("Foo bar");
  });
  it("whole-cell replaces the entire value only on full match", () => {
    expect(replaceInText("draft", "draft", "final", { wholeCell: true })).toBe("final");
    expect(replaceInText("draft-2", "draft", "final", { wholeCell: true })).toBe("draft-2");
  });
  it("treats the query literally, not as a regex", () => {
    expect(replaceInText("a+b+c", "+", "-")).toBe("a-b-c");
  });
  it("returns the original string unchanged when there is no match", () => {
    const v = "unchanged";
    expect(replaceInText(v, "zzz", "yyy")).toBe(v);
  });
});
