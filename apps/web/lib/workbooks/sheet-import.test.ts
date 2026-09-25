import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  unreadableSheetReason,
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

describe("unreadableSheetReason (BI-65D65EC0)", () => {
  const fixture = (name: string) => readFileSync(resolve(__dirname, "../shared/__fixtures__/office", name));

  it("names a real Excel 97-2003 workbook instead of handing it to the .xlsx reader", () => {
    expect(unreadableSheetReason(fixture("roster.xls"))).toMatch(/Excel 97-2003/);
  });

  it("names a Word file that was offered as a sheet", () => {
    expect(unreadableSheetReason(fixture("plan.docx"))).toMatch(/not a spreadsheet/);
    expect(unreadableSheetReason(fixture("plan.rtf"))).toMatch(/RTF/);
  });

  it("lets an .xlsx and unrecognised bytes through to the reader", () => {
    const xlsxHead = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from("[Content_Types].xml xl/workbook.xml")]);
    expect(unreadableSheetReason(xlsxHead)).toBeNull();
    expect(unreadableSheetReason(Buffer.from("not a zip"))).toBeNull();
  });
});
