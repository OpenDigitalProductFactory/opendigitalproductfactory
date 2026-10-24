import { describe, expect, it, vi } from "vitest";
import { saveRenderedDocument, type RenderStoreDeps } from "./render-store";
import type { RenderedDocument } from "./render";
import { PREVIEW_MANIFEST_MIME, parsePreviewManifest } from "@/lib/documents/preview-manifest";

vi.mock("@dpf/db", () => ({ prisma: {}, DocumentRenditionKind: { pdf: "pdf", plain_text: "plain_text", preview: "preview" } }));

function rendered(overrides: Partial<RenderedDocument> = {}): RenderedDocument {
  return {
    family: "deck",
    title: "Spring adoption drive",
    files: [
      { format: "pptx", bytes: Buffer.from("pptx"), mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
      { format: "pdf", bytes: Buffer.from("%PDF-1.7"), mime: "application/pdf" },
    ],
    previews: [Buffer.from("png-1"), Buffer.from("png-2")],
    text: "Spring adoption drive\nWhere we are",
    pageCount: 2,
    warnings: [],
    ...overrides,
  };
}

function harness() {
  let blobs = 0;
  const storeBlob = vi.fn(async (bytes: Buffer, mime: string) => ({ id: `blob-${++blobs}`, sha256: `sha-${bytes.toString()}`, mime }));
  const saveDocument = vi.fn(async (input: { documentId?: string | null }) => ({
    documentId: input.documentId ?? "DOC-NEW",
    currentVersionId: "ver-1",
    version: 1,
  }));
  const upsertRendition = vi.fn(async () => undefined);
  const deps: RenderStoreDeps = { storeBlob, saveDocument, upsertRendition };
  return { deps, storeBlob, saveDocument, upsertRendition };
}

describe("saveRenderedDocument", () => {
  it("stores the office file as the version's content, searchable by its text layer", async () => {
    const { deps, saveDocument } = harness();
    const saved = await saveRenderedDocument(rendered(), { organizationId: "org-1", actorPrincipalId: "p-1" }, deps);
    expect(saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        title: "Spring adoption drive",
        documentKind: "generated-deck",
        contentFormat: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        contentBlobId: "blob-1",
        contentSha256: "sha-pptx",
        contentText: "Spring adoption drive\nWhere we are",
        actorPrincipalId: "p-1",
      }),
    );
    expect(saved).toMatchObject({ documentId: "DOC-NEW", versionId: "ver-1", version: 1 });
  });

  it("writes the pdf and plain_text renditions under the kinds S4's enum defines", async () => {
    const { deps, upsertRendition } = harness();
    await saveRenderedDocument(rendered(), { organizationId: "org-1" }, deps);
    expect(upsertRendition).toHaveBeenCalledWith({ versionId: "ver-1", kind: "pdf", blobId: "blob-2", mimeType: "application/pdf" });
    expect(upsertRendition).toHaveBeenCalledWith({
      versionId: "ver-1",
      kind: "plain_text",
      contentText: "Spring adoption drive\nWhere we are",
      blobId: null,
      mimeType: "text/plain; charset=utf-8",
    });
  });

  it("keeps every preview as a content-addressed blob and returns them in page order", async () => {
    const { deps } = harness();
    const saved = await saveRenderedDocument(rendered(), { organizationId: "org-1" }, deps);
    expect(saved.previews).toEqual([
      { page: 1, blobId: "blob-3", sha256: "sha-png-1" },
      { page: 2, blobId: "blob-4", sha256: "sha-png-2" },
    ]);
    expect(saved.files.map((file) => file.format)).toEqual(["pptx", "pdf"]);
  });

  it("records the previews as the version's preview rendition: a manifest of the page images in order", async () => {
    const { deps, storeBlob, upsertRendition } = harness();
    await saveRenderedDocument(rendered(), { organizationId: "org-1" }, deps);
    const manifestCall = storeBlob.mock.calls.find(([, mime]) => mime === PREVIEW_MANIFEST_MIME);
    expect(manifestCall).toBeDefined();
    expect(parsePreviewManifest(manifestCall![0])).toEqual({
      pages: [
        { page: 1, blobId: "blob-3", sha256: "sha-png-1" },
        { page: 2, blobId: "blob-4", sha256: "sha-png-2" },
      ],
    });
    expect(upsertRendition).toHaveBeenCalledWith({ versionId: "ver-1", kind: "preview", blobId: "blob-5", mimeType: PREVIEW_MANIFEST_MIME });
  });

  it("writes no preview rendition when the engine returned no previews", async () => {
    const { deps, upsertRendition } = harness();
    await saveRenderedDocument(rendered({ previews: [] }), { organizationId: "org-1" }, deps);
    expect(upsertRendition).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "preview" }));
  });

  it("adds a version to an existing document instead of creating another", async () => {
    const { deps, saveDocument } = harness();
    await saveRenderedDocument(rendered(), { organizationId: "org-1", documentId: "DOC-ABC" }, deps);
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: "DOC-ABC" }));
  });

  it("uses the PDF as the content when it is the only format", async () => {
    const { deps, saveDocument, upsertRendition } = harness();
    await saveRenderedDocument(
      rendered({ files: [{ format: "pdf", bytes: Buffer.from("%PDF"), mime: "application/pdf" }] }),
      { organizationId: "org-1" },
      deps,
    );
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ contentFormat: "application/pdf", contentBlobId: "blob-1" }));
    expect(upsertRendition).toHaveBeenCalledWith(expect.objectContaining({ kind: "pdf", blobId: "blob-1" }));
  });
});
