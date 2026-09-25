// BI-9D43CBEF: doc_save can carry an office file itself (contentBase64), and
// doc_load returns the version's renditions.
import { afterEach, describe, expect, it, vi } from "vitest";

const documentStore = vi.hoisted(() => ({
  saveManagedDocument: vi.fn(),
  loadManagedDocument: vi.fn(),
}));
const blobStorage = vi.hoisted(() => ({
  storeDocumentBlob: vi.fn(async () => ({ id: "blob-1", sha256: "f".repeat(64), storageKey: "k", sizeBytes: 11 })),
}));
vi.mock("@/lib/documents/document-store", () => documentStore);
vi.mock("@/lib/documents/blob-storage", () => blobStorage);
vi.mock("@/lib/identity/principal-linking", () => ({
  ensureAgentPrincipalIdentity: vi.fn(async () => null),
  syncUserPrincipal: vi.fn(async () => ({ id: "principal-user" })),
}));

import { documentPack } from "./document-pack";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

afterEach(() => vi.clearAllMocks());

describe("doc_save with contentBase64", () => {
  it("stores the bytes as a DocumentBlob and saves the version against it", async () => {
    documentStore.saveManagedDocument.mockResolvedValue({ documentId: "DOC-1", currentVersion: { version: 1 } });
    const bytes = Buffer.from("PK\u0003\u0004 docx");
    const result = await documentPack.handlers.doc_save!(
      { title: "Board pack", documentKind: "report", contentFormat: DOCX, contentBase64: bytes.toString("base64") },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(blobStorage.storeDocumentBlob).toHaveBeenCalledWith({ content: bytes, mimeType: DOCX });
    expect(documentStore.saveManagedDocument).toHaveBeenCalledWith(expect.objectContaining({
      contentBlobId: "blob-1",
      contentSha256: "f".repeat(64),
      contentText: null,
    }));
  });

  it("refuses contentBase64 together with contentText or contentBlobId", async () => {
    const result = await documentPack.handlers.doc_save!(
      { title: "t", documentKind: "k", contentFormat: DOCX, contentBase64: "QUJD", contentText: "abc" },
      "user-1",
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/only one of/i);
    expect(blobStorage.storeDocumentBlob).not.toHaveBeenCalled();
  });

  it("refuses content that is not base64", async () => {
    const result = await documentPack.handlers.doc_save!(
      { title: "t", documentKind: "k", contentFormat: DOCX, contentBase64: "not base64!" },
      "user-1",
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/base64/i);
  });

  it("advertises contentBase64 in the tool schema", () => {
    const docSave = documentPack.definitions.find((definition) => definition.name === "doc_save")!;
    expect((docSave.inputSchema.properties as Record<string, unknown>).contentBase64).toBeDefined();
  });
});

describe("doc_load renditions", () => {
  it("returns the loaded version's renditions beside the document", async () => {
    const renditions = [{ id: "r1", kind: "pdf", mimeType: "application/pdf", blobId: "b", createdAt: new Date() }];
    documentStore.loadManagedDocument.mockResolvedValue({ documentId: "DOC-1", currentVersion: { version: 2, renditions } });
    const result = await documentPack.handlers.doc_load!({ documentId: "DOC-1" }, "user-1");
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).renditions).toEqual(renditions);
  });

  it("returns an empty list when the version has none", async () => {
    documentStore.loadManagedDocument.mockResolvedValue({ documentId: "DOC-1", currentVersion: null });
    const result = await documentPack.handlers.doc_load!({ documentId: "DOC-1" }, "user-1");
    expect((result.data as Record<string, unknown>).renditions).toEqual([]);
  });
});
