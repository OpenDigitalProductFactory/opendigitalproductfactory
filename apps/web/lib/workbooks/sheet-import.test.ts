import { describe, it, expect } from "vitest";
import {
  inferFieldType,
  coerceImportCell,
  uniqueColumnNames,
  inferTableFromSheet,
  type SheetCell,
} from "./sheet-import";

describe("inferFieldType", () => {
  it("detects number, checkbox, date, and falls back to text", () => {
    expect(inferFieldType([1, 2, "3"])).toBe("number");
    expect(inferFieldType([true, false])).toBe("checkbox");
    expect(inferFieldType([new Date("2026-01-01"), new Date("2026-02-01")])).toBe("date");
    expect(inferFieldType(["a", 1])).toBe("text");
    expect(inferFieldType([null, ""])).toBe("text");
  });
});

describe("coerceImportCell", () => {
  it("coerces by field type and blanks to null", () => {
    expect(coerceImportCell("number", "12")).toBe(12);
    expect(coerceImportCell("checkbox", true)).toBe(true);
    expect(coerceImportCell("date", new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01T00:00:00.000Z");
    expect(coerceImportCell("text", 5)).toBe("5");
    expect(coerceImportCell("number", null)).toBeNull();
  });
});

describe("uniqueColumnNames", () => {
  it("fills blanks and de-duplicates", () => {
    expect(uniqueColumnNames(["Name", "", "Name", null])).toEqual(["Name", "Column 2", "Name 2", "Column 4"]);
  });
});

describe("inferTableFromSheet", () => {
  it("builds columns + typed rows from a matrix, skipping empty rows", () => {
    const matrix: SheetCell[][] = [
      ["Name", "Qty", "Active"],
      ["Widget", 10, true],
      ["Gadget", "20", false],
      [null, null, null],
    ];
    const { columns, rows, truncated } = inferTableFromSheet(matrix);
    expect(columns).toEqual([
      { name: "Name", fieldType: "text" },
      { name: "Qty", fieldType: "number" },
      { name: "Active", fieldType: "checkbox" },
    ]);
    expect(rows).toEqual([
      { Name: "Widget", Qty: 10, Active: true },
      { Name: "Gadget", Qty: 20, Active: false },
    ]);
    expect(truncated).toBe(false);
  });

  it("returns an empty table for an empty matrix", () => {
    expect(inferTableFromSheet([])).toEqual({ columns: [], rows: [], truncated: false });
  });
});
