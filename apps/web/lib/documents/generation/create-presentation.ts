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
// Expected failures come back typed (ActionResult); this never throws for them.

import { prisma } from "@dpf/db";
import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { renderDocument, type RenderDocumentRequest, type RenderResult, type RenderedDocument } from "./render";
import { saveRenderedDocument, type SavedRender } from "./render-store";
import { MAX_IMAGE_BYTES, validateRenderRequest, type RenderFormat, type RenderRequestInput } from "./spec";

export const PRESENTATION_DOCUMENT_KIND = "generated-deck";
export const PRESENTATION_FORMATS: RenderFormat[] = ["pptx", "pdf"];
/** Slide previews are thumbnails on the document page; 72 dpi keeps a 10-inch slide at 720 px. */
export const PRESENTATION_PREVIEW_DPI = 72;
export const MAX_PRESENTATION_SLIDES = 100;

type ImageMime = "image/png" | "image/jpeg" | "image/gif";
const IMAGE_MIMES: readonly string[] = ["image/png", "image/jpeg", "image/gif"];

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
  image?: { documentId?: string; data?: string; mimeType?: string; alt: string };
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

export type CreatePresentationDeps = {
  render?: (request: RenderDocumentRequest) => Promise<RenderResult>;
  save?: (
    rendered: RenderedDocument,
    target: { organizationId: string; documentId?: string | null; tags?: string[]; actorPrincipalId?: string | null },
  ) => Promise<SavedRender>;
  loadDocument?: (documentId: string) => Promise<{ documentKind: string; organizationId: string } | null>;
  /** A stored image's bytes as base64, or null when the document is not a PNG, JPEG or GIF. */
  loadImage?: (documentId: string) => Promise<{ data: string; mimeType: ImageMime } | null>;
  resolveOrganizationId?: () => Promise<string>;
};

const fail = (reason: CreatePresentationFailureReason, error: string): CreatePresentationResult => ({ ok: false, error, reason });

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")) as T;
}

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
        image: slide.image ? compact({ data: slide.image.data, mimeType: slide.image.mimeType, alt: slide.image.alt }) : undefined,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** Replace stored-image references with their bytes; name every slide whose reference is not an image. */
async function resolveImages(
  outline: PresentationOutline,
  loadImage: NonNullable<CreatePresentationDeps["loadImage"]>,
): Promise<{ outline: PresentationOutline; issues: string[] }> {
  const issues: string[] = [];
  const slides = await Promise.all(
    outline.slides.map(async (slide, index) => {
      const ref = slide.image?.documentId?.trim();
      if (!slide.image || !ref || slide.image.data) return slide;
      const image = await loadImage(ref).catch(() => null);
      if (!image) {
        issues.push(`slides.${index}.image.documentId: ${ref} is not a stored PNG, JPEG or GIF image`);
        return slide;
      }
      return { ...slide, image: { ...slide.image, data: image.data, mimeType: image.mimeType } };
    }),
  );
  return { outline: { ...outline, slides }, issues };
}

const RENDER_FAILURE_COPY: Record<Exclude<CreatePresentationFailureReason, "invalid-outline" | "document-not-found" | "not-a-presentation">, string> = {
  "converter-unavailable": "Presentations cannot be produced right now: the document engine is not available on this install. Nothing was saved.",
  "input-too-large": "The presentation is too large to produce (usually its images). Use fewer or smaller images. Nothing was saved.",
  timeout: "Producing the presentation took too long. Try fewer slides or smaller images. Nothing was saved.",
  "render-failed": "The document engine could not produce the presentation. Nothing was saved.",
};

async function defaultLoadDocument(documentId: string) {
  return prisma.document.findUnique({ where: { documentId }, select: { documentKind: true, organizationId: true } });
}

async function defaultLoadImage(documentId: string): Promise<{ data: string; mimeType: ImageMime } | null> {
  const document = await prisma.document.findUnique({
    where: { documentId },
    select: {
      currentVersion: {
        select: { contentFormat: true, contentBlob: { select: { storageKey: true, sha256: true, mimeType: true, sizeBytes: true } } },
      },
    },
  });
  const blob = document?.currentVersion?.contentBlob;
  const mimeType = (blob?.mimeType ?? document?.currentVersion?.contentFormat ?? "").split(";")[0]!.trim().toLowerCase();
  if (!blob || !IMAGE_MIMES.includes(mimeType) || blob.sizeBytes > MAX_IMAGE_BYTES) return null;
  const { readDocumentBlob } = await import("@/lib/documents/blob-storage");
  const bytes = await readDocumentBlob({ storageKey: blob.storageKey, expectedSha256: blob.sha256 });
  return { data: bytes.toString("base64"), mimeType: mimeType as ImageMime };
}

async function defaultResolveOrganizationId(): Promise<string> {
  const { resolveDocumentOrganizationId } = await import("@/lib/documents/document-store");
  return resolveDocumentOrganizationId();
}

export async function createPresentation(
  input: { outline: PresentationOutline; actorPrincipalId?: string | null },
  deps: CreatePresentationDeps = {},
): Promise<CreatePresentationResult> {
  const shapeIssues = outlineShapeIssues(input.outline);
  if (shapeIssues.length > 0) return fail("invalid-outline", `The outline is invalid: ${shapeIssues.join("; ")}`);

  const revising = input.outline.documentId?.trim() || null;
  let organizationId: string;
  try {
    if (revising) {
      const existing = await (deps.loadDocument ?? defaultLoadDocument)(revising);
      if (!existing) return fail("document-not-found", `There is no document ${revising} to revise.`);
      if (existing.documentKind !== PRESENTATION_DOCUMENT_KIND) {
        return fail(
          "not-a-presentation",
          `${revising} is a ${existing.documentKind}, not a presentation made with create_presentation. Omit documentId to create a new presentation.`,
        );
      }
      organizationId = existing.organizationId;
    } else {
      organizationId = await (deps.resolveOrganizationId ?? defaultResolveOrganizationId)();
    }
  } catch (error) {
    return fail("render-failed", `The presentation could not be prepared: ${getErrorMessage(error)}`);
  }

  const resolved = await resolveImages(input.outline, deps.loadImage ?? defaultLoadImage);
  const content = outlineToDeckSpec(resolved.outline);
  const request = {
    content,
    formats: PRESENTATION_FORMATS,
    previews: { maxPages: content.slides.length, dpi: PRESENTATION_PREVIEW_DPI },
  };
  const validated = validateRenderRequest(request);
  const specIssues = validated.ok
    ? []
    : validated.issues.map((issue) => `${issue.path.replace(/^content\./, "") || "(outline)"}: ${issue.message}`);
  const issues = [...resolved.issues, ...specIssues];
  if (issues.length > 0) {
    const shown = issues.slice(0, 6);
    const more = issues.length > shown.length ? `; and ${issues.length - shown.length} more` : "";
    return fail("invalid-outline", `The outline is invalid: ${shown.join("; ")}${more}`);
  }

  const rendered = await (deps.render ?? renderDocument)({
    ...request,
    templateRef: { kind: "brand-master", organizationId },
  });
  if (!rendered.ok) {
    const reason = rendered.reason === "invalid-spec" ? "render-failed" : rendered.reason;
    return fail(reason, `${RENDER_FAILURE_COPY[reason]} (${rendered.error})`);
  }

  let saved: SavedRender;
  try {
    saved = await (deps.save ?? saveRenderedDocument)(rendered.data, {
      organizationId,
      documentId: revising,
      tags: ["presentation"],
      actorPrincipalId: input.actorPrincipalId ?? null,
    });
  } catch (error) {
    return fail("render-failed", `The presentation was produced but could not be saved: ${getErrorMessage(error)}`);
  }

  return ok({
    documentId: saved.documentId,
    versionId: saved.versionId,
    version: saved.version,
    revised: revising !== null,
    slideCount: content.slides.length,
    previewCount: saved.previews.length,
    formats: rendered.data.files.map((file) => file.format),
    route: `/workspace/documents/${encodeURIComponent(saved.documentId)}`,
    warnings: rendered.data.warnings,
  });
}
