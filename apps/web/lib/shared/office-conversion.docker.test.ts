// Docker-gated end-to-end test of engine-backed ingestion (BI-81524041,
// AC-ODC-005, and BI-D1B40D43, AC-ODC-011), one case per family. The .docx,
// .xlsx and .pdf cases are the fixtures the retired in-process parsers
// (mammoth, read-excel-file, pdf-parse) used to read, with the same caps.
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker has it. Otherwise every
// case is reported SKIPPED, never passed.
//
// Each legacy/OpenDocument input is produced at test time from the committed
// flat-ODF fixtures by the image itself, as tools/doctools/smoke.sh does, so
// the repository carries no opaque office binary (plan.docx is the real Word
// file S0 committed). The ingestion path then runs with the real converter:
// sniff → route → convert → DPF's OpenDocument reader.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { convertDocument, createConversionLimiter, type ConvertDeps } from "@/lib/documents/conversion/convert";
import type { ConverterTarget } from "@/lib/documents/conversion/formats";
import { readSheetMatrix } from "@/lib/workbooks/sheet-import";
import { parseFileContent, type ConvertForIngestion } from "./file-parsers";

const IMAGE = process.env.DPF_DOCTOOLS_TEST_IMAGE?.trim() ?? "";
const FIXTURES = resolve(__dirname, "../../../../tools/doctools/fixtures");
const OFFICE_FIXTURES = resolve(__dirname, "__fixtures__/office");

function dockerHasImage(image: string): boolean {
  if (!isPinnedImageReference(image)) return false;
  try {
    // ambient-host-guard: allow the docker gate itself; a host without the image reports this suite SKIPPED
    return spawnSync("docker", ["image", "inspect", image], { stdio: "ignore", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

const ready = dockerHasImage(IMAGE);
const deps: ConvertDeps = { resolveImage: async () => ({ status: "pinned", image: IMAGE }), limiter: createConversionLimiter(2) };
const convert: ConvertForIngestion = (request) => convertDocument(request, deps);

async function produceFrom(input: Buffer, from: string, to: ConverterTarget): Promise<Buffer> {
  const out = await convertDocument({ input, from, to }, deps);
  if (!out.ok) throw new Error(`${from} -> ${to} failed: ${out.reason}: ${out.error}`);
  return out.data.bytes;
}

async function produce(fixture: string, from: string, to: ConverterTarget): Promise<Buffer> {
  return produceFrom(readFileSync(resolve(FIXTURES, fixture)), from, to);
}

/** A flat ODS roster: a header, then `rows` data rows of text, number, boolean and date cells (with their formats), 205 columns wide. */
function rosterFods(rows: number): Buffer {
  const text = (value: string) => `<table:table-cell office:value-type="string"><text:p>${value}</text:p></table:table-cell>`;
  const extra = Array.from({ length: 201 }, (_, i) => text(`Extra ${i + 1}`)).join("");
  const header = `<table:table-row>${text("Name")}${text("Age")}${text("Fostered")}${text("Since")}${extra}</table:table-row>`;
  const body = Array.from({ length: rows }, (_, i) =>
    `<table:table-row>${text(`Dog ${i + 1}`)}<table:table-cell office:value-type="float" office:value="${i + 1}"><text:p>${i + 1}</text:p></table:table-cell>` +
      `<table:table-cell table:style-name="ceBool" office:value-type="boolean" office:boolean-value="${i % 2 === 0}"><text:p>${i % 2 === 0 ? "TRUE" : "FALSE"}</text:p></table:table-cell>` +
      `<table:table-cell table:style-name="ceDate" office:value-type="date" office:date-value="2026-09-25"><text:p>2026-09-25</text:p></table:table-cell></table:table-row>`,
  ).join("");
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
      'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" ' +
      'office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:automatic-styles>' +
      '<number:date-style style:name="N1"><number:year number:style="long"/><number:text>-</number:text><number:month number:style="long"/>' +
      '<number:text>-</number:text><number:day number:style="long"/></number:date-style><number:boolean-style style:name="N2"><number:boolean/></number:boolean-style>' +
      '<style:style style:name="ceDate" style:family="table-cell" style:data-style-name="N1"/><style:style style:name="ceBool" style:family="table-cell" style:data-style-name="N2"/>' +
      '</office:automatic-styles><office:body><office:spreadsheet>' +
      `<table:table table:name="Roster">${header}${body}</table:table></office:spreadsheet></office:body></office:document>`,
    "utf8",
  );
}

describe.skipIf(!ready)("converter-backed ingestion against the real dpf-doctools image", () => {
  it("word family: .doc, .rtf and .odt are read through .docx", async () => {
    for (const ext of ["doc", "rtf", "odt"] as const) {
      const bytes = await produce("sample.fodt", "fodt", ext);
      const parsed = await parseFileContent(bytes, "", `plan.${ext}`, { convert });
      if (parsed?.type !== "document") throw new Error(`.${ext}: expected document, got ${JSON.stringify(parsed)}`);
      expect(parsed.fullText).toContain("DPFSENTINELWRITER");
    }
  }, 600_000);

  it("sheet family: .xls and .ods import into a Workbook matrix as .xlsx does", async () => {
    for (const ext of ["xls", "ods"] as const) {
      const bytes = await produce("sample.fods", "fods", ext);
      const sheet = await readSheetMatrix(bytes, `roster.${ext}`, { convert });
      if (!sheet.ok) throw new Error(`.${ext}: ${sheet.error}`);
      expect(sheet.data.flat().map(String)).toContain("DPFSENTINELCALC");
      const parsed = await parseFileContent(bytes, "", `roster.${ext}`, { convert });
      expect(parsed?.type).toBe("spreadsheet");
    }
  }, 600_000);

  it("slides family: .ppt, .pptx and .odp are read as slide text", async () => {
    for (const ext of ["ppt", "pptx", "odp"] as const) {
      const bytes = await produce("sample.fodp", "fodp", ext);
      const parsed = await parseFileContent(bytes, "", `deck.${ext}`, { convert });
      if (parsed?.type !== "document") throw new Error(`.${ext}: expected document, got ${JSON.stringify(parsed)}`);
      expect(parsed.fullText).toContain("DPFSENTINELIMPRESS");
    }
  }, 600_000);

  it("docx: a real Word file keeps its heading and text", async () => {
    const docx = readFileSync(resolve(OFFICE_FIXTURES, "plan.docx"));
    for (const name of ["plan.docx", "plan.doc"]) {
      const parsed = await parseFileContent(docx, "", name, { convert });
      if (parsed?.type !== "document") throw new Error(`${name}: expected document, got ${JSON.stringify(parsed)}`);
      expect(parsed.sections).toEqual([{ heading: "Rescue operations plan", text: "" }]);
      expect(parsed.fullText).toBe("Rescue operations plan\n\nSecond Chance fosters twelve dogs this quarter.");
      expect(parsed.summary).toBe("1 section, 71 characters");
    }
  }, 600_000);

  it("xlsx: columns and sample rows keep the caps (200 columns, 50 sample rows) and the Workbooks import keeps types", async () => {
    const xlsx = await produceFrom(rosterFods(60), "fods", "xlsx");
    const parsed = await parseFileContent(xlsx, "", "roster.xlsx", { convert });
    if (parsed?.type !== "spreadsheet") throw new Error(`expected spreadsheet, got ${JSON.stringify(parsed)}`);
    expect(parsed.columns).toHaveLength(200);
    expect(parsed.columns!.slice(0, 4)).toEqual(["Name", "Age", "Fostered", "Since"]);
    expect(parsed.sampleRows).toHaveLength(50);
    expect(parsed.sampleRows![0]).toEqual(["Dog 1", "1", "true", "2026-09-25T00:00:00.000Z"]);
    expect(parsed.rowCount).toBe(60);
    expect(parsed.summary).toBe("200 columns, 60 rows");

    const sheet = await readSheetMatrix(xlsx, "roster.xlsx", { convert });
    if (!sheet.ok) throw new Error(sheet.error);
    expect(sheet.data).toHaveLength(61);
    expect(sheet.data[1]!.slice(0, 4)).toEqual(["Dog 1", 1, true, new Date("2026-09-25T00:00:00.000Z")]);
    expect(sheet.data[2]!.slice(0, 4)).toEqual(["Dog 2", 2, false, new Date("2026-09-25T00:00:00.000Z")]);
  }, 600_000);

  it("pdf: text is read in the engine, with its page count", async () => {
    const pdf = await produceFrom(readFileSync(resolve(OFFICE_FIXTURES, "plan.docx")), "docx", "pdf");
    const parsed = await parseFileContent(pdf, "application/pdf", "plan.pdf", { convert });
    if (parsed?.type !== "document") throw new Error(`expected document, got ${JSON.stringify(parsed)}`);
    expect(parsed.fullText).toContain("Rescue operations plan");
    expect(parsed.fullText).toContain("Second Chance fosters twelve dogs this quarter.");
    expect(parsed.summary).toMatch(/^1 page, \d+ characters$/);
  }, 600_000);

  it("long text keeps the 20,000-character cap", async () => {
    const paragraphs = Array.from({ length: 800 }, (_, i) => `<text:p>Paragraph ${i + 1} of a long plan for the rescue.</text:p>`).join("");
    const fodt = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
        'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">' +
        `<office:body><office:text>${paragraphs}</office:text></office:body></office:document>`,
      "utf8",
    );
    const docx = await produceFrom(fodt, "fodt", "docx");
    const parsed = await parseFileContent(docx, "", "long.docx", { convert });
    if (parsed?.type !== "document") throw new Error(`expected document, got ${JSON.stringify(parsed)}`);
    expect(parsed.fullText!.length).toBe(20_000);
    expect(parsed.fullText!.endsWith("...")).toBe(true);
  }, 600_000);
});
