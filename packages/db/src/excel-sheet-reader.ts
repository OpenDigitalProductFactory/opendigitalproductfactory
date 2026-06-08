import { readFile } from "fs/promises";
import readExcelFile, { type Sheet, type SheetData } from "read-excel-file/node";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function normalizeEmptyInlineStringCells(xml: string): string {
  return xml.replace(/<c\b([^>]*)\bt="inlineStr"([^>]*)>\s*<\/c>/g, "<c$1$2></c>");
}

function normalizeWorkbookBuffer(buffer: Buffer): Buffer {
  const entries = unzipSync(buffer);
  let changed = false;

  for (const [path, entry] of Object.entries(entries)) {
    if (!path.startsWith("xl/worksheets/") || !path.endsWith(".xml")) continue;

    const xml = strFromU8(entry);
    const normalized = normalizeEmptyInlineStringCells(xml);
    if (normalized === xml) continue;

    entries[path] = strToU8(normalized);
    changed = true;
  }

  return changed ? Buffer.from(zipSync(entries)) : buffer;
}

export async function readWorkbook(path: string): Promise<Sheet[]> {
  const buffer = await readFile(path);
  return readExcelFile(normalizeWorkbookBuffer(buffer));
}

export function requireSheetData(workbook: Sheet[], sheetName: string): SheetData {
  const sheet = workbook.find((entry) => entry.sheet === sheetName);
  if (!sheet) throw new Error(`Missing worksheet: ${sheetName}`);
  return sheet.data;
}

export function sheetDataToObjects(sheetData: SheetData): Array<Record<string, unknown>> {
  if (sheetData.length === 0) return [];

  const headers = (sheetData[0] ?? []).map((cell) => stringifyCell(cell));
  const rows: Array<Record<string, unknown>> = [];

  for (const row of sheetData.slice(1)) {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = row[index] ?? null;
    });
    rows.push(record);
  }

  return rows;
}
