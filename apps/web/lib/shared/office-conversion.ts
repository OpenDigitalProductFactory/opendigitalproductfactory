// The format routing table for converter-backed ingestion (BI-81524041, slice
// S3 of BI-815D40C6).
//
// DPF adds no parser for legacy or OpenDocument files. The dpf-doctools engine
// (convertDocument, S2) turns each one into a format an existing parser already
// reads, and that parser does the rest:
//
//   family  | source (sniffed from the bytes)        | converted to | then read by
//   --------|----------------------------------------|--------------|-------------
//   word    | Word 97-2003 .doc, RTF, OpenDocument text | .docx      | parseDocx (mammoth)
//   sheet   | Excel 97-2003 .xls, OpenDocument sheet | .xlsx        | parseXlsx / readSheet
//   slides  | .ppt, .pptx, OpenDocument presentation | plain text   | the text path
//
// `fallback` is the S0 unsupported format (BI-65D65EC0) the file reports when
// the converter is not available, so an install without it keeps today's honest
// result. Pure: no I/O, and only types come from file-parsers.

import type { OfficeContainer, UnsupportedFileFormat } from "./file-parsers";

export type ConversionFamily = "word" | "sheet" | "slides";

export type ConversionRoute = {
  family: ConversionFamily;
  /** dpf-convert `--from` hint. */
  from: string;
  /** The format an existing parser reads. */
  to: "docx" | "xlsx" | "txt";
  /** The S0 result when the converter is unavailable. */
  fallback: UnsupportedFileFormat;
};

const WORD_EXTENSIONS = new Set(["doc", "dot"]);
const SHEET_EXTENSIONS = new Set(["xls", "xlt"]);
const SLIDE_EXTENSIONS = new Set(["ppt", "pot", "pps"]);

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

const WORD = (from: string, fallback: UnsupportedFileFormat): ConversionRoute => ({ family: "word", from, to: "docx", fallback });
const SHEET = (from: string, fallback: UnsupportedFileFormat): ConversionRoute => ({ family: "sheet", from, to: "xlsx", fallback });
const SLIDES = (from: string, fallback: UnsupportedFileFormat): ConversionRoute => ({ family: "slides", from, to: "txt", fallback });

/**
 * Where a file goes before parsing, or null when an existing parser reads it
 * as it is (or nothing can). The bytes decide; the name is used only for an OLE
 * file that does not name its application.
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
      return container.part === "ppt" ? SLIDES("pptx", "presentation") : null;
    default:
      return null;
  }
}
