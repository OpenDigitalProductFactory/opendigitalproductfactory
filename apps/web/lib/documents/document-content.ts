// Serve a managed document's stored bytes (BI-9D43CBEF): the original file
// ("Download original") or its PDF rendition ("View PDF") on the document page.
// The route (app/api/documents/[documentId]/content) owns the session check;
// this resolves what to send and never throws for an expected miss.

import { prisma } from "@dpf/db";
import { readDocumentBlob } from "./blob-storage";
import { officeSourceExtension } from "./conversion/formats";

export type DocumentContentKind = "original" | "pdf";

export type DocumentContentResult =
  | { ok: true; bytes: Buffer; mimeType: string; disposition: string }
  | { ok: false; status: 404 | 410; error: string };

type BlobRef = { storageKey: string; sha256: string };

export type DocumentContentDeps = {
  db: Pick<typeof prisma, "document">;
  readBlob: (blob: BlobRef) => Promise<Buffer>;
};

const defaultDeps = (): DocumentContentDeps => ({
  db: prisma,
  readBlob: (blob) => readDocumentBlob({ storageKey: blob.storageKey, expectedSha256: blob.sha256 }),
});

const VERSION_SELECT = {
  version: true,
  contentFormat: true,
  contentBlob: { select: { storageKey: true, sha256: true, mimeType: true } },
  renditions: {
    where: { renditionKind: "pdf" as const },
    select: { renditionKind: true, mimeType: true, blob: { select: { storageKey: true, sha256: true } } },
  },
};

/** A download filename from the title: ASCII only, no path or header syntax. */
export function contentFilename(title: string, extension: string): string {
  const base = title
    .replace(/\s*[/\\:*?"<>|]+\s*/g, " - ")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${base || "document"}.${extension}`;
}

export async function resolveDocumentContent(
  input: { documentId: string; rendition: DocumentContentKind; version?: number | null },
  deps: DocumentContentDeps = defaultDeps(),
): Promise<DocumentContentResult> {
  const pinned = typeof input.version === "number" && Number.isInteger(input.version);
  const document = await deps.db.document.findUnique({
    where: { documentId: input.documentId },
    select: pinned
      ? { title: true, versions: { where: { version: input.version! }, take: 1, select: VERSION_SELECT } }
      : { title: true, currentVersion: { select: VERSION_SELECT } },
  }) as { title: string; currentVersion?: VersionRow | null; versions?: VersionRow[] } | null;
  if (!document) return { ok: false, status: 404, error: "Document not found." };
  const version = pinned ? document.versions?.[0] : document.currentVersion;
  if (!version) return { ok: false, status: 404, error: "Document version not found." };

  let blob: BlobRef | null;
  let mimeType: string;
  let disposition: string;
  if (input.rendition === "pdf") {
    const pdf = version.renditions.find((rendition) => rendition.renditionKind === "pdf");
    if (!pdf?.blob) return { ok: false, status: 404, error: "This version has no PDF rendition yet." };
    blob = pdf.blob;
    mimeType = pdf.mimeType ?? "application/pdf";
    disposition = `inline; filename="${contentFilename(document.title, "pdf")}"`;
  } else {
    blob = version.contentBlob;
    if (!blob) return { ok: false, status: 404, error: "This version has no stored file." };
    mimeType = version.contentBlob?.mimeType ?? version.contentFormat;
    // Always an attachment: a stored original is never rendered by the browser.
    disposition = `attachment; filename="${contentFilename(document.title, officeSourceExtension(version.contentFormat) ?? "bin")}"`;
  }

  try {
    const bytes = await deps.readBlob({ storageKey: blob.storageKey, sha256: blob.sha256 });
    return { ok: true, bytes, mimeType, disposition };
  } catch {
    return { ok: false, status: 410, error: "The stored file could not be read." };
  }
}

type VersionRow = {
  version: number;
  contentFormat: string;
  contentBlob: { storageKey: string; sha256: string; mimeType: string | null } | null;
  renditions: Array<{ renditionKind: string; mimeType: string | null; blob: BlobRef | null }>;
};

export const RENDITION_TEXT_PREVIEW_CHARS = 20_000;

/** The head of a version's plain-text rendition, for the document page. */
export async function loadRenditionTextPreview(
  documentVersionId: string,
  maxChars = RENDITION_TEXT_PREVIEW_CHARS,
  db: Pick<typeof prisma, "documentRendition"> = prisma,
): Promise<string | null> {
  const rendition = await db.documentRendition.findUnique({
    where: { documentVersionId_renditionKind: { documentVersionId, renditionKind: "plain_text" } },
    select: { contentText: true },
  });
  return rendition?.contentText ? rendition.contentText.slice(0, maxChars) : null;
}

const RENDITION_FAILURE_COPY: Readonly<Record<string, string>> = {
  "converter-unavailable": "Document conversion is not available on this install, so there is no PDF or searchable text yet. It is tried again when conversion becomes available.",
  "conversion-failed": "This file could not be converted to a PDF or searchable text.",
  timeout: "Converting this file took too long, so there is no PDF or searchable text.",
  "input-too-large": "This file is too large to convert to a PDF or searchable text.",
  "blob-unreadable": "The stored file could not be read, so it could not be converted.",
};

/**
 * The plain-language rendition failure for one version, read from the
 * lifecycle events the rendition job records ("rendition <reason>: <kind> of vN.").
 */
export function renditionFailureMessage(
  events: ReadonlyArray<{ reason: string | null }>,
  version: number,
): string | null {
  for (const event of events) {
    const match = /^rendition ([a-z-]+): [a-z_]+ of v(\d+)\./.exec(event.reason ?? "");
    if (match && Number(match[2]) === version) return RENDITION_FAILURE_COPY[match[1]!] ?? RENDITION_FAILURE_COPY["conversion-failed"]!;
  }
  return null;
}
