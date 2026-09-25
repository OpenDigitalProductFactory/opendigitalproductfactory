// Converter-backed ingestion routing (BI-81524041, slice S3 of BI-815D40C6).
//
// One routing test per family, each with a fake converter: the format routing
// table sends legacy Word, RTF and OpenDocument text to .docx, legacy Excel and
// OpenDocument spreadsheets to .xlsx, and every presentation to plain text,
// then the existing parser reads the result. With no converter, S0's honest
// `unsupported` result stays.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ConversionResult } from "@/lib/documents/conversion/convert";
import { parseFileContent, sniffOfficeContainer, type ConvertForIngestion } from "./file-parsers";
import { conversionRouteFor } from "./office-conversion";

const fixture = (name: string) => readFileSync(resolve(__dirname, "__fixtures__/office", name));
const legacyDoc = fixture("plan.doc");
const rtf = fixture("plan.rtf");
const docx = fixture("plan.docx");
const legacyXls = fixture("roster.xls");

vi.mock("read-excel-file/universal", () => ({
  readSheet: vi.fn(async () => [
    ["Name", "Breed"],
    ["Biscuit", "Beagle"],
  ]),
}));

function odfBytes(flavor: "text" | "spreadsheet" | "presentation" | "graphics"): Buffer {
  const name = Buffer.from("mimetype", "latin1");
  const body = Buffer.from(`application/vnd.oasis.opendocument.${flavor}`, "latin1");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, body]);
}

function oleBytes(stream: string | null): Buffer {
  const magic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return Buffer.concat([magic, Buffer.alloc(504), stream ? Buffer.from(stream, "utf16le") : Buffer.alloc(0)]);
}

const pptxBytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(26),
  Buffer.from("[Content_Types].xml ppt/presentation.xml", "latin1"),
]);

type Call = { from: string; to: string };
function fakeConverter(outputs: Partial<Record<"docx" | "xlsx" | "txt", Buffer>>): { convert: ConvertForIngestion; calls: Call[] } {
  const calls: Call[] = [];
  const convert: ConvertForIngestion = async ({ from, to }) => {
    calls.push({ from, to });
    const bytes = outputs[to];
    if (!bytes) return { ok: false, error: `no fake output for ${to}`, reason: "conversion-failed" };
    return { ok: true, data: { bytes, mime: "application/octet-stream" } };
  };
  return { convert, calls };
}

const failing = (reason: "converter-unavailable" | "input-too-large" | "timeout" | "conversion-failed"): ConvertForIngestion =>
  async (): Promise<ConversionResult> => ({ ok: false, error: `technical detail: ${reason}`, reason });

describe("conversionRouteFor: the format routing table", () => {
  const route = (bytes: Buffer, name: string) => conversionRouteFor(sniffOfficeContainer(bytes), bytes, name);

  it("sends legacy Word, RTF and OpenDocument text to .docx", () => {
    expect(route(legacyDoc, "plan.doc")).toEqual({ family: "word", from: "doc", to: "docx", fallback: "legacy-word" });
    expect(route(rtf, "plan.rtf")).toEqual({ family: "word", from: "rtf", to: "docx", fallback: "rtf" });
    expect(route(odfBytes("text"), "plan.odt")).toEqual({ family: "word", from: "odt", to: "docx", fallback: "opendocument" });
  });

  it("sends legacy Excel and OpenDocument spreadsheets to .xlsx", () => {
    expect(route(legacyXls, "roster.xls")).toEqual({ family: "sheet", from: "xls", to: "xlsx", fallback: "legacy-excel" });
    expect(route(odfBytes("spreadsheet"), "roster.ods")).toEqual({ family: "sheet", from: "ods", to: "xlsx", fallback: "opendocument" });
  });

  it("sends every presentation format to plain text", () => {
    expect(route(oleBytes("PowerPoint Document"), "deck.ppt")).toEqual({ family: "slides", from: "ppt", to: "txt", fallback: "legacy-powerpoint" });
    expect(route(pptxBytes, "deck.pptx")).toEqual({ family: "slides", from: "pptx", to: "txt", fallback: "presentation" });
    expect(route(odfBytes("presentation"), "deck.odp")).toEqual({ family: "slides", from: "odp", to: "txt", fallback: "opendocument" });
  });

  it("uses the name only when an OLE file does not name its application", () => {
    expect(route(oleBytes(null), "old.xls")).toMatchObject({ family: "sheet", from: "xls" });
    expect(route(oleBytes(null), "mystery.bin")).toBeNull();
  });

  it("leaves formats an existing parser already reads, and unknown bytes, alone", () => {
    expect(route(docx, "plan.docx")).toBeNull();
    expect(route(odfBytes("graphics"), "drawing.odg")).toBeNull();
    expect(route(Buffer.from("hello"), "notes.txt")).toBeNull();
  });
});

describe("parseFileContent converts, then parses with the existing parsers", () => {
  it("word family: a legacy .doc converts to .docx and mammoth reads it", async () => {
    const { convert, calls } = fakeConverter({ docx });
    const result = await parseFileContent(legacyDoc, "application/msword", "plan.doc", { convert });
    expect(calls).toEqual([{ from: "doc", to: "docx" }]);
    if (result?.type !== "document") throw new Error(`expected document, got ${JSON.stringify(result)}`);
    expect(result.fullText).toContain("Second Chance fosters twelve dogs this quarter.");
  });

  it("word family: RTF and OpenDocument text convert the same way", async () => {
    for (const [bytes, name, from] of [[rtf, "plan.rtf", "rtf"], [odfBytes("text"), "plan.odt", "odt"]] as const) {
      const { convert, calls } = fakeConverter({ docx });
      const result = await parseFileContent(bytes, "", name, { convert });
      expect(calls).toEqual([{ from, to: "docx" }]);
      expect(result).toMatchObject({ type: "document" });
    }
  });

  it("sheet family: a legacy .xls and an .ods convert to .xlsx and the sheet reader reads them", async () => {
    for (const [bytes, name, from] of [[legacyXls, "roster.xls", "xls"], [odfBytes("spreadsheet"), "roster.ods", "ods"]] as const) {
      const { convert, calls } = fakeConverter({ xlsx: Buffer.from("converted xlsx") });
      const result = await parseFileContent(bytes, "application/vnd.ms-excel", name, { convert });
      expect(calls).toEqual([{ from, to: "xlsx" }]);
      if (result?.type !== "spreadsheet") throw new Error("expected spreadsheet");
      expect(result.columns).toEqual(["Name", "Breed"]);
      expect(result.rowCount).toBe(1);
    }
  });

  it("slides family: .ppt, .pptx and .odp convert to their slide text", async () => {
    for (const [bytes, name, from] of [
      [oleBytes("PowerPoint Document"), "deck.ppt", "ppt"],
      [pptxBytes, "deck.pptx", "pptx"],
      [odfBytes("presentation"), "deck.odp", "odp"],
    ] as const) {
      const { convert, calls } = fakeConverter({ txt: Buffer.from("Adoption day\nMeet the dogs") });
      const result = await parseFileContent(bytes, "", name, { convert });
      expect(calls).toEqual([{ from, to: "txt" }]);
      if (result?.type !== "document") throw new Error("expected document");
      expect(result.fullText).toBe("Adoption day\nMeet the dogs");
    }
  });

  it("does not call the converter for a format an existing parser reads", async () => {
    const { convert, calls } = fakeConverter({});
    await parseFileContent(docx, "", "plan.docx", { convert });
    await parseFileContent(Buffer.from("A,B\n1,2\n"), "text/csv", "t.csv", { convert });
    expect(calls).toEqual([]);
  });
});

describe("parseFileContent without a converter keeps S0's honest result", () => {
  it("returns the S0 unsupported reason for every family when the converter is unavailable", async () => {
    const convert = failing("converter-unavailable");
    const cases = [
      [legacyDoc, "plan.doc", "legacy-word", /Word 97-2003/],
      [rtf, "plan.rtf", "rtf", /Rich Text/],
      [legacyXls, "roster.xls", "legacy-excel", /Excel 97-2003/],
      [odfBytes("spreadsheet"), "roster.ods", "opendocument", /OpenDocument/],
      [pptxBytes, "deck.pptx", "presentation", /PowerPoint/],
    ] as const;
    for (const [bytes, name, format, reason] of cases) {
      const result = await parseFileContent(bytes, "", name, { convert });
      expect(result).toMatchObject({ type: "unsupported", format });
      if (result?.type !== "unsupported") throw new Error("expected unsupported");
      expect(result.reason).toMatch(reason);
      expect(result.reason).not.toContain("technical detail");
    }
  });

  it("names the failure in plain language when a conversion fails for another reason", async () => {
    const expected = {
      "input-too-large": /larger than the document converter accepts/,
      timeout: /took too long/,
      "conversion-failed": /damaged or password-protected/,
    } as const;
    for (const [reason, text] of Object.entries(expected) as [keyof typeof expected, RegExp][]) {
      const result = await parseFileContent(legacyDoc, "application/msword", "plan.doc", { convert: failing(reason) });
      expect(result).toMatchObject({ type: "unsupported", format: "legacy-word" });
      if (result?.type !== "unsupported") throw new Error("expected unsupported");
      expect(result.reason).toMatch(text);
      expect(result.summary).toBe(result.reason);
    }
  });

  it("reports a converter that returns bytes the parser cannot read, instead of throwing", async () => {
    const { convert } = fakeConverter({ docx: Buffer.from("not a docx") });
    const result = await parseFileContent(legacyDoc, "application/msword", "plan.doc", { convert });
    expect(result).toMatchObject({ type: "unsupported", format: "legacy-word" });
  });
});
