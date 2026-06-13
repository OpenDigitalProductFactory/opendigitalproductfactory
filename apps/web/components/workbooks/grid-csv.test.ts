import { describe, it, expect } from "vitest";
import { escapeCsvField, rowsToCsv } from "./grid-csv";
import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";

const col = (columnId: string, name: string): ColumnDefinition => ({
  columnId,
  name,
  fieldType: "text",
  position: 0,
  required: false,
  editable: true,
});

describe("escapeCsvField", () => {
  it("leaves plain values untouched", () => {
    expect(escapeCsvField("hello")).toBe("hello");
  });
  it("quotes and doubles interior quotes when needed", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("rowsToCsv", () => {
  const columns = [col("name", "Name"), col("status", "Status"), col("epic", "Epic")];

  it("emits a header row then one row per record", () => {
    const rows: GridRowData[] = [
      { rowId: "r1", name: "Alpha", status: "open", epic: { referenceId: "EP-1", referenceType: "epic", label: "Launch" } },
    ];
    expect(rowsToCsv(columns, rows)).toBe("Name,Status,Epic\r\nAlpha,open,Launch");
  });

  it("escapes commas and quotes in values, renders empty cells blank", () => {
    const rows: GridRowData[] = [{ rowId: "r1", name: 'Acme, Inc "HQ"', status: null, epic: null }];
    expect(rowsToCsv(columns, rows)).toBe('Name,Status,Epic\r\n"Acme, Inc ""HQ""",,');
  });

  it("emits just the header for no rows", () => {
    expect(rowsToCsv(columns, [])).toBe("Name,Status,Epic");
  });
});
