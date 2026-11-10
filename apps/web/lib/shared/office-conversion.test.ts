// Engine-backed ingestion routing (BI-81524041, slice S3, and BI-D1B40D43,
// slice S9 of BI-815D40C6).
//
// One routing test per family, each with a fake converter: the format routing
// table sends every Word-family file (.docx included) to .odt, every sheet
// (.xlsx included) to .ods, every presentation and every PDF to plain text,
// and DPF's own OpenDocument reader reads the result. With no converter, the
// honest `unsupported` result stays.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConversionResult } from "@/lib/documents/conversion/convert";
import { parseFileContent, sniffOfficeContainer, type ConvertForIngestion } from "./file-parsers";
import { conversionRouteFor } from "./office-conversion";
import { CHART_OBJECT_PARTS, odfPackage, odsWithRows, odtWithBody } from "./__fixtures__/odf-package";
import { readSheetMatrix } from "@/lib/workbooks/sheet-import";

const fixture = (name: string) => readFileSync(resolve(__dirname, "__fixtures__/office", name));
const legacyDoc = fixture("plan.doc");
const rtf = fixture("plan.rtf");
const docx = fixture("plan.docx");
const legacyXls = fixture("roster.xls");
const xlsxBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from("[Content_Types].xml xl/workbook.xml", "latin1")]);
const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", "latin1");

/** What the engine returns for the plan document: a heading and one paragraph. */
const PLAN_ODT = odtWithBody('<text:h text:outline-level="1">Rescue operations plan</text:h><text:p>Second Chance fosters twelve dogs this quarter.</text:p>');
const ROSTER_ODS = odsWithRows([["Name", "Breed"], ["Biscuit", "Beagle"]]);

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
function fakeConverter(outputs: Partial<Record<"odt" | "ods" | "txt", Buffer>>): { convert: ConvertForIngestion; calls: Call[] } {
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

  it("sends .docx, legacy Word, RTF and OpenDocument text to .odt", () => {
    expect(route(docx, "plan.docx")).toEqual({ family: "word", from: "docx", to: "odt", fallback: "word-document" });
    expect(route(legacyDoc, "plan.doc")).toEqual({ family: "word", from: "doc", to: "odt", fallback: "legacy-word" });
    expect(route(rtf, "plan.rtf")).toEqual({ family: "word", from: "rtf", to: "odt", fallback: "rtf" });
    expect(route(odfBytes("text"), "plan.odt")).toEqual({ family: "word", from: "odt", to: "odt", fallback: "opendocument" });
  });

  it("sends .xlsx, legacy Excel and OpenDocument spreadsheets to .ods", () => {
    expect(route(xlsxBytes, "roster.xlsx")).toEqual({ family: "sheet", from: "xlsx", to: "ods", fallback: "workbook" });
    expect(route(legacyXls, "roster.xls")).toEqual({ family: "sheet", from: "xls", to: "ods", fallback: "legacy-excel" });
    expect(route(odfBytes("spreadsheet"), "roster.ods")).toEqual({ family: "sheet", from: "ods", to: "ods", fallback: "opendocument" });
  });

  it("sends a PDF to plain text, by its bytes whatever its name", () => {
    expect(route(pdfBytes, "scan.bin")).toEqual({ family: "pdf", from: "pdf", to: "txt", fallback: "pdf" });
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

  it("leaves text formats, drawings and unknown bytes alone", () => {
    expect(route(odfBytes("graphics"), "drawing.odg")).toBeNull();
    expect(route(Buffer.from("hello"), "notes.txt")).toBeNull();
  });
});

describe("parseFileContent converts once, then reads the OpenDocument result", () => {
  it("word family: a legacy .doc converts to .odt and keeps its headings", async () => {
    const { convert, calls } = fakeConverter({ odt: PLAN_ODT });
    const result = await parseFileContent(legacyDoc, "application/msword", "plan.doc", { convert });
    expect(calls).toEqual([{ from: "doc", to: "odt" }]);
    if (result?.type !== "document") throw new Error(`expected document, got ${JSON.stringify(result)}`);
    expect(result.fullText).toContain("Second Chance fosters twelve dogs this quarter.");
    expect(result.sections).toEqual([{ heading: "Rescue operations plan", text: "" }]);
  });

  it("word family: .docx, RTF and OpenDocument text convert the same way", async () => {
    for (const [bytes, name, from] of [[docx, "plan.docx", "docx"], [rtf, "plan.rtf", "rtf"], [odfBytes("text"), "plan.odt", "odt"]] as const) {
      const { convert, calls } = fakeConverter({ odt: PLAN_ODT });
      const result = await parseFileContent(bytes, "", name, { convert });
      expect(calls).toEqual([{ from, to: "odt" }]);
      expect(result).toMatchObject({ type: "document", summary: "1 section, 71 characters" });
    }
  });

  it("sheet family: .xlsx, a legacy .xls and an .ods convert to .ods and the sheet reader reads them", async () => {
    for (const [bytes, name, from] of [[xlsxBytes, "roster.xlsx", "xlsx"], [legacyXls, "roster.xls", "xls"], [odfBytes("spreadsheet"), "roster.ods", "ods"]] as const) {
      const { convert, calls } = fakeConverter({ ods: ROSTER_ODS });
      const result = await parseFileContent(bytes, "application/vnd.ms-excel", name, { convert });
      expect(calls).toEqual([{ from, to: "ods" }]);
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

  it("pdf: converts to text in the engine and counts its pages", async () => {
    const { convert, calls } = fakeConverter({ txt: Buffer.from("Adoption day\fMeet the dogs\n\f", "utf8") });
    const result = await parseFileContent(pdfBytes, "application/pdf", "flyer.pdf", { convert });
    expect(calls).toEqual([{ from: "pdf", to: "txt" }]);
    expect(result).toEqual({ type: "document", summary: "2 pages, 27 characters", fullText: "Adoption day\n\nMeet the dogs" });
  });

  it("routes a damaged .docx, .xlsx or .pdf by its name, and the engine's refusal is named plainly", async () => {
    for (const [name, mime, from, to] of [
      ["plan.docx", "", "docx", "odt"],
      ["roster.xlsx", "", "xlsx", "ods"],
      ["flyer", "application/pdf", "pdf", "txt"],
    ] as const) {
      const { convert, calls } = fakeConverter({});
      const result = await parseFileContent(Buffer.from("damaged"), mime, name, { convert });
      expect(calls).toEqual([{ from, to }]);
      expect(result).toMatchObject({ type: "unsupported" });
      if (result?.type !== "unsupported") throw new Error("expected unsupported");
      expect(result.reason).toMatch(/could not convert this file; it may be damaged or password-protected/);
    }
  });

  it("does not call the converter for CSV or plain text", async () => {
    const { convert, calls } = fakeConverter({});
    await parseFileContent(Buffer.from("A,B\n1,2\n"), "text/csv", "t.csv", { convert });
    await parseFileContent(Buffer.from("hello"), "text/plain", "notes.txt", { convert });
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
      [docx, "plan.docx", "word-document", /Word document \(\.docx\)/],
      [xlsxBytes, "roster.xlsx", "workbook", /Excel workbook \(\.xlsx\)/],
      [pdfBytes, "flyer.pdf", "pdf", /This is a PDF/],
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

  it("tells the person when the converter refuses an OpenDocument file that embeds a chart (BI-BFF142A1)", async () => {
    const cases = [
      ["text", "report.odt", "application/vnd.oasis.opendocument.text"],
      ["spreadsheet", "budget.ods", "application/vnd.oasis.opendocument.spreadsheet"],
      ["presentation", "deck.odp", "application/vnd.oasis.opendocument.presentation"],
    ] as const;
    for (const [flavor, name, mime] of cases) {
      const { convert, calls } = fakeConverter({});
      const result = await parseFileContent(odfPackage(flavor, CHART_OBJECT_PARTS), mime, name, { convert });
      expect(calls).toHaveLength(1);
      expect(result).toMatchObject({ type: "unsupported", format: "opendocument" });
      if (result?.type !== "unsupported") throw new Error("expected unsupported");
      expect(result.reason).toContain("contains embedded objects (such as charts) that DPF does not open");
      expect(result.reason).not.toContain("damaged");
    }
    const sheet = await readSheetMatrix(odfPackage("spreadsheet", CHART_OBJECT_PARTS), "budget.ods", { convert: fakeConverter({}).convert });
    expect(sheet).toMatchObject({ ok: false });
    if (!sheet.ok) expect(sheet.error).toContain("embedded objects (such as charts)");
  });

  it("reads an OpenDocument file with a chart when the converter accepts it, and keeps the generic reason without embedded objects", async () => {
    const accepted = fakeConverter({ ods: ROSTER_ODS });
    const read = await parseFileContent(odfPackage("spreadsheet", CHART_OBJECT_PARTS), "", "budget.ods", { convert: accepted.convert });
    expect(accepted.calls).toEqual([{ from: "ods", to: "ods" }]);
    expect(read?.type).not.toBe("unsupported");

    const refused = await parseFileContent(odfPackage("spreadsheet"), "", "budget.ods", { convert: fakeConverter({}).convert });
    if (refused?.type !== "unsupported") throw new Error("expected unsupported");
    expect(refused.reason).toContain("damaged or password-protected");
    const timedOut = await parseFileContent(odfPackage("spreadsheet", CHART_OBJECT_PARTS), "", "budget.ods", { convert: failing("timeout") });
    if (timedOut?.type !== "unsupported") throw new Error("expected unsupported");
    expect(timedOut.reason).toContain("took too long");
  });

  it("reports a converter that returns bytes the parser cannot read, instead of throwing", async () => {
    const { convert } = fakeConverter({ odt: Buffer.from("not an odt") });
    const result = await parseFileContent(legacyDoc, "application/msword", "plan.doc", { convert });
    expect(result).toMatchObject({ type: "unsupported", format: "legacy-word" });
  });
});
