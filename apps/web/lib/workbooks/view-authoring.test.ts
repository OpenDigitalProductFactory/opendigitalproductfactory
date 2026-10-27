import { describe, it, expect } from "vitest";
import { buildViewConfig, resolveBoardView, type StoredView } from "./view-authoring";
import type { ColumnDefinition, FieldType } from "./types";

function col(columnId: string, name: string, fieldType: FieldType, config?: ColumnDefinition["config"]): ColumnDefinition {
  return { columnId, name, fieldType, position: 0, required: false, editable: true, config };
}

const COLUMNS: ColumnDefinition[] = [
  col("COL-title", "Title", "text"),
  col("COL-status", "Status", "select", {
    options: [
      { key: "todo", label: "To do" },
      { key: "done", label: "Done" },
    ],
  }),
  col("COL-empty", "Empty select", "select", { options: [] }),
  col("COL-due", "Due", "date"),
];

describe("buildViewConfig — what a coworker-created view stores", () => {
  it("stores a kanban view grouped by a select column, with default card fields", () => {
    const v = buildViewConfig({ viewType: "kanban", groupByColumnId: "COL-status" }, COLUMNS);
    expect(v.viewType).toBe("kanban");
    expect(v.config).toEqual({ kanban: { groupByColumnId: "COL-status", cardFields: ["COL-title", "COL-empty", "COL-due"] } });
  });

  it("keeps explicit card fields when they are columns of the table", () => {
    const v = buildViewConfig({ viewType: "kanban", groupByColumnId: "COL-status", cardFields: ["COL-due"] }, COLUMNS);
    expect(v.config).toEqual({ kanban: { groupByColumnId: "COL-status", cardFields: ["COL-due"] } });
  });

  it("refuses a kanban view without a select column that has options", () => {
    expect(() => buildViewConfig({ viewType: "kanban" }, COLUMNS)).toThrow(/group-by column/i);
    expect(() => buildViewConfig({ viewType: "kanban", groupByColumnId: "COL-due" }, COLUMNS)).toThrow(/select column/i);
    expect(() => buildViewConfig({ viewType: "kanban", groupByColumnId: "COL-empty" }, COLUMNS)).toThrow(/options/i);
    expect(() => buildViewConfig({ viewType: "kanban", groupByColumnId: "COL-other-table" }, COLUMNS)).toThrow(/not a column/i);
  });

  it("refuses card fields from outside the table", () => {
    expect(() =>
      buildViewConfig({ viewType: "kanban", groupByColumnId: "COL-status", cardFields: ["COL-x"] }, COLUMNS),
    ).toThrow(/not a column/i);
  });

  it("stores a grid view as a plain grid state and refuses unknown view types", () => {
    expect(buildViewConfig({ viewType: "grid" }, COLUMNS)).toEqual({ viewType: "grid", config: {} });
    expect(() => buildViewConfig({ viewType: "gantt" as "grid" }, COLUMNS)).toThrow(/grid or kanban/i);
  });
});

describe("resolveBoardView — which board the workbook page opens", () => {
  const board: StoredView = {
    viewId: "VW-board",
    name: "Board",
    viewType: "kanban",
    isDefault: false,
    config: { kanban: { groupByColumnId: "COL-status", cardFields: [] } },
  };
  const grid: StoredView = { viewId: "VW-grid", name: "Mine", viewType: "grid", isDefault: true, config: {} };

  it("opens the requested kanban view", () => {
    expect(resolveBoardView([grid, board], "VW-board", COLUMNS)).toEqual({ view: board, groupByColumnId: "COL-status", cardFields: [] });
  });

  it("opens a default kanban view when none is requested, and the grid when asked", () => {
    const defBoard = { ...board, isDefault: true };
    expect(resolveBoardView([defBoard], undefined, COLUMNS)?.view.viewId).toBe("VW-board");
    expect(resolveBoardView([defBoard], "grid", COLUMNS)).toBeNull();
  });

  it("falls back to the grid for a grid view, an unknown id or a stale group-by column", () => {
    expect(resolveBoardView([grid, board], "VW-grid", COLUMNS)).toBeNull();
    expect(resolveBoardView([grid, board], "VW-missing", COLUMNS)).toBeNull();
    const stale = { ...board, config: { kanban: { groupByColumnId: "COL-deleted", cardFields: [] } } };
    expect(resolveBoardView([stale], "VW-board", COLUMNS)).toBeNull();
  });
});
