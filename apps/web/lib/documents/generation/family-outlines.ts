// Coworker outlines for the report, letter, sheet and drawing families
// (BI-012487AA, slice A4 of the integrated office suite roadmap).
//
// An outline is what a coworker writes: the content in the words of the task
// (sections with paragraphs, a recipient and the body of a letter, tables, boxes
// and arrows). Each `outlineTo*Spec` maps one onto its family's content spec
// (spec.ts), filling what a person would expect without being told: today's
// date and "Dear <name>," on a letter, sheet names, a grid for boxes with no
// position. The spec, not this file, decides what is valid; the `*OutlineIssues`
// functions only catch an outline too malformed to map (a missing list, an
// entry that is not an object), so the mapping never throws.

import { isRecord } from "@/lib/shared/coerce";
import { compact, specImage, type FamilyContent, type OutlineImage } from "./family-document";

type Spec<F extends FamilyContent["family"]> = Extract<FamilyContent, { family: F }>;
export type ReportSpec = Spec<"report">;
export type LetterSpec = Spec<"letter">;
export type SheetSpec = Spec<"sheet">;
export type DrawingSpec = Spec<"drawing">;

type ReportBlock = NonNullable<ReportSpec["sections"][number]["blocks"]>[number];

function titleIssue(title: unknown, noun: string): string[] {
  return typeof title === "string" && title.trim() ? [] : [`title: a ${noun} needs a title`];
}

/** Each entry of a list must be an object before it can be mapped. */
function entryIssues(list: unknown[], path: string, expected: string): string[] {
  return list.flatMap((entry, index) => (isRecord(entry) ? [] : [`${path}.${index}: expected an object with ${expected}`]));
}

function notAnObject(outline: unknown, expected: string): string[] {
  return isRecord(outline) ? [] : [`(outline): expected an object with ${expected}`];
}

// ── Report ───────────────────────────────────────────────────────────────────

export type ReportOutlineSection = {
  heading: string;
  level?: 1 | 2 | 3;
  paragraphs?: string[];
  bullets?: string[];
  /** `{ columns, rows }`, rendered as a table with `tableCaption` under it. */
  table?: unknown;
  tableCaption?: string;
  /** `{ type, title?, categories, series: [{ name, values }] }`. */
  chart?: unknown;
  image?: OutlineImage;
  caption?: string;
  /** Start this section on a new page. */
  pageBreakBefore?: boolean;
  /** Explicit report blocks, in order, used as written after anything above. */
  blocks?: unknown[];
};

export type ReportOutline = {
  title: string;
  subtitle?: string;
  author?: string;
  audience?: string;
  /** What the reader should decide or do; it becomes the document subject. */
  purpose?: string;
  /** An executive summary, set as the opening "Summary" section. */
  summary?: string;
  documentId?: string;
  sections: ReportOutlineSection[];
};

export function reportOutlineIssues(outline: ReportOutline): string[] {
  const shape = notAnObject(outline, "a title and sections");
  if (shape.length > 0) return shape;
  const issues = titleIssue(outline.title, "report");
  if (!Array.isArray(outline.sections) || outline.sections.length === 0) {
    issues.push("sections: a report needs at least one section");
  } else {
    issues.push(...entryIssues(outline.sections, "sections", "a heading"));
  }
  return issues;
}

function sectionBlocks(section: ReportOutlineSection): ReportBlock[] {
  const blocks: unknown[] = [];
  if (section.pageBreakBefore) blocks.push({ kind: "page-break" });
  for (const text of section.paragraphs ?? []) blocks.push({ kind: "paragraph", text });
  if (section.bullets && section.bullets.length > 0) blocks.push({ kind: "bullets", items: section.bullets });
  if (section.table !== undefined) blocks.push(compact({ kind: "table", table: section.table, caption: section.tableCaption }));
  if (section.chart !== undefined) blocks.push({ kind: "chart", chart: section.chart });
  if (section.image) blocks.push(compact({ kind: "image", image: specImage(section.image), caption: section.caption }));
  blocks.push(...(Array.isArray(section.blocks) ? section.blocks : []));
  return blocks as ReportBlock[];
}

/**
 * The report spec for an outline: an optional "Summary" section, then one
 * report section per outline section, its paragraphs, bullets, table, chart
 * and image in that order. The audience and purpose become `{{audience}}` and
 * `{{purpose}}` for the brand master.
 */
export function outlineToReportSpec(outline: ReportOutline): ReportSpec {
  const fields = compact({ audience: outline.audience, purpose: outline.purpose });
  const summary = outline.summary?.trim()
    ? [{ heading: "Summary", level: 1 as const, blocks: [{ kind: "paragraph" as const, text: outline.summary }] }]
    : [];
  return compact({
    family: "report" as const,
    title: outline.title,
    subtitle: outline.subtitle,
    author: outline.author,
    subject: outline.purpose,
    fields: Object.keys(fields).length > 0 ? fields : undefined,
    sections: [
      ...summary,
      ...(outline.sections ?? []).map((section) =>
        compact({ heading: section.heading, level: section.level, blocks: sectionBlocks(section) }),
      ),
    ],
  }) as ReportSpec;
}

/** Report image blocks with a stored-image reference, resolved in place. */
export async function resolveReportImages(
  outline: ReportOutline,
  resolve: (image: OutlineImage | undefined, path: string) => Promise<OutlineImage | undefined>,
): Promise<ReportOutline> {
  const sections = await Promise.all(
    (outline.sections ?? []).map(async (section, index) =>
      section.image ? { ...section, image: await resolve(section.image, `sections.${index}.image`) } : section,
    ),
  );
  return { ...outline, sections };
}

// ── Letter ───────────────────────────────────────────────────────────────────

export type LetterParty = { name: string; lines?: string[] };

export type LetterOutline = {
  /** The document title; defaults to the subject, then "Letter to <recipient>". */
  title?: string;
  subject?: string;
  recipient: LetterParty;
  /** Usually left out: the brand master's letterhead carries the organization. */
  sender?: LetterParty;
  /** Defaults to today, written out in the letter's language. */
  date?: string;
  /** A language tag such as en or fr-CA; defaults to the organization's locale. */
  language?: string;
  reference?: string;
  /** Defaults to "Dear <recipient name>,". */
  salutation?: string;
  paragraphs: string[];
  /** Defaults to "Yours sincerely,". */
  closing?: string;
  signatureName: string;
  signatureTitle?: string;
  documentId?: string;
};

export function letterOutlineIssues(outline: LetterOutline): string[] {
  const shape = notAnObject(outline, "a recipient, paragraphs and a signatureName");
  if (shape.length > 0) return shape;
  const issues: string[] = [];
  if (!isRecord(outline.recipient)) issues.push("recipient: a letter needs a recipient with a name");
  if (!Array.isArray(outline.paragraphs) || outline.paragraphs.length === 0) {
    issues.push("paragraphs: a letter needs at least one paragraph");
  }
  if (typeof outline.signatureName !== "string") issues.push("signatureName: a letter needs the name it is signed with");
  if (outline.sender !== undefined && !isRecord(outline.sender)) issues.push("sender: expected an object with a name");
  return issues;
}

/** Today written out in the letter's language ("14 October 2026", "October 14, 2026"). */
function letterDate(now: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function party(value: LetterParty): LetterParty {
  return compact({ name: value.name, lines: value.lines });
}

/** `locale` is the organization's; a `language` on the outline wins. */
export function outlineToLetterSpec(outline: LetterOutline, now: Date, locale: string): LetterSpec {
  const recipientName = typeof outline.recipient?.name === "string" ? outline.recipient.name.trim() : "";
  return compact({
    family: "letter" as const,
    title: outline.title?.trim() || outline.subject?.trim() || `Letter to ${recipientName}`,
    subject: outline.subject,
    sender: outline.sender ? party(outline.sender) : undefined,
    recipient: party(outline.recipient),
    language: outline.language,
    date: outline.date?.trim() || letterDate(now, outline.language ?? locale),
    reference: outline.reference,
    salutation: outline.salutation?.trim() || `Dear ${recipientName},`,
    paragraphs: outline.paragraphs,
    closing: outline.closing?.trim() || "Yours sincerely,",
    signatureName: outline.signatureName,
    signatureTitle: outline.signatureTitle,
  }) as LetterSpec;
}

// ── Sheet ────────────────────────────────────────────────────────────────────

type SheetColumnFormat = "general" | "integer" | "decimal" | "currency" | "percent" | "date";

export type SheetOutlineTable = {
  /** Up to 31 characters; defaults to Sheet1, Sheet2, … */
  name?: string;
  columns: string[];
  /** Cells are text, numbers, true/false, null, or `{ formula: "=SUM(B2:B9)" }`. */
  rows: unknown[][];
  columnFormats?: SheetColumnFormat[];
  chart?: unknown;
};

export type SheetOutline = {
  title: string;
  documentId?: string;
  sheets?: SheetOutlineTable[];
} & Partial<Omit<SheetOutlineTable, "name">>;

function sheetTables(outline: SheetOutline): unknown[] | null {
  if (Array.isArray(outline.sheets)) return outline.sheets;
  if (Array.isArray(outline.columns)) {
    return [{ columns: outline.columns, rows: outline.rows ?? [], columnFormats: outline.columnFormats, chart: outline.chart }];
  }
  return null;
}

export function sheetOutlineIssues(outline: SheetOutline): string[] {
  const shape = notAnObject(outline, "a title and sheets");
  if (shape.length > 0) return shape;
  const issues = titleIssue(outline.title, "sheet");
  const tables = sheetTables(outline);
  if (!tables || tables.length === 0) {
    issues.push("sheets: a sheet needs at least one table (sheets, or columns and rows)");
  } else {
    issues.push(...entryIssues(tables, "sheets", "columns and rows"));
  }
  return issues;
}

/** The sheet spec: one spec sheet per outline table; a single top-level table is a one-sheet workbook. */
export function outlineToSheetSpec(outline: SheetOutline): SheetSpec {
  const tables = (sheetTables(outline) ?? []) as SheetOutlineTable[];
  return compact({
    family: "sheet" as const,
    title: outline.title,
    sheets: tables.map((table, index) =>
      compact({
        name: table.name?.trim() || `Sheet${index + 1}`,
        columns: table.columns,
        rows: table.rows,
        columnFormats: table.columnFormats,
        chart: table.chart,
      }),
    ),
  }) as SheetSpec;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

type ShapeKind = "rect" | "rounded-rect" | "ellipse" | "diamond" | "text";

export type DrawingOutlineShape = {
  id: string;
  label?: string;
  /** Defaults to rect. */
  kind?: ShapeKind;
  /** Millimetres from the page's top left. Omit both to place the shape on the grid. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  textColour?: string;
};

export type DrawingOutlineConnector = { from: string; to: string; label?: string; stroke?: string };

export type DrawingOutlinePage = { name?: string; shapes: DrawingOutlineShape[]; connectors?: DrawingOutlineConnector[] };

export type DrawingOutline = {
  title: string;
  documentId?: string;
  pages?: DrawingOutlinePage[];
  /** A single page written at the top level. */
  shapes?: DrawingOutlineShape[];
  connectors?: DrawingOutlineConnector[];
};

/** Grid for shapes with no position: four per row in reading order, in millimetres. */
export const DRAWING_GRID = { columns: 4, originX: 20, originY: 30, stepX: 75, stepY: 45, width: 50, height: 25 } as const;

function drawingPages(outline: DrawingOutline): unknown[] | null {
  if (Array.isArray(outline.pages)) return outline.pages;
  if (Array.isArray(outline.shapes)) return [{ shapes: outline.shapes, connectors: outline.connectors }];
  return null;
}

export function drawingOutlineIssues(outline: DrawingOutline): string[] {
  const shape = notAnObject(outline, "a title and pages");
  if (shape.length > 0) return shape;
  const issues = titleIssue(outline.title, "drawing");
  const pages = drawingPages(outline);
  if (!pages || pages.length === 0) {
    issues.push("pages: a drawing needs at least one page (pages, or shapes)");
    return issues;
  }
  pages.forEach((page, index) => {
    if (!isRecord(page)) {
      issues.push(`pages.${index}: expected an object with shapes`);
    } else if (!Array.isArray(page.shapes)) {
      issues.push(`pages.${index}.shapes: expected a list of shapes`);
    } else {
      issues.push(...entryIssues(page.shapes, `pages.${index}.shapes`, "an id"));
      if (page.connectors !== undefined && !Array.isArray(page.connectors)) {
        issues.push(`pages.${index}.connectors: expected a list of connectors`);
      }
    }
  });
  return issues;
}

function placeShape(shape: DrawingOutlineShape, gridIndex: number) {
  const unplaced = shape.x === undefined && shape.y === undefined;
  const column = gridIndex % DRAWING_GRID.columns;
  const row = Math.floor(gridIndex / DRAWING_GRID.columns);
  return compact({
    id: shape.id,
    kind: shape.kind ?? "rect",
    x: unplaced ? DRAWING_GRID.originX + column * DRAWING_GRID.stepX : shape.x,
    y: unplaced ? DRAWING_GRID.originY + row * DRAWING_GRID.stepY : shape.y,
    width: shape.width ?? DRAWING_GRID.width,
    height: shape.height ?? DRAWING_GRID.height,
    label: shape.label,
    fill: shape.fill,
    stroke: shape.stroke,
    textColour: shape.textColour,
  });
}

/** The drawing spec: shapes keep the positions they were given; the rest go on the grid in order. */
export function outlineToDrawingSpec(outline: DrawingOutline): DrawingSpec {
  const pages = (drawingPages(outline) ?? []) as DrawingOutlinePage[];
  return compact({
    family: "drawing" as const,
    title: outline.title,
    pages: pages.map((page) => {
      let gridIndex = 0;
      const shapes = page.shapes.map((shape) => {
        const unplaced = shape.x === undefined && shape.y === undefined;
        return placeShape(shape, unplaced ? gridIndex++ : 0);
      });
      return compact({ name: page.name, shapes, connectors: page.connectors ?? [] });
    }),
  }) as DrawingSpec;
}
