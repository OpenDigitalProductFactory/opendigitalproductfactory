import { describe, it, expect } from "vitest";
import { gridRegistry, type DataSourceAdapter } from "../adapter";
import { computeDerivedCells, type DerivableColumn } from "./compute";
import type { GridRow } from "../types";

describe("computeDerivedCells — formulas", () => {
  it("computes a formula over base columns and coerces the result type", async () => {
    const columns: DerivableColumn[] = [
      { columnId: "c_price", name: "Price", fieldType: "number" },
      { columnId: "c_qty", name: "Qty", fieldType: "number" },
      {
        columnId: "c_total",
        name: "Total",
        fieldType: "formula",
        config: { formula: "=Price * Qty", resultType: "number" },
      },
    ];
    const rows: GridRow[] = [{ rowId: "r1", cells: { c_price: 4, c_qty: 3, c_total: null } }];
    await computeDerivedCells(columns, rows);
    expect(rows[0].cells.c_total).toBe(12);
  });

  it("lets a later formula reference an earlier formula (position order)", async () => {
    const columns: DerivableColumn[] = [
      { columnId: "c_a", name: "A", fieldType: "number" },
      { columnId: "c_d", name: "Double", fieldType: "formula", config: { formula: "=A*2", resultType: "number" } },
      { columnId: "c_q", name: "Quad", fieldType: "formula", config: { formula: "=Double*2", resultType: "number" } },
    ];
    const rows: GridRow[] = [{ rowId: "r1", cells: { c_a: 5, c_d: null, c_q: null } }];
    await computeDerivedCells(columns, rows);
    expect(rows[0].cells.c_d).toBe(10);
    expect(rows[0].cells.c_q).toBe(20);
  });

  it("writes a #ERROR sentinel for a broken formula instead of throwing", async () => {
    const columns: DerivableColumn[] = [
      { columnId: "c_a", name: "A", fieldType: "number" },
      { columnId: "c_x", name: "X", fieldType: "formula", config: { formula: "=A/0" } },
    ];
    const rows: GridRow[] = [{ rowId: "r1", cells: { c_a: 1, c_x: null } }];
    await computeDerivedCells(columns, rows);
    expect(String(rows[0].cells.c_x)).toMatch(/^#ERROR/);
  });

  it("is a no-op when there are no computed columns", async () => {
    const columns: DerivableColumn[] = [{ columnId: "c_a", name: "A", fieldType: "number" }];
    const rows: GridRow[] = [{ rowId: "r1", cells: { c_a: 1 } }];
    await computeDerivedCells(columns, rows);
    expect(rows[0].cells.c_a).toBe(1);
  });

  it("resolves a cross-row SUMIF over the whole table on every row", async () => {
    const columns: DerivableColumn[] = [
      { columnId: "c_status", name: "Status", fieldType: "select" },
      { columnId: "c_hours", name: "Hours", fieldType: "number" },
      {
        columnId: "c_done",
        name: "DoneHours",
        fieldType: "formula",
        config: { formula: '=SUMIF([Status],"done",[Hours])', resultType: "number" },
      },
    ];
    const rows: GridRow[] = [
      { rowId: "r1", cells: { c_status: "done", c_hours: 3, c_done: null } },
      { rowId: "r2", cells: { c_status: "open", c_hours: 5, c_done: null } },
      { rowId: "r3", cells: { c_status: "done", c_hours: 2, c_done: null } },
    ];
    await computeDerivedCells(columns, rows);
    // Same dataset-wide total on every row (3 + 2 = 5).
    expect(rows.map((r) => r.cells.c_done)).toEqual([5, 5, 5]);
  });
});

describe("computeDerivedCells — lookups", () => {
  it("pulls a field from the referenced record via the registry", async () => {
    const adapter = {
      entityType: "fake_lookup_epic",
      getColumns: async () => [],
      queryRows: async () => ({ data: [], nextCursor: null }),
      getRow: async (_t: string, id: string) =>
        id === "EP-1" ? { rowId: "EP-1", cells: { status: "open", title: "Alpha" } } : null,
      getCapabilities: () => ({ canAddRow: false, canAddColumn: false, canEditCell: false, canDeleteRow: false }),
    } as unknown as DataSourceAdapter;
    gridRegistry.register(adapter);

    const columns: DerivableColumn[] = [
      { columnId: "c_epic", name: "Epic", fieldType: "reference", config: { referenceType: "fake_lookup_epic" } },
      {
        columnId: "c_epicstatus",
        name: "Epic Status",
        fieldType: "lookup",
        config: { lookup: { referenceColumnId: "c_epic", targetField: "status" } },
      },
    ];
    const rows: GridRow[] = [
      {
        rowId: "r1",
        cells: {
          c_epic: { referenceId: "EP-1", referenceType: "fake_lookup_epic", label: "Alpha" },
          c_epicstatus: null,
        },
      },
      { rowId: "r2", cells: { c_epic: null, c_epicstatus: null } },
    ];
    await computeDerivedCells(columns, rows);
    expect(rows[0].cells.c_epicstatus).toBe("open");
    expect(rows[1].cells.c_epicstatus).toBeNull();
  });

  it("makes a lookup value available to a downstream formula", async () => {
    const adapter = {
      entityType: "fake_lookup_prod",
      getColumns: async () => [],
      queryRows: async () => ({ data: [], nextCursor: null }),
      getRow: async (_t: string, id: string) =>
        id === "P-1" ? { rowId: "P-1", cells: { name: "Widget" } } : null,
      getCapabilities: () => ({ canAddRow: false, canAddColumn: false, canEditCell: false, canDeleteRow: false }),
    } as unknown as DataSourceAdapter;
    gridRegistry.register(adapter);

    const columns: DerivableColumn[] = [
      { columnId: "c_p", name: "Product", fieldType: "reference", config: { referenceType: "fake_lookup_prod" } },
      {
        columnId: "c_pn",
        name: "ProdName",
        fieldType: "lookup",
        config: { lookup: { referenceColumnId: "c_p", targetField: "name" } },
      },
      { columnId: "c_label", name: "Label", fieldType: "formula", config: { formula: '=UPPER(ProdName)' } },
    ];
    const rows: GridRow[] = [
      {
        rowId: "r1",
        cells: {
          c_p: { referenceId: "P-1", referenceType: "fake_lookup_prod", label: "Widget" },
          c_pn: null,
          c_label: null,
        },
      },
    ];
    await computeDerivedCells(columns, rows);
    expect(rows[0].cells.c_pn).toBe("Widget");
    expect(rows[0].cells.c_label).toBe("WIDGET");
  });
});
