import { describe, it, expect } from "vitest";
import { readZipEntry } from "@/lib/shared/odf-embedded-objects";
import {
  crc32,
  colLetter,
  escapeXml,
  sanitizeSheetName,
  sheetXml,
  buildXlsx,
  type XlsxValue,
} from "./grid-xlsx";

describe("crc32", () => {
  it("matches the canonical CRC-32 of '123456789'", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("colLetter", () => {
  it("maps indices to A1-notation column letters", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(701)).toBe("ZZ");
    expect(colLetter(702)).toBe("AAA");
  });
});

describe("escapeXml", () => {
  it("escapes the five XML entities", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f",
    );
  });
});

describe("sanitizeSheetName", () => {
  it("strips forbidden characters and caps at 31 chars", () => {
    expect(sanitizeSheetName("a/b:c*d?[e]")).toBe("a b c d  e");
    expect(sanitizeSheetName("x".repeat(40)).length).toBe(31);
    expect(sanitizeSheetName("   ")).toBe("Sheet1");
  });
});

describe("sheetXml", () => {
  it("writes numbers as numeric cells and text as inline strings", () => {
    const xml = sheetXml([["Name", "Age"], ["Alice", 30]]);
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c>');
    expect(xml).toContain('<c r="B2"><v>30</v></c>');
  });
  it("emits an empty self-closing cell for null/empty", () => {
    expect(sheetXml([[null]])).toContain('<c r="A1"/>');
  });
});

/** A part of the built package, read the way any ZIP reader would. */
function part(bytes: Uint8Array, name: string): string {
  const entry = readZipEntry(Buffer.from(bytes), name, 1024 * 1024);
  if (!entry) throw new Error(`missing part ${name}`);
  return entry.toString("utf8");
}

// The engine round trip (build → dpf-doctools → the Workbooks import) is in
// grid-xlsx.docker.test.ts; here the package itself is checked (BI-D1B40D43
// retired the in-process .xlsx reader this used to round-trip through).
describe("buildXlsx package", () => {
  it("is a readable ZIP with the workbook, its relationships and the named sheet", () => {
    const bytes = buildXlsx([["Name", "Age"], ["Alice", 30]], { sheetName: "People" });
    expect(part(bytes, "[Content_Types].xml")).toContain("spreadsheetml.sheet.main+xml");
    expect(part(bytes, "xl/workbook.xml")).toContain('<sheet name="People"');
    expect(part(bytes, "xl/_rels/workbook.xml.rels")).toContain('Target="worksheets/sheet1.xml"');
    const sheet = part(bytes, "xl/worksheets/sheet1.xml");
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Alice</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>30</v></c>');
  });

  it("escapes special characters and keeps empty cells in the sheet", () => {
    const sheet = part(buildXlsx([["Label", "Value"], ["a & b <c>", 1], ["", 2]]), "xl/worksheets/sheet1.xml");
    expect(sheet).toContain("a &amp; b &lt;c&gt;");
    expect(sheet).toContain('<c r="B3"><v>2</v></c>');
  });
});
