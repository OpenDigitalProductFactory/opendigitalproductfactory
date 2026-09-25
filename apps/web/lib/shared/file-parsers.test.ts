import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseCsv, parseFileContent, sniffOfficeContainer } from "./file-parsers";

// Real bytes, saved from Word: an OLE compound file, RTF, OOXML, and the same
// OOXML file carrying a .doc name (BI-65D65EC0).
const fixture = (name: string) => readFileSync(resolve(__dirname, "__fixtures__/office", name));
const legacyDoc = fixture("plan.doc");
const rtf = fixture("plan.rtf");
const docx = fixture("plan.docx");
const docxNamedDoc = fixture("plan-docx-renamed.doc");

// A minimal ODF package: the uncompressed `mimetype` entry comes first.
function odfBytes(): Buffer {
  const name = Buffer.from("mimetype", "latin1");
  const body = Buffer.from("application/vnd.oasis.opendocument.text", "latin1");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, body]);
}

vi.mock("read-excel-file/browser", () => ({
  readSheet: vi.fn(async () => [
    ["Name", "Score"],
    ["Alice", 10],
    ["Bob", 20],
  ]),
}));

describe("parseCsv", () => {
  it("extracts columns and sample rows", () => {
    const csv = "Name,Email,Course\nAlice,a@test.com,Math\nBob,b@test.com,Science\n";
    const result = parseCsv(Buffer.from(csv));
    expect(result.type).toBe("spreadsheet");
    expect(result.columns).toEqual(["Name", "Email", "Course"]);
    expect(result.sampleRows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.summary).toContain("3 columns");
  });
  it("handles empty CSV", () => {
    const result = parseCsv(Buffer.from(""));
    expect(result.columns).toEqual([]);
    expect(result.rowCount).toBe(0);
  });
  it("truncates columns at 200", () => {
    const headers = Array.from({ length: 250 }, (_, i) => `col${i}`).join(",");
    const result = parseCsv(Buffer.from(headers + "\n"));
    expect(result.columns!.length).toBeLessThanOrEqual(200);
  });
  it("truncates cell values at 200 chars", () => {
    const longVal = "x".repeat(300);
    const result = parseCsv(Buffer.from(`Name\n${longVal}\n`));
    expect(result.sampleRows![0]![0]!.length).toBeLessThanOrEqual(200);
  });
});

describe("parseFileContent", () => {
  it("routes CSV by mime type", async () => {
    const result = await parseFileContent(Buffer.from("A,B\n1,2\n"), "text/csv", "test.csv");
    if (result?.type !== "spreadsheet") throw new Error("expected spreadsheet");
    expect(result.columns).toEqual(["A", "B"]);
  });

  it("parses xlsx files into spreadsheet summaries", async () => {
    const result = await parseFileContent(Buffer.from("xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "test.xlsx");
    if (result?.type !== "spreadsheet") throw new Error("expected spreadsheet");
    expect(result.columns).toEqual(["Name", "Score"]);
    expect(result.sampleRows).toEqual([
      ["Alice", "10"],
      ["Bob", "20"],
    ]);
    expect(result.rowCount).toBe(2);
  });

  it("rejects legacy xls uploads", async () => {
    const result = await parseFileContent(Buffer.from("legacy"), "application/vnd.ms-excel", "test.xls");
    expect(result).toBeNull();
  });

  it("returns null for unsupported type", async () => {
    const result = await parseFileContent(Buffer.from("hello"), "application/octet-stream", "test.bin");
    expect(result).toBeNull();
  });

  it("parses plain text files as documents", async () => {
    const result = await parseFileContent(Buffer.from("hello"), "text/plain", "test.txt");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("document");
  });
});

describe("sniffOfficeContainer", () => {
  it("reads the container from the bytes, not the name", () => {
    expect(sniffOfficeContainer(legacyDoc)).toEqual({ kind: "ole", format: "legacy-word" });
    expect(sniffOfficeContainer(rtf)).toEqual({ kind: "rtf" });
    expect(sniffOfficeContainer(fixture("roster.xls"))).toEqual({ kind: "ole", format: "legacy-excel" });
    expect(sniffOfficeContainer(docx)).toEqual({ kind: "ooxml", part: "word" });
    expect(sniffOfficeContainer(docxNamedDoc)).toEqual({ kind: "ooxml", part: "word" });
    expect(sniffOfficeContainer(odfBytes())).toEqual({ kind: "odf" });
    expect(sniffOfficeContainer(Buffer.from("hello"))).toEqual({ kind: "unknown" });
  });
});

describe("parseFileContent office formats (BI-65D65EC0)", () => {
  it("returns an unsupported result for a real Word 97-2003 file instead of calling mammoth", async () => {
    const result = await parseFileContent(legacyDoc, "application/msword", "plan.doc");
    expect(result).toMatchObject({ type: "unsupported", format: "legacy-word" });
    if (result?.type !== "unsupported") throw new Error("expected unsupported");
    expect(result.reason).toMatch(/Word 97-2003/);
    expect(result.summary).toBe(result.reason);
  });

  it("never stores RTF control words as document text", async () => {
    for (const [mime, name] of [["application/rtf", "plan.rtf"], ["text/rtf", "plan.rtf"], ["text/plain", "notes.txt"]] as const) {
      const result = await parseFileContent(rtf, mime, name);
      expect(result).toMatchObject({ type: "unsupported", format: "rtf" });
      expect(JSON.stringify(result)).not.toContain("\\rtf");
    }
  });

  it("returns an unsupported result for an OpenDocument file", async () => {
    const result = await parseFileContent(odfBytes(), "application/vnd.oasis.opendocument.text", "plan.odt");
    expect(result).toMatchObject({ type: "unsupported", format: "opendocument" });
  });

  it("parses a real .docx", async () => {
    const result = await parseFileContent(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "plan.docx");
    expect(result).toMatchObject({ type: "document" });
    if (result?.type !== "document") throw new Error("expected document");
    expect(result.fullText).toContain("Second Chance fosters twelve dogs this quarter.");
  });

  it("parses a .docx that carries a .doc name (the bytes win)", async () => {
    const result = await parseFileContent(docxNamedDoc, "application/msword", "plan.doc");
    expect(result).toMatchObject({ type: "document" });
    if (result?.type !== "document") throw new Error("expected document");
    expect(result.fullText).toContain("Rescue operations plan");
  });
});
