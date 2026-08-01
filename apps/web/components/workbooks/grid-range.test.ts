import { describe, it, expect } from "vitest";
import {
  rangeRect,
  singleCell,
  rangeContains,
  isMultiCell,
  clampCell,
  extendFocus,
  rangeToTsv,
  parseTsv,
  pasteWrites,
  fillDownWrites,
  fillRightWrites,
  type CellRange,
} from "./grid-range";

describe("rangeRect / singleCell / isMultiCell", () => {
  it("normalizes an inverted range", () => {
    const r: CellRange = { anchorRow: 5, anchorCol: 4, focusRow: 2, focusCol: 1 };
    expect(rangeRect(r)).toEqual({ top: 2, bottom: 5, left: 1, right: 4 });
  });

  it("singleCell is a 1×1 range", () => {
    const r = singleCell(3, 7);
    expect(rangeRect(r)).toEqual({ top: 3, bottom: 3, left: 7, right: 7 });
    expect(isMultiCell(r)).toBe(false);
  });

  it("isMultiCell true when anchor≠focus", () => {
    expect(isMultiCell({ anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 1 })).toBe(true);
  });
});

describe("rangeContains", () => {
  const r: CellRange = { anchorRow: 1, anchorCol: 1, focusRow: 3, focusCol: 2 };
  it("includes cells inside the rectangle", () => {
    expect(rangeContains(r, 2, 1)).toBe(true);
    expect(rangeContains(r, 3, 2)).toBe(true);
  });
  it("excludes cells outside", () => {
    expect(rangeContains(r, 0, 1)).toBe(false);
    expect(rangeContains(r, 2, 3)).toBe(false);
  });
});

describe("clampCell / extendFocus", () => {
  it("clamps to bounds", () => {
    expect(clampCell(-2, 9, 4, 4)).toEqual({ row: 0, col: 4 });
  });
  it("extends focus down, anchor unchanged", () => {
    const r = singleCell(1, 1);
    const next = extendFocus(r, 1, 0, 5, 5);
    expect(next).toEqual({ anchorRow: 1, anchorCol: 1, focusRow: 2, focusCol: 1 });
  });
  it("extend clamps at the edge", () => {
    const r = singleCell(5, 5);
    expect(extendFocus(r, 1, 1, 5, 5)).toEqual({ anchorRow: 5, anchorCol: 5, focusRow: 5, focusCol: 5 });
  });
});

describe("rangeToTsv", () => {
  it("serializes a rectangle to TSV (tabs cols, newlines rows)", () => {
    const rect = { top: 0, bottom: 1, left: 0, right: 1 };
    const grid = [
      ["a", "b"],
      ["c", "d"],
    ];
    expect(rangeToTsv(rect, (r, c) => grid[r]![c]!)).toBe("a\tb\nc\td");
  });
});

describe("parseTsv", () => {
  it("parses a TSV block", () => {
    expect(parseTsv("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("normalizes CRLF and ignores a trailing newline", () => {
    expect(parseTsv("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
  it("returns a single empty cell for empty text", () => {
    expect(parseTsv("")).toEqual([[""]]);
  });
});

describe("pasteWrites", () => {
  it("a 1×1 clipboard fills the whole target rectangle (Excel)", () => {
    const writes = pasteWrites([["X"]], 0, 0, { top: 0, bottom: 1, left: 0, right: 1 }, 9, 9);
    expect(writes).toEqual([
      { row: 0, col: 0, value: "X" },
      { row: 0, col: 1, value: "X" },
      { row: 1, col: 0, value: "X" },
      { row: 1, col: 1, value: "X" },
    ]);
  });

  it("a block lays out from the origin", () => {
    const block = [
      ["a", "b"],
      ["c", "d"],
    ];
    const writes = pasteWrites(block, 2, 3, { top: 2, bottom: 2, left: 3, right: 3 }, 9, 9);
    expect(writes).toEqual([
      { row: 2, col: 3, value: "a" },
      { row: 2, col: 4, value: "b" },
      { row: 3, col: 3, value: "c" },
      { row: 3, col: 4, value: "d" },
    ]);
  });

  it("clips the block to the grid bounds", () => {
    const block = [
      ["a", "b"],
      ["c", "d"],
    ];
    // origin at the last row/col — only "a" fits.
    const writes = pasteWrites(block, 4, 4, { top: 4, bottom: 4, left: 4, right: 4 }, 4, 4);
    expect(writes).toEqual([{ row: 4, col: 4, value: "a" }]);
  });
});

describe("fillDownWrites (Ctrl+D)", () => {
  // grid values: getCell(r,c) = `${r}-${c}`
  const getCell = (r: number, c: number) => `${r}-${c}`;
  it("copies each column's top-row value down over the rect", () => {
    const writes = fillDownWrites({ top: 1, bottom: 3, left: 2, right: 3 }, getCell);
    expect(writes).toEqual([
      { row: 2, col: 2, value: "1-2" },
      { row: 3, col: 2, value: "1-2" },
      { row: 2, col: 3, value: "1-3" },
      { row: 3, col: 3, value: "1-3" },
    ]);
  });
  it("is empty for a single-row rect (nothing below the top)", () => {
    expect(fillDownWrites({ top: 5, bottom: 5, left: 0, right: 2 }, getCell)).toEqual([]);
  });
});

describe("fillRightWrites (Ctrl+R)", () => {
  const getCell = (r: number, c: number) => `${r}-${c}`;
  it("copies each row's left-column value across the rect", () => {
    const writes = fillRightWrites({ top: 0, bottom: 1, left: 0, right: 2 }, getCell);
    expect(writes).toEqual([
      { row: 0, col: 1, value: "0-0" },
      { row: 0, col: 2, value: "0-0" },
      { row: 1, col: 1, value: "1-0" },
      { row: 1, col: 2, value: "1-0" },
    ]);
  });
  it("is empty for a single-column rect", () => {
    expect(fillRightWrites({ top: 0, bottom: 2, left: 4, right: 4 }, getCell)).toEqual([]);
  });
});
