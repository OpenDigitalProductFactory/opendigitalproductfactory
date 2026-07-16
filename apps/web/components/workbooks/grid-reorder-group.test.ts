import { describe, it, expect } from "vitest";
import {
  reorderColumnIds,
  applyColumnOrder,
  groupRowsByColumn,
  groupKeys,
  expandedGroupSet,
  splitExpandedGroupIds,
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

describe("expandedGroupSet", () => {
  const top = ["open", "done", "blocked"];

  it("opens every top-level group by default", () => {
    expect(expandedGroupSet(top, new Set(), new Set())).toEqual(
      new Set(["open", "done", "blocked"]),
    );
  });

  it("omits top-level groups the user collapsed", () => {
    expect(expandedGroupSet(top, new Set(["done"]), new Set())).toEqual(
      new Set(["open", "blocked"]),
    );
  });

  it("adds the user's deeper (nested) expansions", () => {
    // a level-2 group under "open" is opened on demand
    expect(expandedGroupSet(top, new Set(), new Set(["open__alice"]))).toEqual(
      new Set(["open", "done", "blocked", "open__alice"]),
    );
  });

  it("retains a nested expansion under a collapsed parent (TreeDataGrid hides it; state survives a re-open)", () => {
    // Collapsing the top-level "open" group hides everything under it in the
    // grid, so keeping the remembered nested "open__alice" expansion in the set
    // is harmless — and restores it if the user re-opens "open".
    expect(expandedGroupSet(top, new Set(["open"]), new Set(["open__alice"]))).toEqual(
      new Set(["done", "blocked", "open__alice"]),
    );
  });
});

describe("splitExpandedGroupIds", () => {
  const top = ["open", "done", "blocked"];

  it("records top-level ids absent from the set as collapses", () => {
    const { collapsedGroups, extraExpanded } = splitExpandedGroupIds(
      new Set(["open", "blocked"]),
      top,
    );
    expect(collapsedGroups).toEqual(new Set(["done"]));
    expect(extraExpanded).toEqual(new Set());
  });

  it("records non-top ids present in the set as deeper expansions", () => {
    const { collapsedGroups, extraExpanded } = splitExpandedGroupIds(
      new Set(["open", "done", "blocked", "open__alice"]),
      top,
    );
    expect(collapsedGroups).toEqual(new Set());
    expect(extraExpanded).toEqual(new Set(["open__alice"]));
  });

  it("round-trips with expandedGroupSet", () => {
    const collapsed = new Set<unknown>(["done"]);
    const extra = new Set<unknown>(["open__alice"]);
    const ids = expandedGroupSet(top, collapsed, extra);
    const split = splitExpandedGroupIds(ids, top);
    expect(split.collapsedGroups).toEqual(collapsed);
    expect(split.extraExpanded).toEqual(extra);
  });
});
