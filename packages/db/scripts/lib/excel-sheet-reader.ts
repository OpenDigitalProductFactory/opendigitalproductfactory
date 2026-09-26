// Dev-time .xlsx reader for the reference-data generators
// (generate-it4it-reference-json.ts, generate-taxonomy-v3-json.ts).
//
// BI-D1B40D43 retired read-excel-file from the platform (it is on the sbom
// deny list). These generators run only on a developer's machine, against the
// committed workbooks under docs/Reference/, and their output is committed
// JSON; nothing at seed time or run time reads a workbook (BI-B470264D). So
// rather than keep a package, or require the dpf-doctools engine and docker
// for a dev script, this reads the small subset of SpreadsheetML (ECMA-376
// Part 1 §18) those workbooks use, on fflate, which packages/db already has:
// the sheet list, shared strings, inline strings, numbers and booleans. Dates
// and formula results come back as their stored value. Verified by
// regenerating both committed JSON files byte for byte.

import { readFile } from "fs/promises";
import { strFromU8, unzipSync } from "fflate";

export type Cell = string | number | boolean | null;
export type SheetData = Cell[][];
export type Sheet = { sheet: string; data: SheetData };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode XML character references and the predefined entities, `&amp;` last so nothing is decoded twice. */
function decodeXml(text: string): string {
  return text
    .replace(/&(lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity: string) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
      return ENTITIES[entity]!;
    })
    .replace(/&amp;/g, "&");
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]!) : undefined;
}

/** The text of `<t>` runs, leaving out phonetic runs (`<rPh>`). */
function runText(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => decodeXml(m[1] ?? "")).join("");
}

/** Zero-based column index of an A1 reference ("C7" -> 2). */
function columnIndex(ref: string): number {
  let index = 0;
  for (const letter of /^[A-Z]+/.exec(ref)?.[0] ?? "") index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function cellValue(cellTag: string, inner: string, sharedStrings: string[]): Cell {
  const type = attribute(cellTag, "t") ?? "n";
  if (type === "inlineStr") {
    const text = runText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
    return text === "" ? null : text;
  }
  const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (raw === undefined) return null;
  const value = decodeXml(raw);
  switch (type) {
    case "s": {
      const text = sharedStrings[Number(value)] ?? "";
      return text === "" ? null : text;
    }
    case "b":
      return value === "1";
    case "str":
    case "e":
    case "d":
      return value === "" ? null : value;
    default: {
      const number = Number(value);
      return value === "" || Number.isNaN(number) ? null : number;
    }
  }
}

function readSheetXml(xml: string, sharedStrings: string[]): SheetData {
  const rows: SheetData = [];
  let width = 0;
  for (const [, rowTag, rowInner = ""] of xml.matchAll(/(<row\b[^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowIndex = Number(attribute(rowTag!, "r") ?? rows.length + 1) - 1;
    const cells: Cell[] = [];
    let next = 0;
    for (const [, cellTag, cellInner = ""] of rowInner.matchAll(/(<c\b[^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attribute(cellTag!, "r");
      const column = ref ? columnIndex(ref) : next;
      cells[column] = cellValue(cellTag!, cellInner, sharedStrings);
      next = column + 1;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
    width = Math.max(width, cells.length);
  }
  // Drop trailing blank rows and columns, and fill the rest with nulls.
  const blank = (row: Cell[]) => row.every((cell) => cell === null || cell === undefined);
  while (rows.length > 0 && blank(rows[rows.length - 1]!)) rows.pop();
  let used = 0;
  for (const row of rows) for (let i = row.length - 1; i >= 0; i -= 1) if (row[i] !== null && row[i] !== undefined) { used = Math.max(used, i + 1); break; }
  width = used;
  return rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? null));
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  return resolved.join("/");
}

/** Every worksheet of an .xlsx, in workbook order, as rows of typed cells. */
export function readWorkbookBytes(bytes: Uint8Array): Sheet[] {
  const entries = unzipSync(bytes);
  const text = (name: string) => (entries[name] ? strFromU8(entries[name]!) : "");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new Error("Not an .xlsx workbook: xl/workbook.xml is missing");
  const targets = new Map<string, string>();
  for (const [tag] of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attribute(tag, "Id");
    const target = attribute(tag, "Target");
    if (id && target) targets.set(id, resolveTarget(target));
  }
  const sharedStrings = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => runText(m[1] ?? ""));
  return [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => {
    const name = attribute(tag, "name") ?? "";
    const path = targets.get(attribute(tag, "r:id") ?? "") ?? "";
    return { sheet: name, data: readSheetXml(text(path), sharedStrings) };
  });
}

export async function readWorkbook(path: string): Promise<Sheet[]> {
  return readWorkbookBytes(await readFile(path));
}

export function requireSheetData(workbook: Sheet[], sheetName: string): SheetData {
  const sheet = workbook.find((entry) => entry.sheet === sheetName);
  if (!sheet) throw new Error(`Missing worksheet: ${sheetName}`);
  return sheet.data;
}

function stringifyCell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
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
