// BI-4865EB4D: doc_load's exportFormat exports the loaded version through the
// document engine and returns the file.
import { afterEach, describe, expect, it, vi } from "vitest";

const documentStore = vi.hoisted(() => ({ loadManagedDocument: vi.fn() }));
const documentExport = vi.hoisted(() => ({
  exportDocumentVersion: vi.fn(),
  isDocumentExportFormat: (value: unknown) => value === "docx" || value === "odt" || value === "pdf",
  documentExportFailureMessage: (reason: string) => `failed: ${reason}`,
}));
vi.mock("@/lib/documents/document-store", () => documentStore);
vi.mock("@/lib/documents/document-export", () => documentExport);

import { DOC_LOAD_EXPORT_INLINE_LIMIT_BYTES, documentPack } from "./document-pack";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

afterEach(() => vi.clearAllMocks());

function loaded(version = 2) {
  documentStore.loadManagedDocument.mockResolvedValue({ documentId: "DOC-1", currentVersion: { version, renditions: [] } });
}

describe("doc_load exportFormat", () => {
  it("loads without exporting when exportFormat is absent", async () => {
    loaded();
    const result = await documentPack.handlers.doc_load!({ documentId: "DOC-1" }, "user-1");
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("export");
    expect(documentExport.exportDocumentVersion).not.toHaveBeenCalled();
  });

  it("exports the loaded version and returns the file inline with its download path", async () => {
    loaded(3);
    const bytes = Buffer.from("PK\u0003\u0004 exported");
    documentExport.exportDocumentVersion.mockResolvedValue({
      ok: true,
      data: { format: "docx", version: 3, bytes, mimeType: DOCX, filename: "Plan.docx", blobId: "b", reused: false },
    });
    const result = await documentPack.handlers.doc_load!({ documentId: "DOC-1", exportFormat: "docx" }, "user-1");

    expect(documentExport.exportDocumentVersion).toHaveBeenCalledWith({ documentId: "DOC-1", version: 3, format: "docx" });
    expect(result.success).toBe(true);
    expect(result.data?.["export"]).toEqual({
      format: "docx",
      status: "exported",
      version: 3,
      filename: "Plan.docx",
      mimeType: DOCX,
      sizeBytes: bytes.byteLength,
      downloadPath: "/api/documents/DOC-1/content?version=3&export=docx",
      contentBase64: bytes.toString("base64"),
    });
  });

  it("omits the inline copy of a large export", async () => {
    loaded();
    const bytes = Buffer.alloc(DOC_LOAD_EXPORT_INLINE_LIMIT_BYTES + 1);
    documentExport.exportDocumentVersion.mockResolvedValue({
      ok: true,
      data: { format: "pdf", version: 2, bytes, mimeType: "application/pdf", filename: "Plan.pdf", blobId: "b", reused: true },
    });
    const result = await documentPack.handlers.doc_load!({ documentId: "DOC-1", exportFormat: "pdf" }, "user-1");
    expect(result.data?.["export"]).toMatchObject({ status: "exported", sizeBytes: bytes.byteLength });
    expect(result.data?.["export"]).not.toHaveProperty("contentBase64");
  });

  it("still returns the document when the export fails, with the typed reason", async () => {
    loaded();
    documentExport.exportDocumentVersion.mockResolvedValue({ ok: false, error: "off", reason: "converter-unavailable" });
    const result = await documentPack.handlers.doc_load!({ documentId: "DOC-1", exportFormat: "odt" }, "user-1");
    expect(result.success).toBe(true);
    expect(result.data?.["document"]).toBeTruthy();
    expect(result.data?.["export"]).toEqual({
      format: "odt",
      status: "failed",
      reason: "converter-unavailable",
      message: "failed: converter-unavailable",
    });
  });

  it("refuses an unknown export format", async () => {
    loaded();
    const result = await documentPack.handlers.doc_load!({ documentId: "DOC-1", exportFormat: "xlsx" }, "user-1");
    expect(result.success).toBe(false);
    expect(documentExport.exportDocumentVersion).not.toHaveBeenCalled();
  });
});
