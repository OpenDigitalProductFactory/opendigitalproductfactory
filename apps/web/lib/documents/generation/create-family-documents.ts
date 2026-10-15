// create_report, create_letter, create_sheet, create_drawing: a coworker's
// outline becomes a branded office document (BI-012487AA, slice A4).
//
// Each tool is a profile (formats, preview size, wording) plus its outline
// mapping (family-outlines.ts) over the shared pipeline (family-document.ts),
// the same one create_presentation runs on. Revising is regenerating: send the
// whole outline again with the documentId and the result is the next
// DocumentVersion of the same Document.

import {
  createFamilyDocument,
  type FamilyDocumentDeps,
  type FamilyDocumentResult,
  type FamilyProfile,
} from "./family-document";
import {
  drawingOutlineIssues,
  letterOutlineIssues,
  outlineToDrawingSpec,
  outlineToLetterSpec,
  outlineToReportSpec,
  outlineToSheetSpec,
  reportOutlineIssues,
  resolveReportImages,
  sheetOutlineIssues,
  type DrawingOutline,
  type LetterOutline,
  type ReportOutline,
  type SheetOutline,
} from "./family-outlines";

/** Document previews are thumbnails on the document page; 72 dpi keeps an A4 page near 600 px. */
const PREVIEW_DPI = 72;

export const REPORT_PROFILE: FamilyProfile = {
  family: "report",
  noun: "report",
  plural: "reports",
  toolName: "create_report",
  formats: ["docx", "pdf"],
  previewDpi: PREVIEW_DPI,
  sizeHint: "sections, tables or images",
};

export const LETTER_PROFILE: FamilyProfile = {
  family: "letter",
  noun: "letter",
  plural: "letters",
  toolName: "create_letter",
  formats: ["docx", "pdf"],
  previewDpi: PREVIEW_DPI,
  sizeHint: "paragraphs",
};

export const SHEET_PROFILE: FamilyProfile = {
  family: "sheet",
  noun: "sheet",
  plural: "sheets",
  toolName: "create_sheet",
  formats: ["xlsx", "pdf"],
  previewDpi: PREVIEW_DPI,
  sizeHint: "rows or sheets",
};

export const DRAWING_PROFILE: FamilyProfile = {
  family: "drawing",
  noun: "drawing",
  plural: "drawings",
  toolName: "create_drawing",
  // The .svg is the drawing a web page or another document can embed.
  formats: ["odg", "svg", "pdf"],
  previewDpi: PREVIEW_DPI,
  sizeHint: "pages or shapes",
};

/** A report previews its first 20 pages, a letter its first 3, a workbook its first 10 printed pages. */
const PREVIEW_PAGES = { report: 20, letter: 3, sheet: 10 } as const;

type CreateInput<O> = { outline: O; actorPrincipalId?: string | null };

export function createReport(input: CreateInput<ReportOutline>, deps: FamilyDocumentDeps = {}): Promise<FamilyDocumentResult> {
  return createFamilyDocument(
    {
      profile: REPORT_PROFILE,
      documentId: input.outline?.documentId,
      actorPrincipalId: input.actorPrincipalId,
      shapeIssues: reportOutlineIssues(input.outline),
      buildContent: async (resolveImage) => outlineToReportSpec(await resolveReportImages(input.outline, resolveImage)),
      previewPages: () => PREVIEW_PAGES.report,
    },
    deps,
  );
}

export function createLetter(input: CreateInput<LetterOutline>, deps: FamilyDocumentDeps = {}): Promise<FamilyDocumentResult> {
  return createFamilyDocument(
    {
      profile: LETTER_PROFILE,
      documentId: input.outline?.documentId,
      actorPrincipalId: input.actorPrincipalId,
      shapeIssues: letterOutlineIssues(input.outline),
      buildContent: () => outlineToLetterSpec(input.outline, (deps.now ?? (() => new Date()))()),
      previewPages: () => PREVIEW_PAGES.letter,
    },
    deps,
  );
}

export function createSheet(input: CreateInput<SheetOutline>, deps: FamilyDocumentDeps = {}): Promise<FamilyDocumentResult> {
  return createFamilyDocument(
    {
      profile: SHEET_PROFILE,
      documentId: input.outline?.documentId,
      actorPrincipalId: input.actorPrincipalId,
      shapeIssues: sheetOutlineIssues(input.outline),
      buildContent: () => outlineToSheetSpec(input.outline),
      previewPages: () => PREVIEW_PAGES.sheet,
    },
    deps,
  );
}

export function createDrawing(input: CreateInput<DrawingOutline>, deps: FamilyDocumentDeps = {}): Promise<FamilyDocumentResult> {
  return createFamilyDocument(
    {
      profile: DRAWING_PROFILE,
      documentId: input.outline?.documentId,
      actorPrincipalId: input.actorPrincipalId,
      shapeIssues: drawingOutlineIssues(input.outline),
      buildContent: () => outlineToDrawingSpec(input.outline),
      // One preview per drawing page.
      previewPages: (content) => content.pages.length,
    },
    deps,
  );
}
