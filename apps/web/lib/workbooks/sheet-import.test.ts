import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  unreadableSheetReason,
  inferFieldType,
  coerceImportCell,
  uniqueColumnNames,
  inferTableFromSheet,
  readSheetMatrix,
  type SheetCell,
} from "./sheet-import";
import { buildXlsx } from "@/components/workbooks/grid-xlsx";

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

describe("readSheetMatrix: converter-backed sheet import (BI-81524041)", () => {
  const fixture = (name: string) => readFileSync(resolve(__dirname, "../shared/__fixtures__/office", name));
  const MATRIX = [["Name", "Breed"], ["Biscuit", "Beagle"]];
  const readSheet = vi.fn(async (_input: ArrayBuffer): Promise<SheetCell[][]> => MATRIX);

  function odsBytes(): Buffer {
    const name = Buffer.from("mimetype", "latin1");
    const body = Buffer.from("application/vnd.oasis.opendocument.spreadsheet", "latin1");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name, body]);
  }

  it("converts a legacy .xls to .xlsx, then reads it with the existing sheet reader", async () => {
    const converted = Buffer.from("converted xlsx");
    const convert = vi.fn(async () => ({ ok: true as const, data: { bytes: converted, mime: "x" } }));
    const result = await readSheetMatrix(fixture("roster.xls"), "roster.xls", { convert, readSheet });
    expect(result).toEqual({ ok: true, data: MATRIX });
    expect(convert).toHaveBeenCalledWith(expect.objectContaining({ from: "xls", to: "xlsx" }));
    expect(Buffer.from(readSheet.mock.calls.at(-1)![0]).toString()).toBe("converted xlsx");
  });

  it("converts an OpenDocument spreadsheet the same way", async () => {
    const convert = vi.fn(async () => ({ ok: true as const, data: { bytes: Buffer.from("x"), mime: "x" } }));
    const result = await readSheetMatrix(odsBytes(), "roster.ods", { convert, readSheet });
    expect(result.ok).toBe(true);
    expect(convert).toHaveBeenCalledWith(expect.objectContaining({ from: "ods", to: "xlsx" }));
  });

  it("keeps S0's plain-language reason when the converter is unavailable", async () => {
    const convert = vi.fn(async () => ({ ok: false as const, error: "not configured", reason: "converter-unavailable" as const }));
    const result = await readSheetMatrix(fixture("roster.xls"), "roster.xls", { convert, readSheet });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toMatch(/Excel 97-2003/);
  });

  it("reads an .xlsx directly and refuses a Word file, without calling the converter", async () => {
    const convert = vi.fn();
    const xlsxHead = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from("[Content_Types].xml xl/workbook.xml")]);
    expect(await readSheetMatrix(xlsxHead, "roster.xlsx", { convert, readSheet })).toEqual({ ok: true, data: MATRIX });
    const word = await readSheetMatrix(fixture("plan.docx"), "plan.docx", { convert, readSheet });
    expect(word).toMatchObject({ ok: false, error: expect.stringMatching(/not a spreadsheet/) });
    expect(convert).not.toHaveBeenCalled();
  });

  it("does not hand a converted Word file to the sheet reader", async () => {
    const convert = vi.fn();
    const result = await readSheetMatrix(fixture("plan.doc"), "plan.doc", { convert, readSheet });
    expect(result.ok).toBe(false);
    expect(convert).not.toHaveBeenCalled();
  });
});

describe("readSheetMatrix with the real .xlsx reader", () => {
  // No reader is injected: this is the code path the import actions run on the
  // server, where there is no DOMParser (read-excel-file/browser needs one).
  it("reads a real .xlsx in Node", async () => {
    const bytes = buildXlsx([["Name", "Breed"], ["Biscuit", "Beagle"]]);
    expect(await readSheetMatrix(bytes, "roster.xlsx")).toEqual({ ok: true, data: [["Name", "Breed"], ["Biscuit", "Beagle"]] });
  });
});
