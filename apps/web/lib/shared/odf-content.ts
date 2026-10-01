// Readers for the engine's OpenDocument output (BI-D1B40D43, slice S9 of
// BI-815D40C6).
//
// DPF keeps no in-process .docx, .xlsx or .pdf parser. The dpf-doctools engine
// converts every office file to OpenDocument (.odt for text, .ods for sheets),
// and these functions read that one format: content.xml out of the package,
// then the text with its headings, or the first sheet as typed cells. ODF is
// the engine's native format and an ISO standard (ISO/IEC 26300), so one small
// reader covers Word 97-2003, RTF, .docx, OpenDocument, Excel 97-2003 and
// .xlsx alike. The XML parser is the one the flat-ODG import already uses
// (lib/ea/diagram-import/parse-flat-odg.ts).
//
// Pure and bounded: no I/O beyond the bytes given, content.xml is inflated
// under a cap, and the sheet reader keeps at most maxRows x maxColumns cells.

import { XMLParser } from "fast-xml-parser";
import { readZipEntry } from "./odf-embedded-objects";

/** A sheet cell, typed the way the Workbooks import infers field types. */
export type OdfCell = string | number | boolean | Date | null;

export type OdfText = { headings: string[]; text: string };
export type OdfSheet = { rows: OdfCell[][]; rowCount: number };

const MAX_CONTENT_XML_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_ROWS = 100_000;
const DEFAULT_MAX_COLUMNS = 1_000;

type Node = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
});

function tagOf(node: Node): string | null {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text") ?? null;
}
function childrenOf(node: Node, tag = tagOf(node)): Node[] {
  return tag ? ((node[tag] as Node[] | undefined) ?? []) : [];
}
function attrs(node: Node): Record<string, string> {
  return (node[":@"] as Record<string, string> | undefined) ?? {};
}
function child(node: Node, tag: string): Node | undefined {
  return childrenOf(node).find((entry) => tagOf(entry) === tag);
}

/** content.xml of an OpenDocument package (.odt, .ods). Throws when there is none. */
export function readOdfContentXml(pkg: Buffer): string {
  let content: Buffer | null = null;
  try {
    content = readZipEntry(pkg, "content.xml", MAX_CONTENT_XML_BYTES);
  } catch {
    content = null;
  }
  if (!content) throw new Error("The converted file is not an OpenDocument package.");
  return content.toString("utf8");
}

type OdfDocument = { body: Node; headingStyles: ReadonlySet<string> };

// Word's built-in "Heading 1".."Heading 6" styles, as ODF names them (a space
// is written `_20_`). A paragraph in one of them is a heading even when the
// source gave it no outline level, which is how Word itself treats it.
const HEADING_STYLE = /^Heading_20_[1-6]$/;

/**
 * Paragraph styles that are, or derive from, a heading style. Automatic styles
 * in content.xml name their common parent (defined in styles.xml) by name.
 */
function headingStyles(document: Node): Set<string> {
  const parents = new Map<string, string>();
  for (const container of childrenOf(document).filter((node) => tagOf(node) === "office:automatic-styles" || tagOf(node) === "office:styles")) {
    for (const style of childrenOf(container).filter((node) => tagOf(node) === "style:style")) {
      const a = attrs(style);
      if (a["style:name"] && a["style:parent-style-name"]) parents.set(a["style:name"], a["style:parent-style-name"]);
    }
  }
  const headings = new Set<string>();
  for (const name of parents.keys()) {
    let current: string | undefined = name;
    for (let depth = 0; current && depth < 16; depth += 1) {
      if (HEADING_STYLE.test(current)) {
        headings.add(name);
        break;
      }
      current = parents.get(current);
    }
  }
  return headings;
}

/** The office:body child (office:text, office:spreadsheet) of a content.xml or flat ODF document. */
function readOdfDocument(xml: string, kind: "office:text" | "office:spreadsheet"): OdfDocument | null {
  const root = parser.parse(xml) as Node[];
  const document = root.find((node) => tagOf(node) === "office:document-content" || tagOf(node) === "office:document");
  const body = document ? child(document, "office:body") : undefined;
  const content = body ? child(body, kind) : undefined;
  return document && content ? { body: content, headingStyles: headingStyles(document) } : null;
}

// Content a reader must not see as document text: change-tracking records
// (deleted text), comments, declarations, form definitions and footnote marks.
const SKIPPED = new Set([
  "text:tracked-changes",
  "office:annotation",
  "office:annotation-end",
  "text:sequence-decls",
  "text:variable-decls",
  "text:user-field-decls",
  "office:forms",
  "text:note-citation",
  "table:table-columns",
  "table:table-column",
  "table:table-header-columns",
  "svg:title",
  "svg:desc",
]);

// Elements inside a paragraph that hold paragraphs of their own (text boxes,
// shapes, footnote bodies): read after the paragraph, as their own blocks.
const NESTED_BLOCKS = new Set(["draw:frame", "draw:a", "draw:g", "draw:custom-shape", "draw:rect", "draw:ellipse", "text:note"]);

/**
 * One paragraph's text. ODF collapses runs of white space in character data
 * (ISO/IEC 26300 §6.1.2); explicit spaces, tabs and breaks are elements.
 */
function paragraphText(node: Node, nested: Node[]): string {
  const parts: string[] = [];
  const walk = (current: Node) => {
    for (const entry of childrenOf(current)) {
      const tag = tagOf(entry);
      if (!tag) {
        const raw = entry["#text"];
        if (typeof raw === "string" || typeof raw === "number") parts.push(String(raw).replace(/[ \t\r\n]+/g, " "));
        continue;
      }
      if (SKIPPED.has(tag)) continue;
      if (tag === "text:s") parts.push(" ".repeat(Math.max(1, Number(attrs(entry)["text:c"]) || 1)));
      else if (tag === "text:tab") parts.push("\t");
      else if (tag === "text:line-break") parts.push("\n");
      else if (NESTED_BLOCKS.has(tag)) nested.push(entry);
      else walk(entry);
    }
  };
  walk(node);
  return parts.join("").replace(/^ +| +$/g, "");
}

function isHeading(node: Node, tag: string, headingStyleNames: ReadonlySet<string>): boolean {
  if (tag === "text:h") return true;
  const style = attrs(node)["text:style-name"] ?? "";
  return HEADING_STYLE.test(style) || headingStyleNames.has(style);
}

type Collected = { blocks: string[]; headings: string[]; headingStyles: ReadonlySet<string> };

function collectBlocks(nodes: Node[], into: Collected): void {
  const { blocks, headings } = into;
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag || SKIPPED.has(tag)) continue;
    if (tag === "text:p" || tag === "text:h") {
      const nested: Node[] = [];
      const text = paragraphText(node, nested);
      if (text) {
        blocks.push(text);
        if (isHeading(node, tag, into.headingStyles)) headings.push(text);
      }
      collectBlocks(nested, into);
    } else if (tag === "table:table") {
      // One block per table, one line per row, cells separated by tabs.
      const lines = rowsOf(childrenOf(node, tag), [])
        .map((row) =>
          childrenOf(row)
            .filter((cell) => tagOf(cell) === "table:table-cell")
            .map((cell) => {
              const inner: Collected = { blocks: [], headings, headingStyles: into.headingStyles };
              collectBlocks(childrenOf(cell), inner);
              return inner.blocks.join(" ");
            })
            .join("\t")
            .replace(/\t+$/, ""),
        )
        .filter(Boolean);
      if (lines.length > 0) blocks.push(lines.join("\n"));
    } else {
      collectBlocks(childrenOf(node, tag), into);
    }
  }
}

/** The text of an OpenDocument text document: its headings in order, and its blocks joined by blank lines. */
export function readOdfText(xml: string): OdfText {
  const document = readOdfDocument(xml, "office:text");
  if (!document) throw new Error("The converted file is not an OpenDocument text document.");
  const collected: Collected = { blocks: [], headings: [], headingStyles: document.headingStyles };
  collectBlocks(childrenOf(document.body), collected);
  return { headings: collected.headings, text: collected.blocks.join("\n\n") };
}

function cellText(node: Node): string {
  return childrenOf(node)
    .filter((entry) => tagOf(entry) === "text:p" || tagOf(entry) === "text:h")
    .map((entry) => paragraphText(entry, []))
    .join("\n");
}

function odfDate(value: string): Date | null {
  const iso = value.includes("T") ? value : `${value}T00:00:00`;
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cellValue(node: Node): OdfCell {
  if (tagOf(node) !== "table:table-cell") return null;
  const a = attrs(node);
  const text = cellText(node);
  if (a["calcext:value-type"] === "error") return text || null;
  switch (a["office:value-type"]) {
    case "float":
    case "percentage":
    case "currency": {
      const number = Number(a["office:value"]);
      return Number.isFinite(number) ? number : text || null;
    }
    case "boolean":
      return a["office:boolean-value"] === "true";
    case "date":
      return odfDate(a["office:date-value"] ?? "") ?? (text || null);
    default:
      return text || null;
  }
}

function repeatCount(value: string | undefined): number {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : 1;
}

/** Every table:table-row of a table in order, through header-row and row-group wrappers. */
function rowsOf(nodes: Node[], out: Node[]): Node[] {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === "table:table-row") out.push(node);
    else if (tag === "table:table-header-rows" || tag === "table:table-rows" || tag === "table:table-row-group") rowsOf(childrenOf(node, tag), out);
  }
  return out;
}

function readRow(row: Node, maxColumns: number): OdfCell[] {
  const cells: OdfCell[] = [];
  let pendingBlanks = 0;
  for (const cell of childrenOf(row)) {
    const tag = tagOf(cell);
    if (tag !== "table:table-cell" && tag !== "table:covered-table-cell") continue;
    const value = cellValue(cell);
    const repeat = repeatCount(attrs(cell)["table:number-columns-repeated"]);
    if (value === null) {
      pendingBlanks += repeat;
      continue;
    }
    for (; pendingBlanks > 0 && cells.length < maxColumns; pendingBlanks -= 1) cells.push(null);
    pendingBlanks = 0;
    for (let i = 0; i < repeat && cells.length < maxColumns; i += 1) cells.push(value);
    if (cells.length >= maxColumns) break;
  }
  return cells;
}

/**
 * The first sheet of an OpenDocument spreadsheet as a row matrix. Repeated
 * cells and rows are expanded; the trailing empty ones LibreOffice writes to
 * the sheet's edge are not. `rowCount` counts every row up to the last one
 * with content, including rows beyond maxRows.
 */
export function readOdfSheet(xml: string, options: { maxRows?: number; maxColumns?: number } = {}): OdfSheet {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const document = readOdfDocument(xml, "office:spreadsheet");
  if (!document) throw new Error("The converted file is not an OpenDocument spreadsheet.");
  const table = childrenOf(document.body).find((node) => tagOf(node) === "table:table");
  const rows: OdfCell[][] = [];
  let rowCount = 0;
  let pendingEmpty = 0;
  for (const row of table ? rowsOf(childrenOf(table), []) : []) {
    const cells = readRow(row, maxColumns);
    const repeat = repeatCount(attrs(row)["table:number-rows-repeated"]);
    if (cells.length === 0) {
      pendingEmpty += repeat;
      continue;
    }
    for (; pendingEmpty > 0; pendingEmpty -= 1) {
      if (rows.length < maxRows) rows.push([]);
      rowCount += 1;
    }
    for (let i = 0; i < repeat; i += 1) {
      if (rows.length < maxRows) rows.push(i === 0 ? cells : [...cells]);
      rowCount += 1;
    }
  }
  return { rows, rowCount };
}
