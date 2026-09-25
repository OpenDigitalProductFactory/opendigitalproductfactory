import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { resolveDocumentContent, type DocumentContentDeps } from "./document-content";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function deps(document: unknown, bytes = Buffer.from("bytes")) {
  const findUnique = vi.fn(async () => document);
  const readBlob = vi.fn(async () => bytes);
  return { deps: { db: { document: { findUnique } } as never, readBlob } satisfies DocumentContentDeps, findUnique, readBlob };
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    title: "Q3 Board Pack / final",
    currentVersion: {
      version: 3,
      contentFormat: DOCX,
      contentBlob: { storageKey: "orig-key", sha256: "o".repeat(64), mimeType: DOCX },
      renditions: [{ renditionKind: "pdf", mimeType: "application/pdf", blob: { storageKey: "pdf-key", sha256: "p".repeat(64) } }],
    },
    ...overrides,
  };
}

describe("resolveDocumentContent (BI-9D43CBEF)", () => {
  it("serves the original as a download named after the document", async () => {
    const { deps: d, readBlob } = deps(documentRow());
    const result = await resolveDocumentContent({ documentId: "DOC-1", rendition: "original" }, d);
    expect(result).toEqual({
      ok: true,
      data: {
        bytes: Buffer.from("bytes"),
        mimeType: DOCX,
        disposition: 'attachment; filename="Q3 Board Pack - final.docx"',
      },
    });
    expect(readBlob).toHaveBeenCalledWith({ storageKey: "orig-key", sha256: "o".repeat(64) });
  });

  it("serves the PDF rendition inline", async () => {
    const { deps: d, readBlob } = deps(documentRow());
    const result = await resolveDocumentContent({ documentId: "DOC-1", rendition: "pdf" }, d);
    expect(result).toMatchObject({ ok: true, data: { mimeType: "application/pdf", disposition: 'inline; filename="Q3 Board Pack - final.pdf"' } });
    expect(readBlob).toHaveBeenCalledWith({ storageKey: "pdf-key", sha256: "p".repeat(64) });
  });

  it("answers 404 when the document, the blob or the rendition is missing", async () => {
    expect(await resolveDocumentContent({ documentId: "DOC-X", rendition: "original" }, deps(null).deps)).toEqual({ ok: false, status: 404, error: "Document not found." });
    const noBlob = documentRow({ currentVersion: { ...documentRow().currentVersion, contentBlob: null } });
    expect(await resolveDocumentContent({ documentId: "DOC-1", rendition: "original" }, deps(noBlob).deps)).toMatchObject({ ok: false, status: 404 });
    const noPdf = documentRow({ currentVersion: { ...documentRow().currentVersion, renditions: [] } });
    expect(await resolveDocumentContent({ documentId: "DOC-1", rendition: "pdf" }, deps(noPdf).deps)).toEqual({ ok: false, status: 404, error: "This version has no PDF rendition yet." });
  });

  it("reads a pinned version when one is asked for", async () => {
    const { deps: d, findUnique } = deps({ title: "T", currentVersion: null, versions: [documentRow().currentVersion] });
    await resolveDocumentContent({ documentId: "DOC-1", rendition: "original", version: 3 }, d);
    expect(JSON.stringify((findUnique.mock.calls as unknown as unknown[][])[0]![0])).toContain('"version":3');
  });

  it("answers 410 when stored bytes are gone or do not match their digest", async () => {
    const d = deps(documentRow()).deps;
    d.readBlob = vi.fn(async () => { throw new Error("ENOENT"); });
    expect(await resolveDocumentContent({ documentId: "DOC-1", rendition: "original" }, d)).toEqual({ ok: false, status: 410, error: "The stored file could not be read." });
  });
});

describe("renditionFailureMessage", () => {
  it("turns the recorded reason for this version into plain language", async () => {
    const { renditionFailureMessage } = await import("./document-content");
    const events = [
      { reason: "Manual published from document detail" },
      { reason: "rendition converter-unavailable: pdf of v3. no dpf-doctools image is configured" },
    ];
    expect(renditionFailureMessage(events, 3)).toMatch(/not available on this install/);
    expect(renditionFailureMessage(events, 2)).toBeNull();
    expect(renditionFailureMessage([{ reason: "rendition something-new: pdf of v1. x" }], 1)).toMatch(/could not be converted/);
  });
});
