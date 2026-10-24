// create_presentation: a coworker's outline becomes a branded deck
// (BI-543819B1, slice S7 of BI-815D40C6).
//
// The coworker writes an OUTLINE: a title, the audience and goal, and slides
// with a title and whatever each slide carries (bullets, a chart, a table, an
// image, speaker notes). This module maps it onto S6's deck spec, lays it out
// inside the organization's brand master on the dpf-doctools engine, and stores
// the .pptx, its PDF and one PNG preview per slide as a managed Document.
//
// Revising is regenerating: the coworker sends the whole outline again with the
// presentation's documentId, and the result is the next DocumentVersion of the
// same Document. Nobody edits the office file's XML.
//
// Everything after the outline-to-spec mapping (organization and revision
// checks, image loading, validation, render, save) is the shared pipeline in
// family-document.ts, which the report, letter, sheet and drawing tools also
// run on (BI-012487AA).
//
// Expected failures come back typed (ActionResult); this never throws for them.

import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";
import { isRecord } from "@/lib/shared/coerce";
import {
  compact,
  createFamilyDocument,
  specImage,
  type FamilyDocumentDeps,
  type FamilyProfile,
  type OutlineImage,
} from "./family-document";
import type { RenderFormat, RenderRequestInput } from "./spec";

export const PRESENTATION_DOCUMENT_KIND = "generated-deck";
export const PRESENTATION_FORMATS: RenderFormat[] = ["pptx", "pdf"];
/** Slide previews are thumbnails on the document page; 72 dpi keeps a 10-inch slide at 720 px. */
export const PRESENTATION_PREVIEW_DPI = 72;
export const MAX_PRESENTATION_SLIDES = 100;

export type SlideLayout = "title" | "section" | "bullets" | "chart" | "image" | "table";

export type OutlineSlide = {
  title: string;
  layout?: SlideLayout;
  subtitle?: string;
  bullets?: string[];
  notes?: string;
  /** Passed to the deck spec as-is: `{ type, title?, categories, series: [{ name, values }] }`. */
  chart?: unknown;
  /** Passed to the deck spec as-is: `{ columns, rows }`. */
  table?: unknown;
  /** A stored image (`documentId`) or inline base64 (`data` + `mimeType`), always with alt text. */
  image?: OutlineImage;
  caption?: string;
};

export type PresentationOutline = {
  title: string;
  subtitle?: string;
  audience?: string;
  goal?: string;
  /** An existing presentation to revise; its next version is written. */
  documentId?: string;
  slides: OutlineSlide[];
};

type DeckSpec = Extract<RenderRequestInput["content"], { family: "deck" }>;
type DeckSlide = DeckSpec["slides"][number];

export type CreatePresentationFailureReason =
  | "invalid-outline"
  | "document-not-found"
  | "not-a-presentation"
  | "converter-unavailable"
  | "input-too-large"
  | "timeout"
  | "render-failed";

export type CreatedPresentation = {
  documentId: string;
  versionId: string;
  version: number;
  revised: boolean;
  slideCount: number;
  previewCount: number;
  formats: RenderFormat[];
  route: string;
  warnings: string[];
};

export type CreatePresentationResult =
  | ActionSuccess<CreatedPresentation>
  | (ActionFailure & { reason: CreatePresentationFailureReason });

/** The shared pipeline's seams (render, save, document and image loading, organization). */
export type CreatePresentationDeps = FamilyDocumentDeps;

export const PRESENTATION_PROFILE: FamilyProfile = {
  family: "deck",
  noun: "presentation",
  plural: "presentations",
  toolName: "create_presentation",
  formats: PRESENTATION_FORMATS,
  previewDpi: PRESENTATION_PREVIEW_DPI,
  sizeHint: "slides or images",
};

function layoutOf(slide: OutlineSlide, index: number): SlideLayout {
  if (slide.layout) return slide.layout;
  if (slide.chart) return "chart";
  if (slide.table) return "table";
  if (slide.image) return "image";
  if (slide.bullets && slide.bullets.length > 0) return "bullets";
  return index === 0 ? "title" : "section";
}

function toDeckSlide(slide: OutlineSlide, index: number, outline: PresentationOutline): DeckSlide {
  const layout = layoutOf(slide, index);
  const base = { title: slide.title, notes: slide.notes };
  switch (layout) {
    case "title":
    case "section":
      return compact({ layout, ...base, subtitle: slide.subtitle ?? (index === 0 ? outline.subtitle : undefined) }) as DeckSlide;
    case "bullets":
      return compact({ layout, ...base, bullets: slide.bullets ?? [] }) as DeckSlide;
    case "chart":
      return compact({ layout, ...base, chart: slide.chart }) as DeckSlide;
    case "table":
      return compact({ layout, ...base, table: slide.table }) as DeckSlide;
    case "image":
      return compact({
        layout,
        ...base,
        image: specImage(slide.image),
        caption: slide.caption,
      }) as DeckSlide;
  }
}

/**
 * The deck spec for an outline: one deck slide per outline slide, in order.
 * A slide's layout is inferred from what it carries unless it names one; an
 * opening slide with nothing else is the title slide and later ones are
 * section dividers. The audience and goal become `{{audience}}` and `{{goal}}`.
 */
export function outlineToDeckSpec(outline: PresentationOutline): DeckSpec {
  const fields = compact({ audience: outline.audience, goal: outline.goal });
  return compact({
    family: "deck" as const,
    title: outline.title,
    subject: outline.goal,
    fields: Object.keys(fields).length > 0 ? fields : undefined,
    slides: (outline.slides ?? []).map((slide, index) => toDeckSlide(slide, index, outline)),
  }) as DeckSpec;
}

/** The outline's own shape; each slide's content is checked by the deck spec. */
function outlineShapeIssues(outline: PresentationOutline): string[] {
  const issues: string[] = [];
  if (!isRecord(outline)) return ["(outline): expected an object with a title and slides"];
  if (typeof outline.title !== "string" || !outline.title.trim()) issues.push("title: a presentation needs a title");
  if (!Array.isArray(outline.slides) || outline.slides.length === 0) {
    issues.push("slides: a presentation needs at least one slide");
  } else if (outline.slides.length > MAX_PRESENTATION_SLIDES) {
    issues.push(`slides: at most ${MAX_PRESENTATION_SLIDES} slides`);
  } else {
    outline.slides.forEach((slide, index) => {
      if (!isRecord(slide)) issues.push(`slides.${index}: expected an object with a title`);
    });
  }
  return issues;
}

export async function createPresentation(
  input: { outline: PresentationOutline; actorPrincipalId?: string | null },
  deps: CreatePresentationDeps = {},
): Promise<CreatePresentationResult> {
  const { outline } = input;
  let slideCount = 0;
  const result = await createFamilyDocument(
    {
      profile: PRESENTATION_PROFILE,
      documentId: outline?.documentId,
      actorPrincipalId: input.actorPrincipalId,
      shapeIssues: outlineShapeIssues(outline),
      buildContent: async (resolveImage) => {
        const slides = await Promise.all(
          outline.slides.map(async (slide, index) =>
            slide.image ? { ...slide, image: await resolveImage(slide.image, `slides.${index}.image`) } : slide,
          ),
        );
        const content = outlineToDeckSpec({ ...outline, slides });
        slideCount = content.slides.length;
        return content;
      },
      previewPages: (content) => content.slides.length,
    },
    deps,
  );
  if (!result.ok) {
    return { ok: false, error: result.error, reason: result.reason === "wrong-document-kind" ? "not-a-presentation" : result.reason };
  }
  const { pageCount: _pageCount, ...created } = result.data;
  return ok({ ...created, slideCount });
}
