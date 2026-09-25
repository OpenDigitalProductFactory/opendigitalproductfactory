// A rendered document into the document store (BI-3A0E5413, slice S6).
//
// The office file becomes the content of a new DocumentVersion (a new
// Document, or the next version of `documentId` when a caller revises one), and
// its PDF text layer becomes the version's text, so the existing full-text and
// vector indexing find a generated document the moment it is saved.
//
// Renditions are S4's two kinds (DocumentRenditionKind, BI-9D43CBEF), written
// the way its job writes them: the PDF as a blob, the text inline up to the
// inline limit (the full text as a blob past it). The version save also asks
// S4's rendition job for this version; that job skips kinds that already
// exist, so the render's own PDF and text save it a second engine run.
//
// Seam: page previews. No rendition kind for them exists yet (S4 owns that
// enum), so previews are stored as content-addressed DocumentBlobs and returned
// in page order; S7 (BI-543819B1) shows them on the document page and is where
// a `preview` rendition kind would be added. Additional formats (an .odp beside
// a .pptx) are returned the same way.

import { DocumentRenditionKind, prisma } from "@dpf/db";
import { DOCUMENT_TEXT_INLINE_LIMIT_BYTES, storeDocumentBlob } from "@/lib/documents/blob-storage";
import type { RenderedDocument } from "./render";

export type StoredBlob = { id: string; sha256: string };

export type RenderStoreDeps = {
  storeBlob?: (bytes: Buffer, mime: string) => Promise<StoredBlob>;
  saveDocument?: (input: {
    documentId?: string | null;
    organizationId: string;
    title: string;
    documentKind: string;
    contentFormat: string;
    contentBlobId: string;
    contentSha256: string;
    contentText: string | null;
    summary: string;
    tags: string[];
    actorPrincipalId?: string | null;
  }) => Promise<{ documentId: string; currentVersionId: string | null; version: number }>;
  upsertRendition?: (
    row:
      | { versionId: string; kind: typeof DocumentRenditionKind.pdf; blobId: string; mimeType: string }
      | { versionId: string; kind: typeof DocumentRenditionKind.plain_text; contentText: string; blobId: string | null; mimeType: string },
  ) => Promise<void>;
};

export type SavedRender = {
  documentId: string;
  versionId: string;
  version: number;
  files: Array<{ format: string; mime: string; blobId: string; sha256: string }>;
  previews: Array<{ page: number; blobId: string; sha256: string }>;
};

async function storeBlob(bytes: Buffer, mime: string): Promise<StoredBlob> {
  const blob = await storeDocumentBlob({ content: bytes, mimeType: mime });
  return { id: blob.id, sha256: blob.sha256 };
}

async function saveDocument(input: Parameters<NonNullable<RenderStoreDeps["saveDocument"]>>[0]) {
  const { saveManagedDocument } = await import("@/lib/documents/document-store");
  const saved = await saveManagedDocument({ ...input, accessScope: "organization" });
  return {
    documentId: saved.documentId,
    currentVersionId: saved.currentVersionId,
    version: saved.currentVersion?.version ?? 1,
  };
}

async function upsertRendition(row: Parameters<NonNullable<RenderStoreDeps["upsertRendition"]>>[0]): Promise<void> {
  const data =
    row.kind === DocumentRenditionKind.pdf
      ? { blobId: row.blobId, contentText: null, mimeType: row.mimeType }
      : { blobId: row.blobId, contentText: row.contentText, mimeType: row.mimeType };
  await prisma.documentRendition.upsert({
    where: { documentVersionId_renditionKind: { documentVersionId: row.versionId, renditionKind: row.kind } },
    update: data,
    create: { documentVersionId: row.versionId, renditionKind: row.kind, ...data },
  });
}

const TEXT_MIME = "text/plain; charset=utf-8";

/** Text that fits inline on a version; the full text stays in the plain_text rendition. */
function inlineText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const bytes = Buffer.from(trimmed, "utf8");
  return bytes.length <= DOCUMENT_TEXT_INLINE_LIMIT_BYTES
    ? trimmed
    : bytes.subarray(0, DOCUMENT_TEXT_INLINE_LIMIT_BYTES).toString("utf8").replace(/�$/, "");
}

export async function saveRenderedDocument(
  rendered: RenderedDocument,
  target: { organizationId: string; documentId?: string | null; title?: string; tags?: string[]; actorPrincipalId?: string | null },
  deps: RenderStoreDeps = {},
): Promise<SavedRender> {
  const put = deps.storeBlob ?? storeBlob;
  // The office file is the content; a PDF-only render keeps the PDF as its content.
  const primary = rendered.files.find((file) => file.format !== "pdf") ?? rendered.files[0];
  if (!primary) throw new Error("A rendered document has no files to store.");

  const files: SavedRender["files"] = [];
  for (const file of rendered.files) {
    const blob = await put(file.bytes, file.mime);
    files.push({ format: file.format, mime: file.mime, blobId: blob.id, sha256: blob.sha256 });
  }
  const primaryBlob = files[rendered.files.indexOf(primary)];

  const saved = await (deps.saveDocument ?? saveDocument)({
    documentId: target.documentId ?? null,
    organizationId: target.organizationId,
    title: target.title ?? rendered.title,
    documentKind: `generated-${rendered.family}`,
    contentFormat: primary.mime,
    contentBlobId: primaryBlob.blobId,
    contentSha256: primaryBlob.sha256,
    contentText: inlineText(rendered.text),
    summary: `Generated ${rendered.family}: ${rendered.pageCount} page(s) as ${rendered.files.map((file) => file.format).join(", ")}.`,
    tags: [...new Set(["generated", rendered.family, ...(target.tags ?? [])])],
    actorPrincipalId: target.actorPrincipalId ?? null,
  });
  if (!saved.currentVersionId) {
    throw new Error(`Document ${saved.documentId} saved without a current version; the renditions have nothing to attach to.`);
  }

  const rendition = deps.upsertRendition ?? upsertRendition;
  const pdf = files.find((file) => file.format === "pdf");
  if (pdf) {
    await rendition({ versionId: saved.currentVersionId, kind: DocumentRenditionKind.pdf, blobId: pdf.blobId, mimeType: pdf.mime });
  }
  const inline = inlineText(rendered.text);
  if (inline) {
    const whole = Buffer.from(rendered.text.trim(), "utf8");
    // Past the inline limit the full text keeps its bytes as a blob, as S4's job does.
    const overflow = inline.length < rendered.text.trim().length ? (await put(whole, TEXT_MIME)).id : null;
    await rendition({
      versionId: saved.currentVersionId,
      kind: DocumentRenditionKind.plain_text,
      contentText: inline,
      blobId: overflow,
      mimeType: TEXT_MIME,
    });
  }

  const previews: SavedRender["previews"] = [];
  for (const [index, png] of rendered.previews.entries()) {
    const blob = await put(png, "image/png");
    previews.push({ page: index + 1, blobId: blob.id, sha256: blob.sha256 });
  }
  return { documentId: saved.documentId, versionId: saved.currentVersionId, version: saved.version, files, previews };
}
