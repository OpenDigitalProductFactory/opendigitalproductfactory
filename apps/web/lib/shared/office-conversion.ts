// The format routing table for engine-backed ingestion (BI-81524041, slice S3,
// and BI-D1B40D43, slice S9 of BI-815D40C6).
//
// DPF keeps no in-process office or PDF parser. The dpf-doctools engine
// (convertDocument, S2) turns each file into one format DPF reads itself
// (odf-content.ts), or into plain text:
//
//   family  | source (sniffed from the bytes)                    | converted to | then read by
//   --------|----------------------------------------------------|--------------|-------------
//   word    | .docx, Word 97-2003 .doc, RTF, OpenDocument text   | .odt         | readOdfText
//   sheet   | .xlsx, Excel 97-2003 .xls, OpenDocument sheet      | .ods         | readOdfSheet
//   slides  | .ppt, .pptx, OpenDocument presentation             | plain text   | the text path
//   pdf     | PDF                                                | plain text   | pdftotext, in the engine
//
// `fallback` is the unsupported format (BI-65D65EC0) the file reports when the
// converter is not available, so an install without it gets an honest reason
// instead of garbled text. Pure: no I/O, and only types come from file-parsers.

import type { OfficeContainer, UnsupportedFileFormat } from "./file-parsers";

export type ConversionFamily = "word" | "sheet" | "slides" | "pdf";

export type ConversionRoute = {
  family: ConversionFamily;
  /** dpf-convert `--from` hint. */
  from: string;
  /** The format DPF reads after conversion. */
  to: "odt" | "ods" | "txt";
  /** The unsupported result when the converter is unavailable. */
  fallback: UnsupportedFileFormat;
};

const WORD_EXTENSIONS = new Set(["doc", "dot"]);
const SHEET_EXTENSIONS = new Set(["xls", "xlt"]);
const SLIDE_EXTENSIONS = new Set(["ppt", "pot", "pps"]);

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_MAGIC = "%PDF-";

/**
 * The OpenDocument flavour, from the `mimetype` entry S0 already found at the
 * start of the package (local header 30 bytes + the 8-byte name).
 */
function odfFlavor(bytes: Uint8Array): "text" | "spreadsheet" | "presentation" | "other" {
  const mimetype = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1", 38, 100);
  const match = /^application\/vnd\.oasis\.opendocument\.([a-z]+)/.exec(mimetype);
  const flavor = match?.[1];
  return flavor === "text" || flavor === "spreadsheet" || flavor === "presentation" ? flavor : "other";
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/** True when the bytes are a PDF: `%PDF-` within the first 1024 bytes (ISO 32000-1 §7.5.2 readers allow leading junk). */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1024));
  return head.includes(PDF_MAGIC, 0, "latin1");
}

const WORD = (from: string, fallback: UnsupportedFileFormat): ConversionRoute => ({ family: "word", from, to: "odt", fallback });
const SHEET = (from: string, fallback: UnsupportedFileFormat): ConversionRoute => ({ family: "sheet", from, to: "ods", fallback });
const SLIDES = (from: string, fallback: UnsupportedFileFormat): ConversionRoute => ({ family: "slides", from, to: "txt", fallback });
const PDF: ConversionRoute = { family: "pdf", from: "pdf", to: "txt", fallback: "pdf" };

/**
 * Where a file goes before it is read, or null when the bytes are not an
 * office file or a PDF (CSV, plain text, unknown). The bytes decide; the name
 * is used only for an OLE file that does not name its application.
 */
export function conversionRouteFor(container: OfficeContainer, bytes: Uint8Array, fileName: string): ConversionRoute | null {
  switch (container.kind) {
    case "ole": {
      if (container.format === "legacy-word") return WORD("doc", "legacy-word");
      if (container.format === "legacy-excel") return SHEET("xls", "legacy-excel");
      if (container.format === "legacy-powerpoint") return SLIDES("ppt", "legacy-powerpoint");
      const ext = extensionOf(fileName);
      if (WORD_EXTENSIONS.has(ext)) return WORD(ext, "legacy-office");
      if (SHEET_EXTENSIONS.has(ext)) return SHEET(ext, "legacy-office");
      if (SLIDE_EXTENSIONS.has(ext)) return SLIDES(ext, "legacy-office");
      return null;
    }
    case "rtf":
      return WORD("rtf", "rtf");
    case "odf": {
      const flavor = odfFlavor(bytes);
      if (flavor === "text") return WORD("odt", "opendocument");
      if (flavor === "spreadsheet") return SHEET("ods", "opendocument");
      if (flavor === "presentation") return SLIDES("odp", "opendocument");
      return null;
    }
    case "ooxml":
      if (container.part === "word") return WORD("docx", "word-document");
      if (container.part === "xl") return SHEET("xlsx", "workbook");
      if (container.part === "ppt") return SLIDES("pptx", "presentation");
      return null;
    default:
      return isPdfBytes(bytes) ? PDF : null;
  }
}

/**
 * The route a file's name or MIME type claims, for bytes the sniffer could not
 * place: a .docx, .xlsx or .pdf whose content is damaged still goes to the
 * engine, which then says it cannot read it. Null for anything else.
 */
export function conversionRouteForName(fileName: string, mimeType: string): ConversionRoute | null {
  const ext = extensionOf(fileName);
  if (ext === "docx" || mimeType === DOCX_MIME) return WORD("docx", "word-document");
  if (ext === "xlsx" || mimeType === XLSX_MIME) return SHEET("xlsx", "workbook");
  if (ext === "pdf" || mimeType === "application/pdf") return PDF;
  return null;
}
