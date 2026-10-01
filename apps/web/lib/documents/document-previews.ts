// Slide and page previews on the document page (BI-543819B1, slice S7).
//
// A generated document's version carries a `preview` rendition whose blob is a
// manifest of one PNG per page (preview-manifest.ts). The page lists the pages;
// GET /api/documents/:documentId/previews/:page serves one image. The route
// owns the session check; this resolves what to send and never throws for an
// expected miss.

import { prisma } from "@dpf/db";
import { readDocumentBlob } from "./blob-storage";
import { contentFilename, type DocumentContentResult } from "./document-content";
import { parsePreviewManifest, type PreviewManifest } from "./preview-manifest";
import { err, ok } from "@/lib/shared/action-result";

type BlobRef = { storageKey: string; sha256: string };

export type DocumentPreviewDeps = {
  db: Pick<typeof prisma, "document" | "documentRendition" | "documentBlob">;
  readBlob: (blob: BlobRef) => Promise<Buffer>;
};

const defaultDeps = (): DocumentPreviewDeps => ({
  db: prisma,
  readBlob: (blob) => readDocumentBlob({ storageKey: blob.storageKey, expectedSha256: blob.sha256 }),
});

const missing = (error: string): DocumentContentResult => ({ ...err(error), status: 404 });

async function loadManifest(documentVersionId: string, deps: DocumentPreviewDeps): Promise<PreviewManifest | null> {
  const rendition = (await deps.db.documentRendition.findUnique({
    where: { documentVersionId_renditionKind: { documentVersionId, renditionKind: "preview" } },
    select: { blob: { select: { storageKey: true, sha256: true } } },
  })) as { blob: BlobRef | null } | null;
  if (!rendition?.blob) return null;
  try {
    return parsePreviewManifest(await deps.readBlob(rendition.blob));
  } catch {
    return null;
  }
}

/** The version's preview page numbers in order; empty when it has none. */
export async function loadPreviewPages(documentVersionId: string, deps: DocumentPreviewDeps = defaultDeps()): Promise<number[]> {
  const manifest = await loadManifest(documentVersionId, deps).catch(() => null);
  return manifest?.pages.map((page) => page.page) ?? [];
}

export async function resolvePreviewImage(
  input: { documentId: string; page: number; version?: number | null },
  deps: DocumentPreviewDeps = defaultDeps(),
): Promise<DocumentContentResult> {
  const pinned = typeof input.version === "number" && Number.isInteger(input.version);
  const document = (await deps.db.document.findUnique({
    where: { documentId: input.documentId },
    select: pinned
      ? { title: true, versions: { where: { version: input.version! }, take: 1, select: { id: true } } }
      : { title: true, currentVersion: { select: { id: true } } },
  })) as { title: string; currentVersion?: { id: string } | null; versions?: Array<{ id: string }> } | null;
  if (!document) return missing("Document not found.");
  const version = pinned ? document.versions?.[0] : document.currentVersion;
  if (!version) return missing("Document version not found.");

  const manifest = await loadManifest(version.id, deps);
  const entry = manifest?.pages.find((page) => page.page === input.page);
  if (!entry) return missing(manifest ? `This version has no preview for page ${input.page}.` : "This version has no previews.");

  const blob = (await deps.db.documentBlob.findUnique({
    where: { id: entry.blobId },
    select: { storageKey: true, sha256: true },
  })) as BlobRef | null;
  if (!blob || blob.sha256 !== entry.sha256) return { ...err("The preview image is no longer stored."), status: 410 };
  try {
    const bytes = await deps.readBlob({ storageKey: blob.storageKey, sha256: blob.sha256 });
    return ok({ bytes, mimeType: "image/png", disposition: `inline; filename="${contentFilename(`${document.title} - slide ${input.page}`, "png")}"` });
  } catch {
    return { ...err("The preview image could not be read."), status: 410 };
  }
}
