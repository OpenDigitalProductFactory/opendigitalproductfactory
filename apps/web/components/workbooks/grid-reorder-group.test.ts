import { describe, it, expect } from "vitest";
import {
  reorderColumnIds,
  applyColumnOrder,
  groupRowsByColumn,
  groupKeys,
  EMPTY_GROUP_LABEL,
} from "./grid-reorder-group";
import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";

const col = (columnId: string, position: number): ColumnDefinition => ({
  columnId,
  name: columnId.toUpperCase(),
  fieldType: "text",
  position,
  required: false,
  editable: true,
});

describe("reorderColumnIds", () => {
  const order = ["a", "b", "c", "d"];

  it("moves a column to the right (into the target's slot)", () => {
    expect(reorderColumnIds(order, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a column to the left (into the target's slot)", () => {
    expect(reorderColumnIds(order, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when source equals target", () => {
    expect(reorderColumnIds(order, "b", "b")).toEqual(order);
  });

  it("returns the order unchanged for an unknown key", () => {
    expect(reorderColumnIds(order, "z", "b")).toEqual(order);
    expect(reorderColumnIds(order, "a", "z")).toEqual(order);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c"];
    reorderColumnIds(input, "a", "c");
    expect(input).toEqual(["a", "b", "c"]);
  });
});

describe("applyColumnOrder", () => {
  const columns = [col("a", 0), col("b", 1), col("c", 2)];

  it("reorders columns by the saved id list", () => {
    expect(applyColumnOrder(columns, ["c", "a", "b"]).map((c) => c.columnId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("returns columns untouched for an empty order", () => {
    expect(applyColumnOrder(columns, [])).toBe(columns);
  });

  it("appends columns missing from the saved order (newly added)", () => {
    // order predates column "c" being added
    expect(applyColumnOrder(columns, ["b", "a"]).map((c) => c.columnId)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("skips ids that no longer map to a column (deleted)", () => {
    expect(applyColumnOrder(columns, ["c", "gone", "a", "b"]).map((c) => c.columnId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("never duplicates a column when the order repeats an id", () => {
    expect(applyColumnOrder(columns, ["a", "a", "b", "c"]).map((c) => c.columnId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("groupRowsByColumn", () => {
  const rows: GridRowData[] = [
    { rowId: "1", status: "open" },
    { rowId: "2", status: "done" },
    { rowId: "3", status: "open" },
    { rowId: "4", status: "" },
    { rowId: "5", status: null },
  ];

  it("buckets rows by the column's displayed value", () => {
    const grouped = groupRowsByColumn(rows, "status");
    expect(grouped["open"]!.map((r) => r.rowId)).toEqual(["1", "3"]);
    expect(grouped["done"]!.map((r) => r.rowId)).toEqual(["2"]);
  });

  it("collapses empty and null values into a single (empty) bucket", () => {
    const grouped = groupRowsByColumn(rows, "status");
    expect(grouped[EMPTY_GROUP_LABEL]!.map((r) => r.rowId)).toEqual(["4", "5"]);
  });

  it("preserves row order within a bucket (so an active sort survives)", () => {
    const grouped = groupRowsByColumn(rows, "status");
    expect(grouped["open"]!.map((r) => r.rowId)).toEqual(["1", "3"]);
  });

  it("exposes the group keys in first-seen order", () => {
    expect(groupKeys(rows, "status")).toEqual(["open", "done", EMPTY_GROUP_LABEL]);
  });
});
