// An in-memory document store world for the isolation suites (BI-957915CB).
//
// One restricted document (DOC-SECRET) owned by p-owner, created by p-creator,
// granted to p-grantee (no expiry) and p-expired (already expired); one
// organization document (DOC-PUBLIC) that cites it. Every read applies the
// `where` it is given through matchesWhere, so a test proves what a query
// selects. Full-text search nominates every matching document, readable or
// not, exactly as the real ranked SQL does.

import { matchesWhere } from "./document-access.test-support";

type Row = Record<string, unknown>;

export const NOW = new Date("2026-10-14T12:00:00Z");

export const PRINCIPAL_BY_USER: Readonly<Record<string, string>> = {
  "u-owner": "p-owner",
  "u-creator": "p-creator",
  "u-grantee": "p-grantee",
  "u-expired": "p-expired",
  "u-stranger": "p-stranger",
};

/** Viewers who may read DOC-SECRET, and viewers who may not. */
export const ALLOWED_USERS = ["u-owner", "u-creator", "u-grantee"] as const;
export const REFUSED_USERS = ["u-stranger", "u-expired", "u-unknown"] as const;

export function viewerFor(userId: string) {
  return { principalId: PRINCIPAL_BY_USER[userId] ?? null };
}

function version(id: string, documentDbId: string, title: string, text: string): Row {
  return {
    id,
    documentId: documentDbId,
    version: 1,
    title,
    contentFormat: "application/pdf",
    contentText: text,
    contentBlobId: `blob-${id}`,
    contentBlob: { storageKey: `key-${id}`, sha256: `sha-${id}`, mimeType: "application/pdf" },
    contentSha256: `sha-${id}`,
    summary: null,
    sizeBytes: 10,
    createdAt: NOW,
    renditions: [
      { id: `r-pdf-${id}`, renditionKind: "pdf", mimeType: "application/pdf", blobId: `pdf-${id}`, blob: { storageKey: `pdfkey-${id}`, sha256: `pdfsha-${id}` }, contentText: null, createdAt: NOW },
      { id: `r-txt-${id}`, renditionKind: "plain_text", mimeType: "text/plain", blobId: null, blob: null, contentText: text, createdAt: NOW },
      { id: `r-prev-${id}`, renditionKind: "preview", mimeType: "application/json", blobId: `prev-${id}`, blob: { storageKey: `prevkey-${id}`, sha256: `prevsha-${id}` }, contentText: null, createdAt: NOW },
    ],
  };
}

function documentRow(input: { id: string; documentId: string; title: string; accessScope: string; text: string; grants?: Row[] }): Row {
  const v = version(`ver-${input.id}`, input.id, input.title, input.text);
  return {
    id: input.id,
    documentId: input.documentId,
    title: input.title,
    documentKind: "report",
    contentFormat: "application/pdf",
    currentState: "draft",
    accessScope: input.accessScope,
    sourceKind: "managed",
    organizationId: "org-1",
    ownerPrincipalId: "p-owner",
    createdByPrincipalId: "p-creator",
    currentVersionId: v.id,
    currentVersion: v,
    versions: [v],
    tags: [{ tag: "board" }],
    accessGrants: input.grants ?? [],
    lifecycleEvents: [],
    ownerPrincipal: { id: "p-owner", displayName: "Owner" },
    createdByPrincipal: { id: "p-creator", displayName: "Creator" },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export type FakeDocumentWorld = ReturnType<typeof createDocumentWorld>;

export function createDocumentWorld() {
  const secret = documentRow({
    id: "db-secret",
    documentId: "DOC-SECRET",
    title: "Board salary review",
    accessScope: "restricted",
    text: "salary bands for the board",
    grants: [
      { principalId: "p-grantee", expiresAt: null },
      { principalId: "p-expired", expiresAt: new Date("2026-10-01T00:00:00Z") },
    ],
  });
  const open = documentRow({
    id: "db-public",
    documentId: "DOC-PUBLIC",
    title: "Holiday calendar",
    accessScope: "organization",
    text: "public holidays and salary review dates",
  });
  const documents: Row[] = [secret, open];
  const references: Row[] = [
    { id: "ref-1", sourceDocumentId: "db-public", sourceVersionId: "ver-db-public", targetDocumentId: "db-secret", targetVersionId: "ver-db-secret", targetExternalRef: null, refType: "cites", anchor: null, createdAt: NOW },
  ];
  const lifecycleEvents: Row[] = [];

  const byDbId = (id: unknown) => documents.find((doc) => doc.id === id) ?? null;
  const withReferenceRelations = (ref: Row): Row => ({
    ...ref,
    sourceDocument: byDbId(ref.sourceDocumentId),
    targetDocument: ref.targetDocumentId ? byDbId(ref.targetDocumentId) : null,
    sourceVersion: { version: 1, id: ref.sourceVersionId },
    targetVersion: ref.targetVersionId ? { version: 1, id: ref.targetVersionId } : null,
  });
  const findDocs = (where: unknown) => documents.filter((doc) => matchesWhere(doc, where, NOW));
  const uniqueWhere = (where: Record<string, unknown>) =>
    documents.find((doc) => (where.id !== undefined ? doc.id === where.id : doc.documentId === where.documentId)) ?? null;

  const db = {
    document: {
      findFirst: async ({ where }: { where: unknown }) => findDocs(where)[0] ?? null,
      findMany: async ({ where, take }: { where: unknown; take?: number }) => findDocs(where).slice(0, take ?? 100),
      findUnique: async ({ where }: { where: Record<string, unknown> }) => uniqueWhere(where),
      findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => {
        const row = uniqueWhere(where);
        if (!row) throw new Error("not found");
        return row;
      },
      update: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
        const row = uniqueWhere(where)!;
        for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
        return { id: row.id };
      },
      create: async ({ data }: { data: Row }) => {
        const base = documentRow({ id: `db-new-${documents.length}`, documentId: String(data.documentId), title: String(data.title), accessScope: String(data.accessScope), text: "" });
        const row: Row = { ...base, ...data, versions: [], tags: [], accessGrants: [] };
        documents.push(row);
        return { id: row.id };
      },
    },
    documentVersion: {
      findFirst: async ({ where }: { where: Row }) => (byDbId(where.documentId)?.versions as Row[] | undefined)?.[0] ?? null,
      findMany: async ({ where }: { where: Row }) => (byDbId(where.documentId)?.versions as Row[] | undefined) ?? [],
      create: async ({ data }: { data: Row }) => {
        const doc = byDbId(data.documentId)!;
        const row: Row = { id: `ver-new-${(doc.versions as Row[]).length + 1}`, ...data, renditions: [], createdAt: NOW };
        (doc.versions as Row[]).unshift(row);
        doc.currentVersion = row;
        return { id: row.id };
      },
    },
    documentReference: {
      findMany: async ({ where }: { where: unknown }) =>
        references.map(withReferenceRelations).filter((ref) => matchesWhere(ref, where, NOW)),
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Row }) => {
        const row = { id: `ref-${references.length + 1}`, createdAt: NOW, ...data };
        references.push(row);
        return { id: row.id };
      },
    },
    documentTag: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    documentLifecycleEvent: {
      create: async ({ data }: { data: Row }) => {
        lifecycleEvents.push(data);
        return data;
      },
    },
    documentRendition: {
      findUnique: async ({ where }: { where: { documentVersionId_renditionKind: { documentVersionId: string; renditionKind: string } } }) => {
        const key = where.documentVersionId_renditionKind;
        for (const doc of documents) {
          for (const v of doc.versions as Row[]) {
            if (v.id === key.documentVersionId) return (v.renditions as Row[]).find((r) => r.renditionKind === key.renditionKind) ?? null;
          }
        }
        return null;
      },
      upsert: async () => ({ id: "upserted" }),
    },
    documentBlob: { findUnique: async () => ({ storageKey: "png", sha256: "png-sha" }) },
    principal: { findMany: async () => [] },
    organization: { findFirst: async () => ({ id: "org-1" }) },
    $queryRawUnsafe: async (_sql: string, query: string) =>
      documents
        .filter((doc) => String((doc.currentVersion as Row).contentText ?? "").includes(String(query)))
        .map((doc) => ({ documentId: doc.documentId, rank: 1 })),
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return { db, documents, references, lifecycleEvents, secret, open };
}
