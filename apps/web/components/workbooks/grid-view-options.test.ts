import { describe, it, expect } from "vitest";
import {
  ROW_HEIGHTS,
  isRowHeight,
  rowHeightPx,
  visibleColumns,
  clampFrozenCount,
} from "./grid-view-options";
import type { ColumnDefinition } from "@/lib/workbooks/types";

const col = (columnId: string, position: number): ColumnDefinition => ({
  columnId,
  name: columnId.toUpperCase(),
  fieldType: "text",
  position,
  required: false,
  editable: true,
});

describe("row height", () => {
  it("maps presets to pixels and defaults to medium", () => {
    expect(rowHeightPx("short")).toBe(ROW_HEIGHTS.short);
    expect(rowHeightPx("tall")).toBe(ROW_HEIGHTS.tall);
    expect(rowHeightPx(undefined)).toBe(ROW_HEIGHTS.medium);
  });

  it("validates the preset union", () => {
    expect(isRowHeight("short")).toBe(true);
    expect(isRowHeight("tall")).toBe(true);
    expect(isRowHeight("huge")).toBe(false);
    expect(isRowHeight(42)).toBe(false);
  });
});

describe("visibleColumns", () => {
  const columns = [col("a", 0), col("b", 1), col("c", 2)];

  it("returns all columns when nothing is hidden (same reference)", () => {
    expect(visibleColumns(columns, [])).toBe(columns);
  });

  it("drops hidden columns", () => {
    expect(visibleColumns(columns, ["b"]).map((c) => c.columnId)).toEqual(["a", "c"]);
  });

  it("ignores hidden ids that no longer exist", () => {
    expect(visibleColumns(columns, ["gone", "b"]).map((c) => c.columnId)).toEqual(["a", "c"]);
  });

  it("does not mutate the input", () => {
    const input = [col("a", 0), col("b", 1)];
    visibleColumns(input, ["a"]);
    expect(input.map((c) => c.columnId)).toEqual(["a", "b"]);
  });
});

describe("clampFrozenCount", () => {
  it("clamps to leave at least one column scrollable", () => {
    expect(clampFrozenCount(5, 3)).toBe(2);
    expect(clampFrozenCount(3, 3)).toBe(2);
    expect(clampFrozenCount(2, 3)).toBe(2);
    expect(clampFrozenCount(1, 3)).toBe(1);
  });

  it("returns 0 for non-positive, non-finite, or empty-column inputs", () => {
    expect(clampFrozenCount(0, 3)).toBe(0);
    expect(clampFrozenCount(-1, 3)).toBe(0);
    expect(clampFrozenCount(NaN, 3)).toBe(0);
    expect(clampFrozenCount(2, 0)).toBe(0);
  });

  it("floors fractional counts", () => {
    expect(clampFrozenCount(1.9, 5)).toBe(1);
  });
});
