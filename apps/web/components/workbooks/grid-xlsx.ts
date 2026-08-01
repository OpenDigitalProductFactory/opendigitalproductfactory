// Universal Grid & Workbooks — native .xlsx export (EP-GRID-WORKBOOKS).
//
// A dependency-free writer for the minimal subset of the Office Open XML
// SpreadsheetML (.xlsx) format: a ZIP (stored / uncompressed) of a handful of XML
// parts. This keeps the platform fully local — no spreadsheet library, no vendor —
// and pairs with the existing read-excel-file import so the grid round-trips with
// Excel. Numbers are written as numeric cells (so Excel treats them as numbers);
// everything else is an inline string. Pure + unit-testable; the round-trip test
// parses the output back with read-excel-file to prove the file is valid.

/** A cell value to export: number → numeric cell, string/null → inline string. */
export type XlsxValue = string | number | null;

const enc = new TextEncoder();

// ── CRC-32 (IEEE 802.3), needed by the ZIP container ────────────────────────────
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ t[(c ^ bytes[i]!) & 0xff]!;
  return (c ^ 0xffffffff) >>> 0;
}

// ── XML + column helpers ─────────────────────────────────────────────────────────
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 0 → "A", 25 → "Z", 26 → "AA" … the A1-notation column letters. */
export function colLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** XLSX forbids these in a sheet name and caps it at 31 chars. */
export function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

// ── The worksheet body ───────────────────────────────────────────────────────────
/** Build the `<sheetData>` worksheet XML for a matrix of rows. */
export function sheetXml(rows: XlsxValue[][]): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
  );
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r]!;
    const rowNum = r + 1;
    let row = `<row r="${rowNum}">`;
    for (let c = 0; c < cells.length; c++) {
      const ref = `${colLetter(c)}${rowNum}`;
      const v = cells[c];
      if (typeof v === "number" && Number.isFinite(v)) {
        row += `<c r="${ref}"><v>${v}</v></c>`;
      } else {
        const text = v === null || v === undefined ? "" : String(v);
        if (text === "") {
          row += `<c r="${ref}"/>`;
        } else {
          row += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
        }
      }
    }
    row += "</row>";
    lines.push(row);
  }
  lines.push("</sheetData></worksheet>");
  return lines.join("");
}

// ── The fixed OOXML package parts ────────────────────────────────────────────────
const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  "</Types>";

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  "</Relationships>";

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  "</Relationships>";

function workbookXml(sheetName: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    "</workbook>"
  );
}

// ── Minimal stored (uncompressed) ZIP container ──────────────────────────────────
interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function pushU16(out: number[], n: number): void {
  out.push(n & 0xff, (n >>> 8) & 0xff);
}
function pushU32(out: number[], n: number): void {
  out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}
function pushBytes(out: number[], b: Uint8Array): void {
  for (let i = 0; i < b.length; i++) out.push(b[i]!);
}

// A fixed valid DOS date (1980-01-01) / time (00:00); Excel ignores it.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** Assemble stored ZIP entries into a single .xlsx byte array. */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const out: number[] = [];
  const central: number[] = [];
  const offsets: number[] = [];

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    offsets.push(out.length);

    // Local file header.
    pushU32(out, 0x04034b50);
    pushU16(out, 20); // version needed
    pushU16(out, 0); // flags
    pushU16(out, 0); // method: stored
    pushU16(out, DOS_TIME);
    pushU16(out, DOS_DATE);
    pushU32(out, crc);
    pushU32(out, size); // compressed size
    pushU32(out, size); // uncompressed size
    pushU16(out, nameBytes.length);
    pushU16(out, 0); // extra length
    pushBytes(out, nameBytes);
    pushBytes(out, e.data);

    // Central directory header (buffered, appended after all locals).
    pushU32(central, 0x02014b50);
    pushU16(central, 20); // version made by
    pushU16(central, 20); // version needed
    pushU16(central, 0); // flags
    pushU16(central, 0); // method
    pushU16(central, DOS_TIME);
    pushU16(central, DOS_DATE);
    pushU32(central, crc);
    pushU32(central, size);
    pushU32(central, size);
    pushU16(central, nameBytes.length);
    pushU16(central, 0); // extra
    pushU16(central, 0); // comment
    pushU16(central, 0); // disk number
    pushU16(central, 0); // internal attrs
    pushU32(central, 0); // external attrs
    pushU32(central, offsets[offsets.length - 1]!); // local header offset
    pushBytes(central, nameBytes);
  }

  const centralOffset = out.length;
  pushBytes(out, Uint8Array.from(central));

  // End of central directory record.
  pushU32(out, 0x06054b50);
  pushU16(out, 0); // disk number
  pushU16(out, 0); // disk with central dir
  pushU16(out, entries.length);
  pushU16(out, entries.length);
  pushU32(out, central.length);
  pushU32(out, centralOffset);
  pushU16(out, 0); // comment length

  return Uint8Array.from(out);
}

/**
 * Build a complete .xlsx workbook (one sheet) from a matrix of rows — the first
 * row is treated as the header. Returns the raw bytes for a Blob download.
 */
export function buildXlsx(rows: XlsxValue[][], opts: { sheetName?: string } = {}): Uint8Array {
  const sheetName = sanitizeSheetName(opts.sheetName ?? "Sheet1");
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml(sheetName)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(rows)) },
  ];
  return zipStore(entries);
}
