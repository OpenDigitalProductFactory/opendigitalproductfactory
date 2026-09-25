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
