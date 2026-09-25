import type { ConversionResult } from "@/lib/documents/conversion/convert";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { EMBEDDED_OBJECTS_REASON, hasOdfEmbeddedObjects } from "./odf-embedded-objects";
import { conversionRouteFor, type ConversionFamily, type ConversionRoute } from "./office-conversion";

export type ReadableFileContent = {
  type: "spreadsheet" | "document";
  summary: string;
  columns?: string[];
  sampleRows?: string[][];
  rowCount?: number;
  sections?: { heading: string; text: string }[];
  fullText?: string;
};

/** A file DPF recognised but cannot read. `summary` repeats `reason` so every
 *  reader of stored parsed content (the coworker's file context, attachment
 *  lists) shows the honest reason rather than garbled text (BI-65D65EC0). */
export type UnsupportedFileContent = {
  type: "unsupported";
  format: UnsupportedFileFormat;
  reason: string;
  summary: string;
};

export type ParsedFileContent = ReadableFileContent | UnsupportedFileContent;

export type UnsupportedFileFormat = "legacy-word" | "legacy-excel" | "legacy-powerpoint" | "legacy-office" | "rtf" | "opendocument" | "presentation";

/** What the bytes say the file is, whatever its name claims. */
export type OfficeContainer =
  | { kind: "ole"; format: "legacy-word" | "legacy-excel" | "legacy-powerpoint" | "legacy-office" }
  | { kind: "rtf" }
  | { kind: "ooxml"; part: "word" | "xl" | "ppt" | "other" }
  | { kind: "odf" }
  | { kind: "zip" }
  | { kind: "unknown" };

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const UTF8_BOM = [0xef, 0xbb, 0xbf];

function startsWithBytes(buffer: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buffer[offset + i] === b);
}

/** OLE directory entries are UTF-16LE names; the main stream names the application. */
function oleFormat(buffer: Buffer): Extract<OfficeContainer, { kind: "ole" }>["format"] {
  const has = (stream: string) => buffer.includes(Buffer.from(stream, "utf16le"));
  if (has("WordDocument")) return "legacy-word";
  if (has("Workbook") || has("Book")) return "legacy-excel";
  if (has("PowerPoint Document")) return "legacy-powerpoint";
  return "legacy-office";
}

/**
 * Identify an office container from its bytes: the OLE compound-file magic
 * (Word/Excel/PowerPoint 97-2003), `{\rtf`, or a ZIP whose `[Content_Types].xml`
 * entry marks OOXML or whose leading `mimetype` entry marks OpenDocument.
 * ZIP entry names are stored as plain bytes in each local header and in the
 * central directory, so a byte search finds them without inflating anything.
 */
export function sniffOfficeContainer(input: Uint8Array): OfficeContainer {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (startsWithBytes(buffer, OLE_MAGIC)) return { kind: "ole", format: oleFormat(buffer) };
  const textStart = startsWithBytes(buffer, UTF8_BOM) ? UTF8_BOM.length : 0;
  if (buffer.toString("latin1", textStart, textStart + 5) === "{\\rtf") return { kind: "rtf" };
  if (!startsWithBytes(buffer, ZIP_MAGIC)) return { kind: "unknown" };
  if (buffer.toString("latin1", 30, 38) === "mimetype" && buffer.toString("latin1", 38, 73).startsWith("application/vnd.oasis.opendocument")) {
    return { kind: "odf" };
  }
  if (buffer.includes("[Content_Types].xml", 0, "latin1")) {
    if (buffer.includes("word/document.xml", 0, "latin1")) return { kind: "ooxml", part: "word" };
    if (buffer.includes("xl/workbook.xml", 0, "latin1")) return { kind: "ooxml", part: "xl" };
    if (buffer.includes("ppt/presentation.xml", 0, "latin1")) return { kind: "ooxml", part: "ppt" };
    return { kind: "ooxml", part: "other" };
  }
  return { kind: "zip" };
}

const UNSUPPORTED_REASONS: Record<UnsupportedFileFormat, string> = {
  "legacy-word": "This is a Word 97-2003 document (.doc). DPF cannot read that older format yet, so its text was not extracted. Save it as .docx or PDF and upload it again.",
  "legacy-excel": "This is an Excel 97-2003 workbook (.xls). DPF cannot read that older format yet, so its data was not extracted. Save it as .xlsx or CSV and upload it again.",
  "legacy-powerpoint": "This is a PowerPoint 97-2003 presentation (.ppt). DPF cannot read that older format yet, so its text was not extracted. Save it as PDF and upload it again.",
  "legacy-office": "This is an older Microsoft Office file (97-2003 format). DPF cannot read it yet, so its content was not extracted. Save it in a current format (.docx, .xlsx or PDF) and upload it again.",
  rtf: "This is a Rich Text (RTF) file. DPF cannot read RTF yet, so its text was not extracted. Save it as .docx, PDF or plain text and upload it again.",
  opendocument: "This is an OpenDocument file (.odt, .ods or .odp). DPF cannot read OpenDocument files yet, so its content was not extracted. Save it as .docx, .xlsx or PDF and upload it again.",
  presentation: "This is a PowerPoint presentation (.pptx). DPF reads presentation text only through its document converter, which is not available right now, so its text was not extracted. Save it as PDF and upload it again.",
};

/** The plain-language reason for a recognised format DPF cannot read. */
export function describeUnsupportedFormat(format: UnsupportedFileFormat): string {
  return UNSUPPORTED_REASONS[format];
}

export function unsupportedFileContent(format: UnsupportedFileFormat): UnsupportedFileContent {
  const reason = describeUnsupportedFormat(format);
  return { type: "unsupported", format, reason, summary: reason };
}

const MAX_COLUMNS = 200;
const MAX_COLUMN_LEN = 100;
const MAX_CELL_LEN = 200;
const MAX_SAMPLE_ROWS = 50;
const MAX_SECTIONS = 100;
const MAX_TEXT_LEN = 20_000;
const MAX_PARSED_JSON_SIZE = 100_000;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

export function parseCsv(buffer: Buffer): ReadableFileContent {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { type: "spreadsheet", summary: "Empty spreadsheet", columns: [], rowCount: 0 };

  const allColumns = lines[0]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const columns = allColumns.slice(0, MAX_COLUMNS).map((c) => truncate(c, MAX_COLUMN_LEN));
  const dataLines = lines.slice(1);
  const sampleRows = dataLines.slice(0, MAX_SAMPLE_ROWS).map((line) =>
    line.split(",").slice(0, MAX_COLUMNS).map((cell) => truncate(cell.trim().replace(/^"|"$/g, ""), MAX_CELL_LEN)),
  );

  return { type: "spreadsheet", summary: `${columns.length} columns, ${dataLines.length} rows`, columns, sampleRows, rowCount: dataLines.length };
}

function stringifySpreadsheetCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function parseXlsx(buffer: Buffer): Promise<ReadableFileContent> {
  const { readSheet } = await import(/* turbopackIgnore: true */ "read-excel-file/universal");
  const input = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(input).set(buffer);
  const rows = await readSheet(input);
  if (rows.length === 0) return { type: "spreadsheet", summary: "Empty workbook", columns: [], rowCount: 0 };

  const headerRow = rows[0] ?? [];
  const columns = headerRow.slice(0, MAX_COLUMNS).map((c) => truncate(stringifySpreadsheetCell(c), MAX_COLUMN_LEN));
  const dataRows = rows.slice(1);
  const sampleRows = dataRows.slice(0, MAX_SAMPLE_ROWS).map((row) =>
    row.slice(0, MAX_COLUMNS).map((cell) => truncate(stringifySpreadsheetCell(cell), MAX_CELL_LEN)),
  );

  return { type: "spreadsheet", summary: `${columns.length} columns, ${dataRows.length} rows`, columns, sampleRows, rowCount: dataRows.length };
}

export async function parsePdf(buffer: Buffer): Promise<ReadableFileContent> {
  const { PDFParse } = await import(/* turbopackIgnore: true */ "pdf-parse");
  const pdf = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await pdf.getText();
  const info = await pdf.getInfo();
  const numPages = info.pages?.length ?? textResult.pages?.length ?? 0;
  const fullText = textResult.text ?? "";
  await pdf.destroy();
  return { type: "document", summary: `${numPages} page${numPages !== 1 ? "s" : ""}, ${fullText.length} characters`, fullText: truncate(fullText, MAX_TEXT_LEN) };
}

export async function parseDocx(buffer: Buffer): Promise<ReadableFileContent> {
  const mammoth = await import(/* turbopackIgnore: true */ "mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const headingRe = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi;
  const sections: { heading: string; text: string }[] = [];
  let match;
  while ((match = headingRe.exec(htmlResult.value)) !== null && sections.length < MAX_SECTIONS) {
    // CodeQL #59 (js/incomplete-multi-character-sanitization): single-pass
    // tag strip leaves nested tag fragments like `<a<script>` partially
    // intact. Iterate until no more tag-like patterns remain.
    let heading = match[1]!;
    let prev = "";
    while (heading !== prev) {
      prev = heading;
      heading = heading.replace(/<[^<>]*>/g, "");
    }
    sections.push({ heading, text: "" });
  }
  const base: ReadableFileContent = { type: "document", summary: `${sections.length} section${sections.length !== 1 ? "s" : ""}, ${result.value.length} characters`, fullText: truncate(result.value, MAX_TEXT_LEN) };
  if (sections.length > 0) base.sections = sections;
  return base;
}

function parseTextFile(buffer: Buffer): ReadableFileContent {
  const text = buffer.toString("utf-8");
  return {
    type: "document",
    summary: `${text.length} characters`,
    fullText: truncate(text, MAX_TEXT_LEN),
  };
}

/** The converter seam: convertDocument (S2) in production, a fake in tests. */
export type ConvertForIngestion = (request: { input: Buffer; from: string; to: ConversionRoute["to"] }) => Promise<ConversionResult>;

export type ParseFileDeps = { convert?: ConvertForIngestion };

const defaultConvert: ConvertForIngestion = async (request) => {
  const { convertDocument } = await import("@/lib/documents/conversion/convert");
  return convertDocument(request);
};

const RESAVE_ADVICE: Record<ConversionFamily, string> = {
  word: "Save it as .docx or PDF and upload it again.",
  sheet: "Save it as .xlsx or CSV and upload it again.",
  slides: "Save it as PDF and upload it again.",
};

function conversionFailedReason(route: ConversionRoute, why: string): string {
  return `DPF could not convert this file${why}. ${RESAVE_ADVICE[route.family]}`;
}

function unsupportedWithReason(format: UnsupportedFileFormat, reason: string): UnsupportedFileContent {
  return { type: "unsupported", format, reason, summary: reason };
}

/** The routes whose source is an OpenDocument package (office-conversion.ts). */
const ODF_SOURCES: ReadonlySet<string> = new Set(["odt", "ods", "odp"]);

/**
 * Run one routed file through the converter: the converted bytes, or the
 * plain-language reason it could not be read. With no converter that reason is
 * S0's; any other failure is named, and the technical detail goes to the log,
 * never to the person (BI-81524041). When the converter refuses an
 * OpenDocument file that embeds objects (its hardened profile does not open
 * them), the person is told that, not "damaged" (BI-BFF142A1).
 */
export async function convertForIngestion(
  buffer: Buffer,
  route: ConversionRoute,
  convert: ConvertForIngestion = defaultConvert,
): Promise<ActionResult<Buffer>> {
  let result: ConversionResult;
  try {
    result = await convert({ input: buffer, from: route.from, to: route.to });
  } catch (error) {
    result = { ...err(getErrorMessage(error)), reason: "conversion-failed" };
  }
  if (result.ok) return ok(result.data.bytes);
  if (result.reason !== "converter-unavailable") {
    console.warn(`[file-parsers] ${route.from} -> ${route.to} conversion failed (${result.reason}): ${result.error}`);
  }
  if (result.reason === "conversion-failed" && ODF_SOURCES.has(route.from) && hasOdfEmbeddedObjects(buffer)) {
    return err(EMBEDDED_OBJECTS_REASON);
  }
  switch (result.reason) {
    case "converter-unavailable":
      return err(describeUnsupportedFormat(route.fallback));
    case "input-too-large":
      return err(conversionFailedReason(route, " because it is larger than the document converter accepts"));
    case "timeout":
      return err(conversionFailedReason(route, " because the conversion took too long"));
    default:
      return err(conversionFailedReason(route, "; it may be damaged or password-protected"));
  }
}

async function parseConverted(buffer: Buffer, route: ConversionRoute, convert?: ConvertForIngestion): Promise<ParsedFileContent> {
  const converted = await convertForIngestion(buffer, route, convert);
  if (!converted.ok) return unsupportedWithReason(route.fallback, converted.error);
  try {
    if (route.to === "docx") return await parseDocx(converted.data);
    if (route.to === "xlsx") return await parseXlsx(converted.data);
    return parseTextFile(converted.data);
  } catch (error) {
    console.warn(`[file-parsers] converted ${route.from} -> ${route.to} could not be parsed: ${getErrorMessage(error)}`);
    return unsupportedWithReason(route.fallback, conversionFailedReason(route, "; it may be damaged or password-protected"));
  }
}

export async function parseFileContent(buffer: Buffer, mimeType: string, fileName: string, deps: ParseFileDeps = {}): Promise<ParsedFileContent | null> {
  const ext = fileName.split(".").pop()?.toLowerCase();
  // The bytes decide before the name does: a real .doc is an OLE file mammoth
  // cannot read, RTF would otherwise be stored as control words, and a .docx
  // renamed .doc is still a .docx (BI-65D65EC0). Legacy, RTF, OpenDocument and
  // presentation files are converted to a format an existing parser reads
  // first; with no converter they keep S0's unsupported result (BI-81524041).
  const container = sniffOfficeContainer(buffer);
  const route = conversionRouteFor(container, buffer, fileName);
  if (route) return parseConverted(buffer, route, deps.convert);
  if (container.kind === "ole") return unsupportedFileContent(container.format);
  if (container.kind === "odf") return unsupportedFileContent("opendocument");
  if (container.kind === "ooxml" && container.part === "word") return parseDocx(buffer);
  if (mimeType === "text/csv" || ext === "csv" || ext === "tsv") return parseCsv(buffer);
  if (ext === "xlsx" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return parseXlsx(buffer);
  if (mimeType === "application/pdf" || ext === "pdf") return parsePdf(buffer);
  if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return parseDocx(buffer);
  // Text-based formats
  if (ext && ["txt", "json", "md", "xml", "yaml", "yml", "log"].includes(ext)) return parseTextFile(buffer);
  if (mimeType?.startsWith("text/")) return parseTextFile(buffer);
  return null;
}

export function capParsedContentSize<T extends ParsedFileContent>(content: T): T {
  if (content.type === "unsupported") return content;
  const readable = content as ReadableFileContent;
  const json = JSON.stringify(readable);
  if (json.length <= MAX_PARSED_JSON_SIZE) return content;
  if (readable.fullText) {
    const excess = json.length - MAX_PARSED_JSON_SIZE;
    readable.fullText = readable.fullText.slice(0, Math.max(1000, readable.fullText.length - excess));
  }
  return content;
}
