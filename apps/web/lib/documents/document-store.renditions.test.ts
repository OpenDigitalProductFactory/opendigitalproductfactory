// BI-9D43CBEF: the document store's side of renditions — the save requests
// them, search reads their text, and a load returns them.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestDocumentRenditions = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./rendition-trigger", () => ({ requestDocumentRenditions }));
vi.mock("./embeddings", () => ({
  storeDocumentVector: vi.fn(async () => false),
  searchDocumentVectors: vi.fn(async () => []),
}));
vi.mock("@dpf/db/graph-sync", () => ({ syncDocumentReference: vi.fn(async () => undefined) }));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { loadManagedDocument, saveManagedDocument, searchManagedDocuments } from "./document-store";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
type Row = Record<string, unknown>;

function savedRow(contentFormat: string, contentBlobId: string | null): Row {
  const version = {
    id: "ver-1",
    version: 1,
    title: "Board pack",
    contentFormat,
    contentText: contentBlobId ? null : "hello",
    contentBlobId,
    contentSha256: null,
    summary: null,
    sizeBytes: null,
    createdAt: new Date(),
    renditions: [
      { id: "r1", renditionKind: "pdf", mimeType: "application/pdf", blobId: "pdf-blob", createdAt: new Date("2026-09-25T06:00:00Z") },
    ],
  };
  return {
    id: "doc-db-1",
    documentId: "DOC-1",
    title: "Board pack",
    documentKind: "report",
    contentFormat,
    currentState: "draft",
    accessScope: "organization",
    sourceKind: "managed",
    organizationId: "org-1",
    currentVersionId: "ver-1",
    currentVersion: version,
    versions: [version],
    tags: [],
    lifecycleEvents: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function fakeDb(row: Row) {
  const tx = {
    document: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "doc-db-1" })),
      update: vi.fn(async () => ({ id: "doc-db-1" })),
      findUniqueOrThrow: vi.fn(async () => row),
    },
    documentVersion: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "ver-1" })),
    },
    documentTag: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
    documentReference: { deleteMany: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
  };
  return {
    organization: { findFirst: vi.fn(async () => ({ id: "org-1" })) },
    $transaction: vi.fn(async (work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    document: {
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => row),
      findMany: vi.fn(async () => [row]),
    },
    documentReference: { findMany: vi.fn(async () => []) },
    $queryRawUnsafe: vi.fn(async () => [] as Row[]),
  };
}

beforeEach(() => requestDocumentRenditions.mockClear());

describe("saveManagedDocument requests renditions (BI-9D43CBEF)", () => {
  it("asks for renditions when the saved version is an office blob", async () => {
    const db = fakeDb(savedRow(DOCX, "blob-1"));
    await saveManagedDocument({ title: "Board pack", documentKind: "report", contentFormat: DOCX, contentBlobId: "blob-1" }, db as never);
    expect(requestDocumentRenditions).toHaveBeenCalledWith("ver-1");
  });

  it("does not ask for renditions of a markdown document", async () => {
    const db = fakeDb(savedRow("text/markdown", null));
    await saveManagedDocument({ title: "Notes", documentKind: "brief", contentFormat: "text/markdown", contentText: "hello" }, db as never);
    expect(requestDocumentRenditions).not.toHaveBeenCalled();
  });
});

describe("renditions in load and search (BI-9D43CBEF)", () => {
  it("projects each version's renditions without their text", async () => {
    const db = fakeDb(savedRow(DOCX, "blob-1"));
    const document = await loadManagedDocument({ documentId: "DOC-1" }, db as never);
    expect(document?.currentVersion?.renditions).toEqual([
      { id: "r1", kind: "pdf", mimeType: "application/pdf", blobId: "pdf-blob", createdAt: new Date("2026-09-25T06:00:00Z") },
    ]);
    const include = ((db.document.findUnique.mock.calls as unknown as unknown[][])[0]![0] as unknown as Row).include as Row;
    expect(JSON.stringify(include)).toContain("renditions");
    expect(JSON.stringify(include)).not.toContain("contentText");
  });

  it("full-text search also matches plain-text rendition text", async () => {
    const db = fakeDb(savedRow(DOCX, "blob-1"));
    await searchManagedDocuments({ query: "adoption figures", mode: "full-text" }, db as never);
    const sql = String((db.$queryRawUnsafe.mock.calls as unknown as unknown[][])[0]![0]);
    expect(sql).toContain(`JOIN "DocumentRendition" r`);
    expect(sql).toContain(`r."renditionKind" = 'plain_text'`);
    expect(sql).toContain(`r."searchVector" @@ websearch_to_tsquery('english', $1)`);

    const where = ((db.document.findMany.mock.calls as unknown as unknown[][])[0]![0] as unknown as Row).where as { OR: Row[] };
    expect(where.OR).toContainEqual({
      versions: { some: { renditions: { some: { renditionKind: "plain_text", contentText: { contains: "adoption figures", mode: "insensitive" } } } } },
    });
  });
});
