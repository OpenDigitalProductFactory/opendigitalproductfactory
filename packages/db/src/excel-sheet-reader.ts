import readExcelFile, { type Sheet, type SheetData } from "read-excel-file/node";

function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

export async function readWorkbook(path: string): Promise<Sheet[]> {
  return readExcelFile(path);
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
