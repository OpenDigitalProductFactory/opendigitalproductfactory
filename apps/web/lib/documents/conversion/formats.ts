// The dpf-convert format tables (tools/doctools/dpf-convert), mirrored for the
// portal side of the converter runtime (BI-52E565DA). A value outside these
// sets is refused before any container starts.

/** Values dpf-convert accepts for `--to`, with the MIME type of each output. */
export const CONVERTER_TARGET_MIME = {
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv; charset=utf-8",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  ppt: "application/vnd.ms-powerpoint",
} as const;

export type ConverterTarget = keyof typeof CONVERTER_TARGET_MIME;

/** Input extensions dpf-convert accepts for `--from` (its `input_allowed`). */
export const CONVERTER_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  "doc", "docx", "docm", "dot", "dotx", "odt", "ott", "fodt", "rtf", "txt", "html", "htm", "wpd",
  "xls", "xlsx", "xlsm", "xlt", "xltx", "ods", "ots", "fods", "csv",
  "ppt", "pptx", "pptm", "pot", "potx", "pps", "ppsx", "odp", "otp", "fodp",
  "odg", "otg", "fodg", "vsd", "vsdx", "svg", "pdf",
]);

export function isConverterTarget(value: string): value is ConverterTarget {
  return Object.prototype.hasOwnProperty.call(CONVERTER_TARGET_MIME, value);
}

/** Lower-case and strip a leading dot, the way dpf-convert normalises `--from`. */
export function normalizeSourceExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, "");
}

/**
 * The office MIME list: the one home for "is this stored content an office
 * file the engine can render?" (BI-9D43CBEF). Each MIME type maps to the
 * dpf-convert `--from` extension. Text, markdown, HTML and PDF are absent on
 * purpose: the document store already reads them without the engine.
 */
const OFFICE_SOURCE_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-word.document.macroenabled.12": "docm",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroenabled.12": "xlsm",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12": "pptm",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.oasis.opendocument.graphics": "odg",
  "application/vnd.visio": "vsd",
  "application/vnd.ms-visio.drawing.main+xml": "vsdx",
};

/** Every office MIME type, lower-case, for store queries such as the rendition backfill. */
export const OFFICE_SOURCE_MIME_TYPES: readonly string[] = Object.keys(OFFICE_SOURCE_EXTENSION_BY_MIME);

/** Lower-case a MIME type and drop its parameters (`; charset=...`). */
export function normalizeMimeType(value: string): string {
  return value.split(";")[0]!.trim().toLowerCase();
}

/** The dpf-convert source extension for an office MIME type, or null for anything else. */
export function officeSourceExtension(contentFormat: string): string | null {
  return OFFICE_SOURCE_EXTENSION_BY_MIME[normalizeMimeType(contentFormat)] ?? null;
}
