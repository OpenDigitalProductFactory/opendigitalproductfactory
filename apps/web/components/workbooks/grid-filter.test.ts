import { describe, it, expect } from "vitest";
import { cellSearchText, quickFilterRows } from "./grid-filter";
import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";

const col = (columnId: string): ColumnDefinition => ({
  columnId,
  name: columnId,
  fieldType: "text",
  position: 0,
  required: false,
  editable: true,
});

describe("cellSearchText", () => {
  it("stringifies each cell shape for matching", () => {
    expect(cellSearchText(null)).toBe("");
    expect(cellSearchText(42)).toBe("42");
    expect(cellSearchText(true)).toBe("true");
    expect(cellSearchText(["a", "b"])).toBe("a b");
    expect(cellSearchText({ referenceId: "EP-1", referenceType: "epic", label: "Grid epic" })).toBe(
      "Grid epic",
    );
    expect(cellSearchText({ referenceId: "EP-2", referenceType: "epic" })).toBe("EP-2");
  });
});

describe("quickFilterRows", () => {
  const columns = [col("name"), col("status"), col("epic")];
  const rows: GridRowData[] = [
    { rowId: "r1", name: "Alpha", status: "open", epic: { referenceId: "EP-1", referenceType: "epic", label: "Launch" } },
    { rowId: "r2", name: "Beta", status: "done", epic: null },
    { rowId: "r3", name: "Gamma", status: "open", epic: { referenceId: "EP-2", referenceType: "epic", label: "Migrate" } },
  ];

  it("returns all rows for an empty query", () => {
    expect(quickFilterRows(rows, columns, "  ")).toHaveLength(3);
  });

  it("matches case-insensitively across any column", () => {
    expect(quickFilterRows(rows, columns, "ALPHA").map((r) => r.rowId)).toEqual(["r1"]);
    expect(quickFilterRows(rows, columns, "open").map((r) => r.rowId)).toEqual(["r1", "r3"]);
  });

  it("matches against a reference label, not just scalar columns", () => {
    expect(quickFilterRows(rows, columns, "migrate").map((r) => r.rowId)).toEqual(["r3"]);
  });

  it("returns no rows when nothing matches", () => {
    expect(quickFilterRows(rows, columns, "zzz")).toHaveLength(0);
  });
});
