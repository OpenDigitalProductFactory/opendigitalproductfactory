// One pipeline for every "outline in, branded document out" coworker tool
// (BI-012487AA, slice A4; extracted from create_presentation, BI-543819B1).
//
// Each family tool (create_presentation, create_report, create_letter,
// create_sheet, create_drawing) owns only its OUTLINE: the shape a coworker
// writes and how it maps onto that family's content spec (spec.ts). Everything
// after the mapping is the same for all five and lives here:
//
//   1. the outline's own shape is checked (the family's issues);
//   2. the organization is resolved; a revision must name a document of this
//      family's generated kind IN THAT organization (tenant isolation: another
//      organization's document is "not found", never revealed);
//   3. stored images are loaded from the same organization only;
//   4. the spec is validated with field paths BEFORE any container runs;
//   5. renderDocument lays it out in the organization's brand master;
//   6. saveRenderedDocument stores the office file, its PDF and the page
//      previews as a managed Document, or as the next DocumentVersion.
//
// Expected failures come back typed (ActionResult); this never throws for them.

import { prisma } from "@dpf/db";
import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { renderDocument, type RenderDocumentRequest, type RenderResult, type RenderedDocument } from "./render";
import { saveRenderedDocument, type SavedRender } from "./render-store";
import { MAX_IMAGE_BYTES, validateRenderRequest, type DocumentFamily, type RenderFormat, type RenderRequestInput } from "./spec";

export type ImageMime = "image/png" | "image/jpeg" | "image/gif";
const IMAGE_MIMES: readonly string[] = ["image/png", "image/jpeg", "image/gif"];

/** A stored image (`documentId`) or inline base64 (`data` + `mimeType`), always with alt text. */
export type OutlineImage = { documentId?: string; data?: string; mimeType?: string; alt: string };

export type FamilyContent = RenderRequestInput["content"];

/** What a family tool fixes about its documents. */
export type FamilyProfile = {
  family: DocumentFamily;
  /** Singular and plural nouns for messages: "report", "reports". */
  noun: string;
  plural: string;
  toolName: string;
  formats: RenderFormat[];
  previewDpi: number;
  /** What usually makes this family too large or too slow, as a plural ("rows or charts"). */
  sizeHint: string;
};

export type FamilyDocumentFailureReason =
  | "invalid-outline"
  | "document-not-found"
  | "wrong-document-kind"
  | "converter-unavailable"
  | "input-too-large"
  | "timeout"
  | "render-failed";

export type CreatedFamilyDocument = {
  documentId: string;
  versionId: string;
  version: number;
  revised: boolean;
  pageCount: number;
  previewCount: number;
  formats: RenderFormat[];
  route: string;
  warnings: string[];
};

export type FamilyDocumentResult =
  | ActionSuccess<CreatedFamilyDocument>
  | (ActionFailure & { reason: FamilyDocumentFailureReason });

export type FamilyDocumentDeps = {
  render?: (request: RenderDocumentRequest) => Promise<RenderResult>;
  save?: (
    rendered: RenderedDocument,
    target: { organizationId: string; documentId?: string | null; tags?: string[]; actorPrincipalId?: string | null },
  ) => Promise<SavedRender>;
  loadDocument?: (documentId: string) => Promise<{ documentKind: string; organizationId: string } | null>;
  /** A stored image's bytes as base64, or null when it is not a PNG, JPEG or GIF of this organization. */
  loadImage?: (documentId: string, organizationId: string) => Promise<{ data: string; mimeType: ImageMime } | null>;
  /** The caller's organization (the install organization). */
  resolveOrganizationId?: () => Promise<string>;
  now?: () => Date;
  /** The organization's locale, for text the platform writes (a letter's date). */
  resolveLocale?: () => Promise<string>;
};

/** Resolves one outline image at a field path; records an issue when the reference is not a stored image. */
export type ImageResolver = (image: OutlineImage | undefined, path: string) => Promise<OutlineImage | undefined>;

export type FamilyDocumentInput<C extends FamilyContent> = {
  profile: FamilyProfile;
  documentId?: string | null;
  actorPrincipalId?: string | null;
  /** Problems with the outline's own shape; any one stops before the organization is touched. */
  shapeIssues: string[];
  /** The family's mapping from its outline to its content spec. */
  buildContent: (resolveImage: ImageResolver) => Promise<C> | C;
  /** How many preview pages to ask for, given the built content. */
  previewPages: (content: C) => number;
};

const fail = (reason: FamilyDocumentFailureReason, error: string): FamilyDocumentResult => ({ ok: false, error, reason });

/** Drop undefined and empty-string entries so the spec carries only what the outline said. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")) as T;
}

/** The spec image for an outline image: inline bytes as given, alt text always. */
export function specImage(image: OutlineImage | undefined) {
  return image ? compact({ data: image.data, mimeType: image.mimeType, alt: image.alt }) : undefined;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderFailureCopy(profile: FamilyProfile, reason: Exclude<FamilyDocumentFailureReason, "invalid-outline" | "document-not-found" | "wrong-document-kind">): string {
  switch (reason) {
    case "converter-unavailable":
      return `${sentence(profile.plural)} cannot be produced right now: the document engine is not available on this install. Nothing was saved.`;
    case "input-too-large":
      return `The ${profile.noun} is too large to produce (usually too many ${profile.sizeHint}). Make it smaller. Nothing was saved.`;
    case "timeout":
      return `Producing the ${profile.noun} took too long. Try fewer ${profile.sizeHint}. Nothing was saved.`;
    case "render-failed":
      return `The document engine could not produce the ${profile.noun}. Nothing was saved.`;
  }
}

async function defaultLoadDocument(documentId: string) {
  return prisma.document.findUnique({ where: { documentId }, select: { documentKind: true, organizationId: true } });
}

async function defaultLoadImage(documentId: string, organizationId: string): Promise<{ data: string; mimeType: ImageMime } | null> {
  const document = await prisma.document.findFirst({
    where: { documentId, organizationId },
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

function imageResolver(
  organizationId: string,
  loadImage: NonNullable<FamilyDocumentDeps["loadImage"]>,
  issues: string[],
): ImageResolver {
  return async (image, path) => {
    const ref = image?.documentId?.trim();
    if (!image || !ref || image.data) return image;
    const stored = await loadImage(ref, organizationId).catch(() => null);
    if (!stored) {
      issues.push(`${path}.documentId: ${ref} is not a stored PNG, JPEG or GIF image`);
      return image;
    }
    return { ...image, data: stored.data, mimeType: stored.mimeType };
  };
}

function issueList(issues: string[]): string {
  const shown = issues.slice(0, 6);
  const more = issues.length > shown.length ? `; and ${issues.length - shown.length} more` : "";
  return `The outline is invalid: ${shown.join("; ")}${more}`;
}

export async function createFamilyDocument<C extends FamilyContent>(
  input: FamilyDocumentInput<C>,
  deps: FamilyDocumentDeps = {},
): Promise<FamilyDocumentResult> {
  const { profile } = input;
  if (input.shapeIssues.length > 0) return fail("invalid-outline", issueList(input.shapeIssues));

  const revising = input.documentId?.trim() || null;
  let organizationId: string;
  try {
    organizationId = await (deps.resolveOrganizationId ?? defaultResolveOrganizationId)();
    if (revising) {
      const existing = await (deps.loadDocument ?? defaultLoadDocument)(revising);
      if (!existing || existing.organizationId !== organizationId) {
        return fail("document-not-found", `There is no document ${revising} to revise.`);
      }
      if (existing.documentKind !== `generated-${profile.family}`) {
        return fail(
          "wrong-document-kind",
          `${revising} is a ${existing.documentKind}, not a ${profile.noun} made with ${profile.toolName}. Omit documentId to create a new ${profile.noun}.`,
        );
      }
    }
  } catch (error) {
    return fail("render-failed", `The ${profile.noun} could not be prepared: ${getErrorMessage(error)}`);
  }

  const imageIssues: string[] = [];
  const content = await input.buildContent(imageResolver(organizationId, deps.loadImage ?? defaultLoadImage, imageIssues));
  const request = {
    content,
    formats: profile.formats,
    previews: { maxPages: Math.min(Math.max(input.previewPages(content), 1), 100), dpi: profile.previewDpi },
  };
  const validated = validateRenderRequest(request);
  const specIssues = validated.ok
    ? []
    : validated.issues.map((issue) => `${issue.path.replace(/^content\.?/, "") || "(outline)"}: ${issue.message}`);
  const issues = [...imageIssues, ...specIssues];
  if (issues.length > 0) return fail("invalid-outline", issueList(issues));

  const rendered = await (deps.render ?? renderDocument)({ ...request, templateRef: { kind: "brand-master", organizationId } });
  if (!rendered.ok) {
    const reason = rendered.reason === "invalid-spec" ? "render-failed" : rendered.reason;
    return fail(reason, `${renderFailureCopy(profile, reason)} (${rendered.error})`);
  }

  let saved: SavedRender;
  try {
    saved = await (deps.save ?? saveRenderedDocument)(rendered.data, {
      organizationId,
      documentId: revising,
      tags: [profile.family === "deck" ? "presentation" : profile.family],
      actorPrincipalId: input.actorPrincipalId ?? null,
    });
  } catch (error) {
    return fail("render-failed", `The ${profile.noun} was produced but could not be saved: ${getErrorMessage(error)}`);
  }

  return ok({
    documentId: saved.documentId,
    versionId: saved.versionId,
    version: saved.version,
    revised: revising !== null,
    pageCount: rendered.data.pageCount,
    previewCount: saved.previews.length,
    formats: rendered.data.files.map((file) => file.format),
    route: `/workspace/documents/${encodeURIComponent(saved.documentId)}`,
    warnings: rendered.data.warnings,
  });
}
