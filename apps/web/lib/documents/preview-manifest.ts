// The preview rendition's manifest (BI-543819B1, slice S7 of BI-815D40C6).
//
// A DocumentVersion has one rendition per kind (the table's unique key), and a
// deck has one preview image per slide. So the `preview` rendition's blob is
// this small JSON manifest: the page images, each a content-addressed
// DocumentBlob, in page order. The manifest is not text anyone searches, so the
// rendition carries no contentText and adds nothing to full-text search.
//
// Pure: no Prisma, no storage, so the document page, the preview route and the
// render store share one reading of the format.

export const PREVIEW_MANIFEST_MIME = "application/vnd.dpf.preview-manifest+json";
export const PREVIEW_MANIFEST_VERSION = 1;

export type PreviewPage = { page: number; blobId: string; sha256: string };
export type PreviewManifest = { pages: PreviewPage[] };

/** Deterministic bytes: the same previews always produce the same blob. */
export function buildPreviewManifest(pages: readonly PreviewPage[]): Buffer {
  const ordered = [...pages]
    .sort((a, b) => a.page - b.page)
    .map(({ page, blobId, sha256 }) => ({ page, blobId, sha256 }));
  return Buffer.from(JSON.stringify({ version: PREVIEW_MANIFEST_VERSION, pages: ordered }), "utf8");
}

function isPage(value: unknown): value is PreviewPage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  return (
    typeof page.page === "number" &&
    Number.isInteger(page.page) &&
    page.page >= 1 &&
    typeof page.blobId === "string" &&
    page.blobId.length > 0 &&
    typeof page.sha256 === "string" &&
    page.sha256.length > 0
  );
}

/** The manifest's pages in order, or null when the bytes are not a manifest this reader understands. */
export function parsePreviewManifest(bytes: Buffer): PreviewManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const pages = (parsed as { pages?: unknown }).pages;
  if (!Array.isArray(pages) || !pages.every(isPage)) return null;
  return { pages: [...pages].sort((a, b) => a.page - b.page).map(({ page, blobId, sha256 }) => ({ page, blobId, sha256 })) };
}
