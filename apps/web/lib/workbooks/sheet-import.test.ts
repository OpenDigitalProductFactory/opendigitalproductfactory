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
import { odsWithRows } from "../shared/__fixtures__/odf-package";

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

describe("readSheetMatrix: engine-backed sheet import (BI-81524041, BI-D1B40D43)", () => {
  const fixture = (name: string) => readFileSync(resolve(__dirname, "../shared/__fixtures__/office", name));
  const MATRIX = [["Name", "Breed"], ["Biscuit", "Beagle"]];
  const engine = () => vi.fn(async (_request: { from: string; to: string }) => ({ ok: true as const, data: { bytes: odsWithRows(MATRIX), mime: "x" } }));
  const xlsxHead = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from("[Content_Types].xml xl/workbook.xml")]);

  function odsBytes(): Buffer {
    const name = Buffer.from("mimetype", "latin1");
    const body = Buffer.from("application/vnd.oasis.opendocument.spreadsheet", "latin1");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name, body]);
  }

  it("converts .xlsx, a legacy .xls and an .ods to .ods, then reads the first sheet", async () => {
    for (const [bytes, name, from] of [[xlsxHead, "roster.xlsx", "xlsx"], [fixture("roster.xls"), "roster.xls", "xls"], [odsBytes(), "roster.ods", "ods"]] as const) {
      const convert = engine();
      expect(await readSheetMatrix(bytes, name, { convert })).toEqual({ ok: true, data: MATRIX });
      expect(convert).toHaveBeenCalledWith(expect.objectContaining({ from, to: "ods" }));
    }
  });

  it("keeps the typed cells of the engine's sheet", async () => {
    const convert = vi.fn(async () => ({ ok: true as const, data: { bytes: odsWithRows([["Name", "Age"], ["Biscuit", 3]]), mime: "x" } }));
    expect(await readSheetMatrix(xlsxHead, "roster.xlsx", { convert })).toEqual({ ok: true, data: [["Name", "Age"], ["Biscuit", 3]] });
  });

  it("sends a workbook the sniffer cannot place to the engine as .xlsx", async () => {
    const convert = engine();
    expect((await readSheetMatrix(Buffer.from("not a zip"), "roster.xlsx", { convert })).ok).toBe(true);
    expect(convert).toHaveBeenCalledWith(expect.objectContaining({ from: "xlsx", to: "ods" }));
  });

  it("gives a plain-language reason when the converter is unavailable", async () => {
    const convert = vi.fn(async () => ({ ok: false as const, error: "not configured", reason: "converter-unavailable" as const }));
    const legacy = await readSheetMatrix(fixture("roster.xls"), "roster.xls", { convert });
    expect(legacy).toMatchObject({ ok: false, error: expect.stringMatching(/Excel 97-2003/) });
    const current = await readSheetMatrix(xlsxHead, "roster.xlsx", { convert });
    expect(current).toMatchObject({ ok: false, error: expect.stringMatching(/Excel workbook \(\.xlsx\)/) });
  });

  it("refuses a Word file offered as a sheet without calling the converter", async () => {
    const convert = vi.fn();
    const word = await readSheetMatrix(fixture("plan.docx"), "plan.docx", { convert });
    expect(word).toMatchObject({ ok: false, error: expect.stringMatching(/not a spreadsheet/) });
    expect((await readSheetMatrix(fixture("plan.doc"), "plan.doc", { convert })).ok).toBe(false);
    expect(convert).not.toHaveBeenCalled();
  });

  it("names a converted file it cannot read instead of throwing", async () => {
    const convert = vi.fn(async () => ({ ok: true as const, data: { bytes: Buffer.from("not an ods"), mime: "x" } }));
    expect(await readSheetMatrix(xlsxHead, "roster.xlsx", { convert })).toMatchObject({ ok: false, error: expect.stringMatching(/could not read this workbook/) });
  });
});
