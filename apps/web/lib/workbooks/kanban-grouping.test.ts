import { describe, it, expect } from "vitest";
import {
  groupRowsByColumn,
  defaultGroupByColumn,
  cardFieldLayout,
} from "./kanban-grouping";
import type { ColumnDefinition, GridRow } from "./types";

const columns: ColumnDefinition[] = [
  { columnId: "itemId", name: "ID", fieldType: "text", position: 0, required: false, editable: false },
  { columnId: "title", name: "Title", fieldType: "text", position: 1, required: true, editable: true },
  {
    columnId: "status",
    name: "Status",
    fieldType: "select",
    position: 2,
    required: true,
    editable: true,
    groupable: true,
    config: { options: [
      { key: "open", label: "Open" },
      { key: "in-progress", label: "In Progress" },
      { key: "done", label: "Done" },
    ] },
  },
  { columnId: "priority", name: "Priority", fieldType: "number", position: 3, required: false, editable: true },
];

const rows: GridRow[] = [
  { rowId: "BI-1", cells: { itemId: "BI-1", title: "A", status: "open", priority: 1 } },
  { rowId: "BI-2", cells: { itemId: "BI-2", title: "B", status: "done", priority: 2 } },
  { rowId: "BI-3", cells: { itemId: "BI-3", title: "C", status: "open", priority: 3 } },
];

describe("groupRowsByColumn", () => {
  it("creates a lane per option in option order", () => {
    const lanes = groupRowsByColumn(rows, columns, "status");
    expect(lanes.map((l) => l.key)).toEqual(["open", "in-progress", "done"]);
    expect(lanes.find((l) => l.key === "open")?.rows.map((r) => r.rowId)).toEqual(["BI-1", "BI-3"]);
    expect(lanes.find((l) => l.key === "done")?.rows.map((r) => r.rowId)).toEqual(["BI-2"]);
  });

  it("uses option labels as lane labels", () => {
    const lanes = groupRowsByColumn(rows, columns, "status");
    expect(lanes.find((l) => l.key === "in-progress")?.label).toBe("In Progress");
  });

  it("adds an (unset) lane only when a row has no/unknown value", () => {
    const withUnset: GridRow[] = [
      ...rows,
      { rowId: "BI-4", cells: { itemId: "BI-4", title: "D", status: null, priority: 0 } },
      { rowId: "BI-5", cells: { itemId: "BI-5", title: "E", status: "weird", priority: 0 } },
    ];
    const lanes = groupRowsByColumn(withUnset, columns, "status");
    const unset = lanes.find((l) => l.label === "(unset)");
    expect(unset?.rows.map((r) => r.rowId)).toEqual(["BI-4", "BI-5"]);
  });

  it("omits the (unset) lane when every row has a known value", () => {
    const lanes = groupRowsByColumn(rows, columns, "status");
    expect(lanes.some((l) => l.label === "(unset)")).toBe(false);
  });
});

describe("defaultGroupByColumn", () => {
  it("picks the first groupable select column", () => {
    expect(defaultGroupByColumn(columns)).toBe("status");
  });
  it("returns null when no column is groupable", () => {
    const none = columns.map((c) => ({ ...c, groupable: false }));
    expect(defaultGroupByColumn(none)).toBeNull();
  });
});

describe("cardFieldLayout", () => {
  it("uses the first editable text column as title and excludes the group column", () => {
    const { titleColumnId, metaColumnIds } = cardFieldLayout(columns, "status", 2);
    expect(titleColumnId).toBe("title");
    expect(metaColumnIds).not.toContain("status");
    expect(metaColumnIds).not.toContain("title");
    expect(metaColumnIds.length).toBeLessThanOrEqual(2);
  });
});
