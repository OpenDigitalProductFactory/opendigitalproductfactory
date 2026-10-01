import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { loadPreviewPages, resolvePreviewImage, type DocumentPreviewDeps } from "./document-previews";
import { buildPreviewManifest } from "./preview-manifest";

const MANIFEST = buildPreviewManifest([
  { page: 1, blobId: "png-1", sha256: "a".repeat(64) },
  { page: 2, blobId: "png-2", sha256: "b".repeat(64) },
]);
const PNG = Buffer.from("\x89PNG-slide", "latin1");

function harness(options: { rendition?: unknown; document?: unknown; blobs?: Record<string, unknown> } = {}) {
  const rendition = "rendition" in options ? options.rendition : { blob: { storageKey: "manifest-key", sha256: "m".repeat(64) } };
  const document = "document" in options ? options.document : { title: "Spring drive", currentVersion: { id: "ver-3" } };
  const blobs = options.blobs ?? {
    "png-1": { storageKey: "png-1-key", sha256: "a".repeat(64), mimeType: "image/png" },
    "png-2": { storageKey: "png-2-key", sha256: "b".repeat(64), mimeType: "image/png" },
  };
  const renditionFind = vi.fn(async () => rendition);
  const documentFind = vi.fn(async () => document);
  const blobFind = vi.fn(async ({ where }: { where: { id: string } }) => blobs[where.id] ?? null);
  const readBlob = vi.fn(async ({ storageKey }: { storageKey: string }) => (storageKey === "manifest-key" ? MANIFEST : PNG));
  const deps: DocumentPreviewDeps = {
    db: {
      documentRendition: { findUnique: renditionFind },
      document: { findUnique: documentFind },
      documentBlob: { findUnique: blobFind },
    } as never,
    readBlob,
  };
  return { deps, renditionFind, documentFind, blobFind, readBlob };
}

describe("loadPreviewPages", () => {
  it("lists the version's preview pages in order from its preview rendition", async () => {
    const { deps, renditionFind } = harness();
    expect(await loadPreviewPages("ver-3", deps)).toEqual([1, 2]);
    expect(renditionFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { documentVersionId_renditionKind: { documentVersionId: "ver-3", renditionKind: "preview" } } }),
    );
  });

  it("is empty for a version with no preview rendition, or an unreadable manifest", async () => {
    expect(await loadPreviewPages("ver-3", harness({ rendition: null }).deps)).toEqual([]);
    const broken = harness();
    broken.readBlob.mockRejectedValueOnce(new Error("gone"));
    expect(await loadPreviewPages("ver-3", broken.deps)).toEqual([]);
  });
});

describe("resolvePreviewImage", () => {
  it("serves one slide's PNG inline for the current version", async () => {
    const { deps, readBlob } = harness();
    const result = await resolvePreviewImage({ documentId: "DOC-1", page: 2 }, deps);
    expect(result).toEqual({ ok: true, data: { bytes: PNG, mimeType: "image/png", disposition: 'inline; filename="Spring drive - slide 2.png"' } });
    expect(readBlob).toHaveBeenLastCalledWith({ storageKey: "png-2-key", sha256: "b".repeat(64) });
  });

  it("pins a version when one is named", async () => {
    const { deps, documentFind } = harness({ document: { title: "Spring drive", versions: [{ id: "ver-1" }] } });
    const result = await resolvePreviewImage({ documentId: "DOC-1", page: 1, version: 1 }, deps);
    expect(result.ok).toBe(true);
    expect(documentFind).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ versions: expect.anything() }) }));
  });

  it("answers 404 for a missing document, a version with no previews, or a page past the end", async () => {
    expect(await resolvePreviewImage({ documentId: "DOC-X", page: 1 }, harness({ document: null }).deps)).toMatchObject({ ok: false, status: 404 });
    expect(await resolvePreviewImage({ documentId: "DOC-1", page: 1 }, harness({ rendition: null }).deps)).toMatchObject({ ok: false, status: 404 });
    expect(await resolvePreviewImage({ documentId: "DOC-1", page: 9 }, harness().deps)).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a page image whose stored digest no longer matches the manifest", async () => {
    const { deps } = harness({ blobs: { "png-1": { storageKey: "png-1-key", sha256: "c".repeat(64), mimeType: "image/png" } } });
    expect(await resolvePreviewImage({ documentId: "DOC-1", page: 1 }, deps)).toMatchObject({ ok: false, status: 410 });
  });
});
