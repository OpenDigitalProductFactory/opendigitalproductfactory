// BI-957915CB AC-DPF-4 and AC-DPF-5: a file uploaded from the documents page
// becomes a managed document whose version requests renditions, filed in a
// collection the uploader may read; collection navigation lists only the
// members the viewer may read.
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@dpf/db", () => ({
  get prisma() {
    return world.db;
  },
}));
vi.mock("@dpf/db/graph-sync", () => ({ syncDocumentReference: vi.fn(async () => undefined) }));
vi.mock("./embeddings", () => ({ storeDocumentVector: vi.fn(async () => false), searchDocumentVectors: vi.fn(async () => []) }));
const renditions = vi.hoisted(() => ({ requestDocumentRenditions: vi.fn(async () => true) }));
vi.mock("./rendition-trigger", () => renditions);
const blobs = vi.hoisted(() => ({ storeDocumentBlob: vi.fn(async () => ({ id: "blob-up", sha256: "sha-up", storageKey: "k", sizeBytes: 4 })) }));
vi.mock("./blob-storage", () => ({ ...blobs, DOCUMENT_TEXT_INLINE_LIMIT_BYTES: 10 * 1024 * 1024 }));

import { DOCUMENT_UPLOAD_LIMIT_BYTES, uploadContentFormat, uploadManagedDocument } from "./document-upload";
import { createCollection, listCollections } from "./document-collections";
import { searchManagedDocuments } from "./document-store";
import { createDocumentWorld, viewerFor, type FakeDocumentWorld } from "./document-isolation.test-support";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let current: FakeDocumentWorld;
beforeEach(() => {
  current = createDocumentWorld();
  world.db = current.db;
  vi.clearAllMocks();
});

const owner = viewerFor("u-owner");
const stranger = viewerFor("u-stranger");
const upload = (overrides: Partial<Parameters<typeof uploadManagedDocument>[0]> = {}) =>
  uploadManagedDocument({ fileName: "Board pack.docx", mimeType: DOCX, bytes: Buffer.from("PK.."), viewer: owner, actorPrincipalId: "p-owner", ...overrides });

describe("uploadManagedDocument (AC-DPF-4)", () => {
  it("stores a .docx as a blob-backed managed document owned by the uploader and requests its renditions", async () => {
    const result = await upload();
    if (!result.ok) throw new Error(result.error);
    expect(blobs.storeDocumentBlob).toHaveBeenCalledWith({ content: Buffer.from("PK.."), mimeType: DOCX });
    const saved = current.documents.find((doc) => doc.documentId === result.data.documentId)!;
    expect(saved).toMatchObject({ title: "Board pack", documentKind: "file", contentFormat: DOCX, accessScope: "organization", ownerPrincipalId: "p-owner" });
    expect(renditions.requestDocumentRenditions).toHaveBeenCalledTimes(1);
    expect(result.data.route).toBe(`/workspace/documents/${result.data.documentId}`);
  });

  it("stores a .pdf the browser sent without a type, by its extension, and requests its text rendition", async () => {
    const result = await upload({ fileName: "fees.pdf", mimeType: "" });
    expect(result.ok).toBe(true);
    expect(blobs.storeDocumentBlob).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "application/pdf" }));
    expect(renditions.requestDocumentRenditions).toHaveBeenCalledTimes(1);
  });

  it("keeps a markdown file's text inline, with no blob and no rendition", async () => {
    const result = await upload({ fileName: "notes.md", mimeType: "", bytes: Buffer.from("# Notes") });
    expect(result.ok).toBe(true);
    expect(blobs.storeDocumentBlob).not.toHaveBeenCalled();
    expect(renditions.requestDocumentRenditions).not.toHaveBeenCalled();
  });

  it("refuses an empty file, an oversized file and an unsupported format, storing nothing", async () => {
    expect(await upload({ bytes: Buffer.alloc(0) })).toMatchObject({ ok: false, error: "The file is empty." });
    expect(await upload({ bytes: Buffer.alloc(DOCUMENT_UPLOAD_LIMIT_BYTES + 1) })).toMatchObject({ ok: false });
    expect(await upload({ fileName: "run.exe", mimeType: "application/x-msdownload" })).toMatchObject({ ok: false });
    expect(blobs.storeDocumentBlob).not.toHaveBeenCalled();
  });

  it("an upload marked Only me is restricted: the uploader reads it and a stranger does not", async () => {
    const result = await upload({ accessScope: "restricted" });
    if (!result.ok) throw new Error(result.error);
    const mine = await searchManagedDocuments({ viewer: owner }, current.db as never);
    const theirs = await searchManagedDocuments({ viewer: stranger }, current.db as never);
    expect(mine.map((doc) => doc.documentId)).toContain(result.data.documentId);
    expect(theirs.map((doc) => doc.documentId)).not.toContain(result.data.documentId);
  });

  it("maps a declared office type through and falls back to the extension", () => {
    expect(uploadContentFormat("a.bin", DOCX)).toBe(DOCX);
    expect(uploadContentFormat("a.xlsx", "application/octet-stream")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(uploadContentFormat("a.zip", "application/zip")).toBeNull();
  });
});

describe("collections (AC-DPF-5)", () => {
  it("lists only the members the viewer may read, and files an upload in the collection", async () => {
    const collection = await createCollection({ title: "Board", viewer: owner, actorPrincipalId: "p-owner" });
    current.references.push(
      { id: "c1", sourceDocumentId: current.documents.find((d) => d.documentId === collection.documentId)!.id, targetDocumentId: "db-secret", refType: "contains", createdAt: new Date() },
      { id: "c2", sourceDocumentId: current.documents.find((d) => d.documentId === collection.documentId)!.id, targetDocumentId: "db-public", refType: "contains", createdAt: new Date() },
    );
    const uploaded = await upload({ collectionId: collection.documentId });
    if (!uploaded.ok) throw new Error(uploaded.error);

    const forOwner = await searchManagedDocuments({ collectionId: collection.documentId, viewer: owner }, current.db as never);
    const forStranger = await searchManagedDocuments({ collectionId: collection.documentId, viewer: stranger }, current.db as never);
    expect(forOwner.map((doc) => doc.documentId).sort()).toEqual(["DOC-PUBLIC", "DOC-SECRET", uploaded.data.documentId].sort());
    expect(forStranger.map((doc) => doc.documentId).sort()).toEqual(["DOC-PUBLIC", uploaded.data.documentId].sort());
  });

  it("a file dropped into a restricted collection is restricted too, unless a scope is named", async () => {
    const collection = await createCollection({ title: "Private", accessScope: "restricted", viewer: owner, actorPrincipalId: "p-owner" });
    const uploaded = await upload({ collectionId: collection.documentId });
    if (!uploaded.ok) throw new Error(uploaded.error);
    expect(current.documents.find((doc) => doc.documentId === uploaded.data.documentId)).toMatchObject({ accessScope: "restricted" });
    const open = await upload({ collectionId: collection.documentId, accessScope: "organization" });
    if (!open.ok) throw new Error(open.error);
    expect(current.documents.find((doc) => doc.documentId === open.data.documentId)).toMatchObject({ accessScope: "organization" });
  });

  it("hides a restricted collection, and its members, from a viewer who may not read it", async () => {
    const collection = await createCollection({ title: "Private", accessScope: "restricted", viewer: owner, actorPrincipalId: "p-owner" });
    current.references.push({ id: "c3", sourceDocumentId: current.documents.find((d) => d.documentId === collection.documentId)!.id, targetDocumentId: "db-public", refType: "contains", createdAt: new Date() });
    expect((await listCollections(stranger)).map((c) => c.documentId)).not.toContain(collection.documentId);
    expect((await listCollections(owner)).map((c) => c.documentId)).toContain(collection.documentId);
    expect(await searchManagedDocuments({ collectionId: collection.documentId, viewer: stranger }, current.db as never)).toEqual([]);
    expect(await upload({ collectionId: collection.documentId, viewer: stranger, actorPrincipalId: "p-stranger" })).toMatchObject({ ok: false, error: "That collection was not found." });
  });
});
