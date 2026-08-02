import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    invoiceDocument: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    documentBlob: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/documents/document-store", () => ({ saveManagedDocument: vi.fn() }));
vi.mock("@/lib/documents/blob-storage", () => ({
  writeDocumentBlob: vi.fn(),
  getDocumentBlobStorageRoot: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { saveManagedDocument } from "@/lib/documents/document-store";
import { writeDocumentBlob } from "@/lib/documents/blob-storage";
import {
  snapshotInvoiceDocument,
  listInvoiceDocuments,
  getInvoiceDocumentBlobRef,
} from "@/lib/finance/invoice-document-store";

const db = prisma as any;
const mockSave = vi.mocked(saveManagedDocument);
const mockWrite = vi.mocked(writeDocumentBlob);

const pdf = Buffer.from("%PDF-1.7 fake");

const baseInput = {
  invoiceId: "inv-1",
  invoiceRef: "INV-2026-0001",
  accountName: "Northwind",
  pdf,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWrite.mockResolvedValue({ sha256: "abc123", storageKey: "documents/sha256/ab/c1/abc123", sizeBytes: pdf.byteLength } as never);
  db.documentBlob.upsert.mockResolvedValue({ id: "blob-1" });
  mockSave.mockResolvedValue({ currentVersionId: "dv-1" } as never);
  db.invoiceDocument.findFirst.mockResolvedValue(null);
  db.invoiceDocument.create.mockImplementation(async ({ data }: any) => ({
    id: "idoc-1",
    revision: data.revision,
    role: data.role,
    documentVersionId: data.documentVersionId,
    sentToEmail: data.sentToEmail,
    createdAt: new Date("2026-08-01T00:00:00Z"),
  }));
});

describe("snapshotInvoiceDocument", () => {
  it("persists the bytes, binds a document version, and starts at revision 1", async () => {
    const result = await snapshotInvoiceDocument({ ...baseInput, sentToEmail: "ap@northwind.test" });

    expect(mockWrite).toHaveBeenCalledWith({ content: pdf });
    expect(result.revision).toBe(1);
    expect(result.role).toBe("sent-copy");
    expect(result.sha256).toBe("abc123");
    expect(result.documentVersionId).toBe("dv-1");

    const created = db.invoiceDocument.create.mock.calls[0][0].data;
    expect(created.invoiceId).toBe("inv-1");
    expect(created.sentToEmail).toBe("ap@northwind.test");
  });

  it("appends revision N+1 rather than mutating the previous snapshot", async () => {
    db.invoiceDocument.findFirst.mockResolvedValue({ revision: 3 });

    const result = await snapshotInvoiceDocument(baseInput);

    expect(result.revision).toBe(4);
    // Nothing on the store may update an existing snapshot row.
    expect(db.invoiceDocument.create).toHaveBeenCalledOnce();
    expect((db.invoiceDocument as any).update).toBeUndefined();
  });

  it("reuses the blob when identical bytes are re-sent", async () => {
    await snapshotInvoiceDocument(baseInput);

    const upsert = db.documentBlob.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ sha256: "abc123" });
    // update:{} — an existing blob is left exactly as it is.
    expect(upsert.update).toEqual({});
  });

  it("keeps one document per invoice+role so versions line up with revisions", async () => {
    await snapshotInvoiceDocument(baseInput);
    const saved = mockSave.mock.calls[0][0];
    expect(saved.documentId).toBe("INVDOC-inv-1-sent-copy");
    expect(saved.contentFormat).toBe("application/pdf");
    expect(saved.contentBlobId).toBe("blob-1");
    expect(saved.contentSha256).toBe("abc123");
  });

  it("separates roles into their own revision series", async () => {
    await snapshotInvoiceDocument({ ...baseInput, role: "credit-note" });
    expect(db.invoiceDocument.findFirst.mock.calls[0][0].where).toEqual({
      invoiceId: "inv-1",
      role: "credit-note",
    });
    expect(mockSave.mock.calls[0][0].documentId).toBe("INVDOC-inv-1-credit-note");
  });

  it("refuses to bind a snapshot when the document store returns no version", async () => {
    mockSave.mockResolvedValue({ currentVersionId: null } as never);

    await expect(snapshotInvoiceDocument(baseInput)).rejects.toThrow(/cannot bind/i);
    expect(db.invoiceDocument.create).not.toHaveBeenCalled();
  });
});

describe("listInvoiceDocuments", () => {
  it("returns newest revision first with size, hash, and recipient", async () => {
    db.invoiceDocument.findMany.mockResolvedValue([
      {
        id: "idoc-2",
        revision: 2,
        role: "sent-copy",
        sentToEmail: "ap@northwind.test",
        createdAt: new Date("2026-08-01T10:00:00Z"),
        documentVersion: { sizeBytes: 2048, contentSha256: "def456" },
        createdBy: { email: "mark@example.test" },
      },
    ]);

    const [entry] = await listInvoiceDocuments("inv-1");

    expect(db.invoiceDocument.findMany.mock.calls[0][0].orderBy).toEqual([
      { role: "asc" },
      { revision: "desc" },
    ]);
    expect(entry).toMatchObject({
      revision: 2,
      sizeBytes: 2048,
      sha256: "def456",
      createdByEmail: "mark@example.test",
    });
  });

  it("tolerates a snapshot whose version metadata is absent", async () => {
    db.invoiceDocument.findMany.mockResolvedValue([
      {
        id: "idoc-1", revision: 1, role: "sent-copy", sentToEmail: null,
        createdAt: new Date(), documentVersion: null, createdBy: null,
      },
    ]);

    const [entry] = await listInvoiceDocuments("inv-1");
    expect(entry.sizeBytes).toBeNull();
    expect(entry.createdByEmail).toBeNull();
  });
});

describe("getInvoiceDocumentBlobRef", () => {
  it("names the file by invoice ref, role, and revision", async () => {
    db.invoiceDocument.findUnique.mockResolvedValue({
      revision: 2,
      role: "sent-copy",
      invoice: { invoiceRef: "INV-2026-0007" },
      documentVersion: {
        contentSha256: "abc123",
        contentBlob: { storageKey: "documents/sha256/ab/c1/abc123", mimeType: "application/pdf" },
      },
    });

    const ref = await getInvoiceDocumentBlobRef("idoc-1");

    expect(ref?.filename).toBe("INV-2026-0007-sent-copy-r2.pdf");
    expect(ref?.storageKey).toBe("documents/sha256/ab/c1/abc123");
  });

  it("returns null when the version has no blob behind it", async () => {
    db.invoiceDocument.findUnique.mockResolvedValue({
      revision: 1, role: "sent-copy",
      invoice: { invoiceRef: "INV-1" },
      documentVersion: { contentSha256: null, contentBlob: null },
    });

    expect(await getInvoiceDocumentBlobRef("idoc-1")).toBeNull();
  });

  it("returns null for an unknown snapshot", async () => {
    db.invoiceDocument.findUnique.mockResolvedValue(null);
    expect(await getInvoiceDocumentBlobRef("nope")).toBeNull();
  });
});
