import { describe, it, expect } from "vitest";
import readXlsxFile from "read-excel-file/node";
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

// read-excel-file@9 returns `[{ sheet, data }]`; unwrap to the row matrix.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsOf(parsed: any): unknown[][] {
  if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object" && "data" in parsed[0]) {
    return parsed[0].data as unknown[][];
  }
  return parsed as unknown[][];
}

describe("buildXlsx round-trip through read-excel-file", () => {
  it("produces a valid .xlsx that parses back to the same matrix", async () => {
    const matrix: XlsxValue[][] = [
      ["Name", "Age", "City"],
      ["Alice", 30, "London"],
      ["Bob", 25, "Paris"],
    ];
    const bytes = buildXlsx(matrix, { sheetName: "People" });
    const rows = rowsOf(await readXlsxFile(Buffer.from(bytes)));
    expect(rows).toEqual(matrix);
  });

  it("preserves special characters and empty cells through the round-trip", async () => {
    const matrix: XlsxValue[][] = [
      ["Label", "Value"],
      ["a & b <c>", 1],
      ["", 2],
    ];
    const bytes = buildXlsx(matrix);
    const rows = rowsOf(await readXlsxFile(Buffer.from(bytes)));
    expect(rows[0]).toEqual(["Label", "Value"]);
    expect(rows[1]).toEqual(["a & b <c>", 1]);
    expect(rows[2]![1]).toBe(2);
  });
});
