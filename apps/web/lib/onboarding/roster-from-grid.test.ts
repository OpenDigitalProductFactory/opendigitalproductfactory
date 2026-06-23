import { describe, it, expect } from "vitest";
import { cellToString, mapGridToEmployees } from "./roster-from-grid";
import type { ColumnDefinition, GridRow, FieldType } from "@/lib/workbooks/types";

function col(columnId: string, name: string, fieldType: FieldType = "text"): ColumnDefinition {
  return { columnId, name, fieldType, position: 0, required: false, editable: true };
}

describe("cellToString", () => {
  it("flattens every grid cell variant to a plain string", () => {
    expect(cellToString(null)).toBe("");
    expect(cellToString("Ada")).toBe("Ada");
    expect(cellToString(42)).toBe("42");
    expect(cellToString(true)).toBe("true");
    expect(cellToString(false)).toBe("false");
    // reference cell → display label (falls back to id)
    expect(cellToString({ referenceId: "EMP-1", referenceType: "employee", label: "Ada L" })).toBe("Ada L");
    expect(cellToString({ referenceId: "EMP-1", referenceType: "employee" })).toBe("EMP-1");
    // multi-value cell → joined
    expect(cellToString(["Sales", "East"])).toBe("Sales; East");
  });
});

describe("mapGridToEmployees", () => {
  it("maps an edited grid table to proposed employees via the roster mapper", () => {
    const columns = [col("COL-1", "First Name"), col("COL-2", "Last Name"), col("COL-3", "Work Email")];
    const rows: GridRow[] = [
      { rowId: "ROW-1", cells: { "COL-1": "Ada", "COL-2": "Lovelace", "COL-3": "ada@acme.io" } },
      { rowId: "ROW-2", cells: { "COL-1": "Grace", "COL-2": "Hopper", "COL-3": "grace@navy.mil" } },
    ];
    const res = mapGridToEmployees(columns, rows);
    expect(res.proposed).toHaveLength(2);
    expect(res.proposed[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      workEmail: "ada@acme.io",
    });
  });

  it("tolerates absent cells and a single full-name column", () => {
    const columns = [col("COL-1", "Name"), col("COL-2", "Start Date", "date")];
    const rows: GridRow[] = [{ rowId: "ROW-1", cells: { "COL-1": "Cher" } }]; // COL-2 absent
    const res = mapGridToEmployees(columns, rows);
    expect(res.proposed[0]).toMatchObject({ firstName: "Cher", displayName: "Cher", startDate: null });
  });

  it("detects roles from edited column NAMES (operator can rename headers in the grid)", () => {
    // an operator renamed the email column to 'e-mail' in the grid — still detected
    const columns = [col("COL-1", "Full Name"), col("COL-2", "e-mail")];
    const rows: GridRow[] = [{ rowId: "ROW-1", cells: { "COL-1": "Ada Lovelace", "COL-2": "ada@x.io" } }];
    const res = mapGridToEmployees(columns, rows);
    expect(res.proposed[0]).toMatchObject({ displayName: "Ada Lovelace", workEmail: "ada@x.io" });
  });
});
