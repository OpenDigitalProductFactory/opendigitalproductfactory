// BI-957915CB AC-DPF-1..3: a restricted document is refused, as not-found, on
// every store and file path to a viewer with no owner, creator or unexpired
// grant match, and served to those with one. Cross-user isolation: the same
// world is read by six people and only three of them see DOC-SECRET.
import { beforeEach, describe, expect, it, vi } from "vitest";

const semanticHits = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("./rendition-trigger", () => ({ requestDocumentRenditions: vi.fn(async () => true) }));
vi.mock("./embeddings", () => ({
  storeDocumentVector: vi.fn(async () => false),
  // Qdrant nominates by similarity alone; it knows nothing about access.
  searchDocumentVectors: vi.fn(async () => semanticHits.ids.map((documentId) => ({ id: documentId, documentId, title: "", contentPreview: "", score: 0.9 }))),
}));
vi.mock("@dpf/db/graph-sync", () => ({ syncDocumentReference: vi.fn(async () => undefined) }));
vi.mock("@dpf/db", () => ({
  prisma: {},
  DocumentRenditionKind: { pdf: "pdf", docx: "docx", odt: "odt", plain_text: "plain_text", preview: "preview" },
}));

import {
  changeManagedDocumentState,
  linkManagedDocuments,
  listManagedDocumentReferences,
  listManagedDocumentVersions,
  loadManagedDocument,
  saveManagedDocument,
  searchManagedDocuments,
} from "./document-store";
import { resolveDocumentContent } from "./document-content";
import { resolvePreviewImage } from "./document-previews";
import { exportDocumentVersion } from "./document-office-export";
import { ALLOWED_USERS, createDocumentWorld, REFUSED_USERS, viewerFor, type FakeDocumentWorld } from "./document-isolation.test-support";

let world: FakeDocumentWorld;
let db: never;
beforeEach(() => {
  world = createDocumentWorld();
  db = world.db as never;
  semanticHits.ids = [];
});

const readBlob = async () => Buffer.from("bytes");
const PREVIEW_MANIFEST = Buffer.from(JSON.stringify({ version: 1, pages: [{ page: 1, blobId: "png", sha256: "png-sha", width: 10, height: 10 }] }));

describe.each(REFUSED_USERS)("a viewer who may not read DOC-SECRET (%s)", (userId) => {
  const viewer = viewerFor(userId);

  it("does not load it (document page, doc_load)", async () => {
    expect(await loadManagedDocument({ documentId: "DOC-SECRET", viewer }, db)).toBeNull();
  });

  it("does not list it, in metadata, full-text or semantic search (documents list, doc_search)", async () => {
    semanticHits.ids = ["DOC-SECRET"];
    for (const mode of ["metadata", "full-text", "semantic", "hybrid"] as const) {
      const found = await searchManagedDocuments({ query: "salary", mode, viewer }, db);
      expect(found.map((doc) => doc.documentId), mode).not.toContain("DOC-SECRET");
    }
    const all = await searchManagedDocuments({ viewer }, db);
    expect(all.map((doc) => doc.documentId)).toEqual(["DOC-PUBLIC"]);
  });

  it("gets no versions and no references for it (doc_version_list, doc_list_references)", async () => {
    expect(await listManagedDocumentVersions("DOC-SECRET", viewer, db)).toEqual([]);
    expect(await listManagedDocumentReferences("DOC-SECRET", viewer, db)).toEqual({ inbound: [], outbound: [] });
  });

  it("does not see its title through another document's references", async () => {
    const refs = await listManagedDocumentReferences("DOC-PUBLIC", viewer, db);
    expect(JSON.stringify(refs)).not.toContain("Board salary review");
    expect(refs.outbound).toEqual([]);
  });

  it("is refused its original, its PDF rendition, its previews and its export as not-found (content and preview routes)", async () => {
    for (const rendition of ["original", "pdf"] as const) {
      expect(await resolveDocumentContent({ documentId: "DOC-SECRET", rendition, viewer }, { db, readBlob })).toMatchObject({ ok: false, status: 404, error: "Document not found." });
    }
    expect(await resolvePreviewImage({ documentId: "DOC-SECRET", page: 1, viewer }, { db, readBlob: async () => PREVIEW_MANIFEST })).toMatchObject({ ok: false, status: 404, error: "Document not found." });
    const convert = vi.fn();
    expect(await exportDocumentVersion({ documentId: "DOC-SECRET", format: "pdf", viewer }, { db, readBlob, convert: convert as never })).toMatchObject({ ok: false, reason: "not-found" });
    expect(convert).not.toHaveBeenCalled();
  });

  it("cannot append a version, change its state or link from it", async () => {
    await expect(saveManagedDocument({ documentId: "DOC-SECRET", title: "x", documentKind: "report", contentFormat: "text/plain", contentText: "overwrite", viewer }, db)).rejects.toThrow(/not found/i);
    await expect(changeManagedDocumentState({ documentId: "DOC-SECRET", toState: "published", viewer }, db)).rejects.toThrow(/not found/i);
    await expect(linkManagedDocuments({ sourceDocumentId: "DOC-SECRET", targetDocumentId: "DOC-PUBLIC", refType: "cites", viewer }, db)).rejects.toThrow(/not found/i);
    expect(world.secret.currentState).toBe("draft");
    expect((world.secret.versions as unknown[]).length).toBe(1);
  });

  it("cannot link to it: the edge is not recorded against the restricted document", async () => {
    await linkManagedDocuments({ sourceDocumentId: "DOC-PUBLIC", targetDocumentId: "DOC-SECRET", refType: "cites", viewer }, db);
    expect(world.references.at(-1)).toMatchObject({ targetDocumentId: null });
  });
});

describe.each(ALLOWED_USERS)("a viewer who may read DOC-SECRET (%s)", (userId) => {
  const viewer = viewerFor(userId);

  it("loads, finds, lists and opens it", async () => {
    expect((await loadManagedDocument({ documentId: "DOC-SECRET", viewer }, db))?.documentId).toBe("DOC-SECRET");
    semanticHits.ids = ["DOC-SECRET"];
    for (const mode of ["metadata", "full-text", "semantic"] as const) {
      const found = await searchManagedDocuments({ query: "salary", mode, viewer }, db);
      expect(found.map((doc) => doc.documentId), mode).toContain("DOC-SECRET");
    }
    expect(await listManagedDocumentVersions("DOC-SECRET", viewer, db)).toHaveLength(1);
    expect((await listManagedDocumentReferences("DOC-PUBLIC", viewer, db)).outbound).toHaveLength(1);
    expect((await listManagedDocumentReferences("DOC-SECRET", viewer, db)).inbound).toHaveLength(1);
    expect(await resolveDocumentContent({ documentId: "DOC-SECRET", rendition: "original", viewer }, { db, readBlob })).toMatchObject({ ok: true });
    expect(await resolveDocumentContent({ documentId: "DOC-SECRET", rendition: "pdf", viewer }, { db, readBlob })).toMatchObject({ ok: true });
    expect(await resolvePreviewImage({ documentId: "DOC-SECRET", page: 1, viewer }, { db, readBlob: async () => PREVIEW_MANIFEST })).toMatchObject({ ok: true });
  });

  it("appends a version that keeps the document restricted and its owner unchanged", async () => {
    await saveManagedDocument({
      documentId: "DOC-SECRET",
      title: "Board salary review",
      documentKind: "report",
      contentFormat: "text/plain",
      contentText: "v2",
      actorPrincipalId: viewer.principalId,
      viewer,
    }, db);
    expect(world.secret.accessScope).toBe("restricted");
    expect(world.secret.ownerPrincipalId).toBe("p-owner");
    expect(world.secret.createdByPrincipalId).toBe("p-creator");
    expect((world.secret.versions as unknown[]).length).toBe(2);
  });
});

describe("scope and owner changes on a restricted document", () => {
  it("are refused to a grantee", async () => {
    const viewer = viewerFor("u-grantee");
    await expect(saveManagedDocument({ documentId: "DOC-SECRET", title: "t", documentKind: "report", contentFormat: "text/plain", contentText: "x", accessScope: "organization", viewer }, db)).rejects.toThrow(/owner/i);
    await expect(saveManagedDocument({ documentId: "DOC-SECRET", title: "t", documentKind: "report", contentFormat: "text/plain", contentText: "x", ownerPrincipalId: "p-grantee", viewer }, db)).rejects.toThrow(/owner/i);
    expect(world.secret.accessScope).toBe("restricted");
  });

  it("are allowed to the owner", async () => {
    const viewer = viewerFor("u-owner");
    await saveManagedDocument({ documentId: "DOC-SECRET", title: "t", documentKind: "report", contentFormat: "text/plain", contentText: "x", accessScope: "organization", viewer }, db);
    expect(world.secret.accessScope).toBe("organization");
  });
});

describe("an organization document", () => {
  it("stays readable to every viewer, including one with no principal", async () => {
    for (const userId of [...ALLOWED_USERS, ...REFUSED_USERS]) {
      expect((await loadManagedDocument({ documentId: "DOC-PUBLIC", viewer: viewerFor(userId) }, db))?.documentId).toBe("DOC-PUBLIC");
    }
  });
});
