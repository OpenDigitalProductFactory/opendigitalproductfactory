import crypto from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { syncDocumentReference } from "@dpf/db/neo4j-sync";
import { DOCUMENT_TEXT_INLINE_LIMIT_BYTES } from "./blob-storage";
import { searchDocumentVectors, storeDocumentVector } from "./embeddings";

export const DOCUMENT_STATES = ["draft", "published", "archived"] as const;
export type DocumentState = typeof DOCUMENT_STATES[number];

export type DocumentReferenceInput = {
  targetDocumentId?: string | null;
  targetExternalRef?: string | null;
  refType: string;
  anchor?: string | null;
};

export type SaveManagedDocumentInput = {
  documentId?: string | null;
  organizationId?: string | null;
  title: string;
  documentKind: string;
  contentFormat: string;
  contentText?: string | null;
  contentBlobId?: string | null;
  contentSha256?: string | null;
  summary?: string | null;
  tags?: string[];
  references?: DocumentReferenceInput[];
  accessScope?: string | null;
  sourceKind?: string | null;
  externalLocator?: Prisma.InputJsonValue | null;
  ownerPrincipalId?: string | null;
  createdByPrincipalId?: string | null;
  actorPrincipalId?: string | null;
};

export type DocumentSearchInput = {
  query?: string | null;
  mode?: "metadata" | "full-text" | "semantic" | "hybrid";
  organizationId?: string | null;
  currentState?: string | null;
  documentKind?: string | null;
  ownerPrincipalId?: string | null;
  tags?: string[];
  limit?: number;
};

export type ManagedDocument = {
  id: string;
  documentId: string;
  title: string;
  documentKind: string;
  contentFormat: string;
  currentState: string;
  accessScope: string;
  sourceKind: string;
  organizationId: string;
  ownerPrincipalId: string | null;
  createdByPrincipalId: string | null;
  currentVersionId: string | null;
  currentVersion: ManagedDocumentVersion | null;
  versions: ManagedDocumentVersion[];
  tags: string[];
  ownerName: string | null;
  createdByName: string | null;
  updatedAt: Date;
  createdAt: Date;
  semanticScore?: number;
  fullTextScore?: number;
  lifecycleEvents: ManagedDocumentLifecycleEvent[];
};

export type ManagedDocumentVersion = {
  id: string;
  version: number;
  title: string;
  contentFormat: string;
  contentText: string | null;
  contentBlobId: string | null;
  contentSha256: string | null;
  summary: string | null;
  sizeBytes: number | null;
  createdAt: Date;
};

export type ManagedDocumentLifecycleEvent = {
  id: string;
  fromState: string | null;
  toState: string;
  reason: string | null;
  actorName: string | null;
  createdAt: Date;
};

type DocumentStoreDb = typeof prisma;

const DOCUMENT_INCLUDE = {
  currentVersion: true,
  versions: { orderBy: { version: "desc" as const } },
  tags: true,
  ownerPrincipal: { select: { id: true, displayName: true } },
  createdByPrincipal: { select: { id: true, displayName: true } },
  lifecycleEvents: {
    orderBy: { createdAt: "desc" as const },
    take: 10,
    include: {
      actorPrincipal: { select: { id: true, displayName: true } },
    },
  },
};

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 25;
  return Math.min(Math.max(Math.trunc(limit ?? 25), 1), 100);
}

function normalizeState(state: string | null | undefined): DocumentState | null {
  if (!state) return null;
  if ((DOCUMENT_STATES as readonly string[]).includes(state)) return state as DocumentState;
  throw new Error(`Unsupported document state: ${state}`);
}

function nextDocumentId(): string {
  return `DOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function resolveOrganizationId(db: DocumentStoreDb, organizationId?: string | null): Promise<string> {
  if (organizationId) return organizationId;
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!org) throw new Error("No Organization row exists for document ownership.");
  return org.id;
}

function projectDocument(row: any, scores?: { semanticScore?: number; fullTextScore?: number }): ManagedDocument {
  return {
    id: row.id,
    documentId: row.documentId,
    title: row.title,
    documentKind: row.documentKind,
    contentFormat: row.contentFormat,
    currentState: row.currentState,
    accessScope: row.accessScope,
    sourceKind: row.sourceKind,
    organizationId: row.organizationId,
    ownerPrincipalId: row.ownerPrincipalId ?? null,
    createdByPrincipalId: row.createdByPrincipalId ?? null,
    currentVersionId: row.currentVersionId ?? null,
    currentVersion: row.currentVersion ? projectVersion(row.currentVersion) : null,
    versions: (row.versions ?? []).map(projectVersion),
    tags: (row.tags ?? []).map((tag: { tag: string }) => tag.tag),
    ownerName: row.ownerPrincipal?.displayName ?? null,
    createdByName: row.createdByPrincipal?.displayName ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lifecycleEvents: (row.lifecycleEvents ?? []).map(projectLifecycleEvent),
    ...(scores?.semanticScore !== undefined ? { semanticScore: scores.semanticScore } : {}),
    ...(scores?.fullTextScore !== undefined ? { fullTextScore: scores.fullTextScore } : {}),
  };
}

function projectVersion(row: any): ManagedDocumentVersion {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    contentFormat: row.contentFormat,
    contentText: row.contentText ?? null,
    contentBlobId: row.contentBlobId ?? null,
    contentSha256: row.contentSha256 ?? null,
    summary: row.summary ?? null,
    sizeBytes: row.sizeBytes ?? null,
    createdAt: row.createdAt,
  };
}

function projectLifecycleEvent(row: any): ManagedDocumentLifecycleEvent {
  return {
    id: row.id,
    fromState: row.fromState ?? null,
    toState: row.toState,
    reason: row.reason ?? null,
    actorName: row.actorPrincipal?.displayName ?? null,
    createdAt: row.createdAt,
  };
}

async function searchDocumentIdsByFullText(
  query: string,
  limit: number,
  db: DocumentStoreDb,
): Promise<Map<string, number>> {
  if (!query.trim()) return new Map();
  try {
    const rows = await db.$queryRawUnsafe<Array<{ documentId: string; rank: number | string | null }>>(
      `
        SELECT d."documentId",
               MAX(ts_rank_cd(v."searchVector", websearch_to_tsquery('english', $1)))::float AS rank
        FROM "Document" d
        JOIN "DocumentVersion" v ON v."documentId" = d."id"
        WHERE v."searchVector" @@ websearch_to_tsquery('english', $1)
        GROUP BY d."documentId"
        ORDER BY rank DESC
        LIMIT $2
      `,
      query,
      limit,
    );
    return new Map(rows.map((row) => [row.documentId, Number(row.rank ?? 0)]));
  } catch {
    return new Map();
  }
}

async function projectDocumentReferencesToGraph(documentDbId: string, db: DocumentStoreDb): Promise<void> {
  const references = await db.documentReference.findMany({
    where: { sourceDocumentId: documentDbId, targetDocumentId: { not: null } },
    include: {
      sourceDocument: { select: { documentId: true, title: true, currentState: true, documentKind: true } },
      targetDocument: { select: { documentId: true, title: true, currentState: true, documentKind: true } },
      sourceVersion: { select: { id: true } },
      targetVersion: { select: { id: true } },
    },
  });

  for (const reference of references) {
    if (!reference.targetDocument) continue;
    await syncDocumentReference({
      sourceDocumentId: reference.sourceDocument.documentId,
      sourceTitle: reference.sourceDocument.title,
      sourceState: reference.sourceDocument.currentState,
      sourceKind: reference.sourceDocument.documentKind,
      sourceVersionId: reference.sourceVersion?.id ?? reference.sourceVersionId,
      targetDocumentId: reference.targetDocument.documentId,
      targetTitle: reference.targetDocument.title,
      targetState: reference.targetDocument.currentState,
      targetKind: reference.targetDocument.documentKind,
      targetVersionId: reference.targetVersion?.id ?? reference.targetVersionId,
      refType: reference.refType,
      anchor: reference.anchor,
    }).catch((err: unknown) => {
      console.warn("[document-store] Neo4j document reference projection failed:", err);
    });
  }
}

export async function saveManagedDocument(input: SaveManagedDocumentInput, db: DocumentStoreDb = prisma): Promise<ManagedDocument> {
  const title = requireText(input.title, "title");
  const documentKind = requireText(input.documentKind, "documentKind");
  const contentFormat = requireText(input.contentFormat, "contentFormat");
  const contentText = input.contentText ?? null;
  if (!contentText && !input.contentBlobId && input.sourceKind !== "external") {
    throw new Error("contentText or contentBlobId is required for managed documents.");
  }
  if (contentText && Buffer.byteLength(contentText, "utf-8") > DOCUMENT_TEXT_INLINE_LIMIT_BYTES) {
    throw new Error("contentText exceeds the inline document limit; store it as a DocumentBlob.");
  }

  const organizationId = await resolveOrganizationId(db, input.organizationId);
  const tags = normalizeTags(input.tags);
  const stableDocumentId = input.documentId?.trim() || nextDocumentId();

  const saved = await db.$transaction(async (tx) => {
    const existing = await tx.document.findUnique({
      where: { documentId: stableDocumentId },
      select: { id: true, documentId: true, currentState: true },
    });
    const latest = existing
      ? await tx.documentVersion.findFirst({
          where: { documentId: existing.id },
          orderBy: { version: "desc" },
          select: { version: true },
        })
      : null;

    const document = existing
      ? await tx.document.update({
          where: { id: existing.id },
          data: {
            title,
            documentKind,
            contentFormat,
            accessScope: input.accessScope?.trim() || "organization",
            sourceKind: input.sourceKind?.trim() || "managed",
            externalLocator: input.externalLocator ?? undefined,
            ownerPrincipalId: input.ownerPrincipalId ?? input.actorPrincipalId ?? null,
            createdByPrincipalId: input.createdByPrincipalId ?? input.actorPrincipalId ?? null,
            fullTextIndexedAt: contentText ? new Date() : undefined,
          },
          select: { id: true },
        })
      : await tx.document.create({
          data: {
            documentId: stableDocumentId,
            organizationId,
            title,
            documentKind,
            contentFormat,
            accessScope: input.accessScope?.trim() || "organization",
            sourceKind: input.sourceKind?.trim() || "managed",
            externalLocator: input.externalLocator ?? undefined,
            currentState: "draft",
            ownerPrincipalId: input.ownerPrincipalId ?? input.actorPrincipalId ?? null,
            createdByPrincipalId: input.createdByPrincipalId ?? input.actorPrincipalId ?? null,
            fullTextIndexedAt: contentText ? new Date() : undefined,
          },
          select: { id: true },
        });

    const version = await tx.documentVersion.create({
      data: {
        documentId: document.id,
        version: (latest?.version ?? 0) + 1,
        title,
        contentFormat,
        contentText,
        contentBlobId: input.contentBlobId ?? null,
        contentSha256: input.contentSha256 ?? null,
        sizeBytes: contentText ? Buffer.byteLength(contentText, "utf-8") : null,
        summary: input.summary ?? null,
        createdByPrincipalId: input.createdByPrincipalId ?? input.actorPrincipalId ?? null,
      },
      select: { id: true },
    });

    await tx.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
      select: { id: true },
    });
    await tx.documentTag.deleteMany({ where: { documentId: document.id } });
    if (tags.length > 0) {
      await tx.documentTag.createMany({
        data: tags.map((tag) => ({ documentId: document.id, tag })),
        skipDuplicates: true,
      });
    }

    await tx.documentReference.deleteMany({ where: { sourceDocumentId: document.id, sourceVersionId: version.id } });
    for (const ref of input.references ?? []) {
      const refType = requireText(ref.refType, "refType");
      const target = ref.targetDocumentId
        ? await tx.document.findUnique({
            where: { documentId: ref.targetDocumentId },
            select: { id: true, currentVersionId: true },
          })
        : null;
      await tx.documentReference.create({
        data: {
          sourceDocumentId: document.id,
          sourceVersionId: version.id,
          targetDocumentId: target?.id ?? null,
          targetVersionId: target?.currentVersionId ?? null,
          targetExternalRef: target ? ref.targetExternalRef ?? null : ref.targetExternalRef ?? ref.targetDocumentId ?? null,
          refType,
          anchor: ref.anchor ?? null,
          createdByPrincipalId: input.actorPrincipalId ?? null,
        },
      });
    }

    return tx.document.findUniqueOrThrow({
      where: { id: document.id },
      include: DOCUMENT_INCLUDE,
    });
  });

  const projected = projectDocument(saved);
  const vectorStored = await storeDocumentVector({
    id: projected.id,
    documentId: projected.documentId,
    documentVersionId: projected.currentVersionId ?? "",
    organizationId: projected.organizationId,
    title: projected.title,
    documentKind: projected.documentKind,
    contentFormat: projected.contentFormat,
    currentState: projected.currentState,
    ownerPrincipalId: projected.ownerPrincipalId,
    tags: projected.tags,
    contentText: projected.currentVersion?.contentText ?? null,
    summary: projected.currentVersion?.summary ?? null,
  }).catch(() => false);

  if (vectorStored) {
    await db.document.update({
      where: { id: projected.id },
      data: { semanticIndexedAt: new Date() },
      select: { id: true },
    }).catch(() => null);
  }

  await projectDocumentReferencesToGraph(projected.id, db).catch(() => null);

  return projected;
}

export async function loadManagedDocument(input: { documentId: string; version?: number | null }, db: DocumentStoreDb = prisma): Promise<ManagedDocument | null> {
  const documentId = requireText(input.documentId, "documentId");
  const row = await db.document.findUnique({
    where: { documentId },
    include: DOCUMENT_INCLUDE,
  });
  if (!row) return null;
  const projected = projectDocument(row);
  if (input.version == null) return projected;
  const version = projected.versions.find((candidate) => candidate.version === input.version) ?? null;
  return { ...projected, currentVersion: version, currentVersionId: version?.id ?? null };
}

export async function searchManagedDocuments(input: DocumentSearchInput, db: DocumentStoreDb = prisma): Promise<ManagedDocument[]> {
  const query = input.query?.trim() ?? "";
  const limit = normalizeLimit(input.limit);
  const tags = normalizeTags(input.tags);
  const state = normalizeState(input.currentState);
  const mode = input.mode ?? "hybrid";
  const semanticResults = query && (mode === "semantic" || mode === "hybrid")
    ? await searchDocumentVectors({
        query,
        organizationId: input.organizationId ?? null,
        currentState: state,
        documentKind: input.documentKind ?? null,
        tags,
        limit,
      }).catch(() => [])
    : [];
  const semanticRank = new Map(semanticResults.map((result) => [result.documentId, result.score]));
  const fullTextRank = query && (mode === "full-text" || mode === "hybrid")
    ? await searchDocumentIdsByFullText(query, limit, db)
    : new Map<string, number>();

  const where: Record<string, unknown> = {};
  if (input.organizationId) where.organizationId = input.organizationId;
  if (state) where.currentState = state;
  if (input.documentKind) where.documentKind = input.documentKind;
  if (input.ownerPrincipalId) where.ownerPrincipalId = input.ownerPrincipalId;
  if (tags.length > 0) where.tags = { some: { tag: { in: tags } } };
  if (query) {
    where.OR = [
      { documentId: { contains: query, mode: "insensitive" } },
      { title: { contains: query, mode: "insensitive" } },
      { documentKind: { contains: query, mode: "insensitive" } },
      { tags: { some: { tag: { contains: query, mode: "insensitive" } } } },
      { versions: { some: { contentText: { contains: query, mode: "insensitive" } } } },
      { versions: { some: { summary: { contains: query, mode: "insensitive" } } } },
      ...(fullTextRank.size > 0 ? [{ documentId: { in: [...fullTextRank.keys()] } }] : []),
      ...(semanticResults.length > 0 ? [{ documentId: { in: semanticResults.map((result) => result.documentId) } }] : []),
    ];
  }

  const rows = await db.document.findMany({
    where: where as never,
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
    include: DOCUMENT_INCLUDE,
  });

  return rows
    .map((row) => projectDocument(row, {
      semanticScore: semanticRank.get(row.documentId),
      fullTextScore: fullTextRank.get(row.documentId),
    }))
    .sort((a, b) =>
      (b.semanticScore ?? 0) - (a.semanticScore ?? 0)
      || (b.fullTextScore ?? 0) - (a.fullTextScore ?? 0)
      || b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
}

export async function linkManagedDocuments(input: {
  sourceDocumentId: string;
  targetDocumentId?: string | null;
  targetExternalRef?: string | null;
  refType: string;
  anchor?: string | null;
  actorPrincipalId?: string | null;
}, db: DocumentStoreDb = prisma): Promise<{ referenceId: string }> {
  const source = await db.document.findUnique({
    where: { documentId: requireText(input.sourceDocumentId, "sourceDocumentId") },
    select: { id: true, currentVersionId: true },
  });
  if (!source) throw new Error(`Source document not found: ${input.sourceDocumentId}`);
  const target = input.targetDocumentId
    ? await db.document.findUnique({
        where: { documentId: input.targetDocumentId },
        select: { id: true, currentVersionId: true },
      })
    : null;

  const reference = await db.documentReference.create({
    data: {
      sourceDocumentId: source.id,
      sourceVersionId: source.currentVersionId,
      targetDocumentId: target?.id ?? null,
      targetVersionId: target?.currentVersionId ?? null,
      targetExternalRef: target ? input.targetExternalRef ?? null : input.targetExternalRef ?? input.targetDocumentId ?? null,
      refType: requireText(input.refType, "refType"),
      anchor: input.anchor ?? null,
      createdByPrincipalId: input.actorPrincipalId ?? null,
    },
    select: { id: true },
  });

  if (target) {
    await projectDocumentReferencesToGraph(source.id, db).catch(() => null);
  }

  return { referenceId: reference.id };
}

export async function listManagedDocumentVersions(documentId: string, db: DocumentStoreDb = prisma): Promise<ManagedDocumentVersion[]> {
  const doc = await db.document.findUnique({
    where: { documentId: requireText(documentId, "documentId") },
    select: { id: true },
  });
  if (!doc) return [];
  const versions = await db.documentVersion.findMany({
    where: { documentId: doc.id },
    orderBy: { version: "desc" },
  });
  return versions.map(projectVersion);
}

function assertAllowedTransition(fromState: string, toState: DocumentState): void {
  if (fromState === toState) return;
  const allowed =
    (fromState === "draft" && (toState === "published" || toState === "archived")) ||
    (fromState === "published" && toState === "archived") ||
    (fromState === "archived" && toState === "draft");
  if (!allowed) throw new Error(`Unsupported document lifecycle transition: ${fromState} -> ${toState}`);
}

export async function changeManagedDocumentState(input: {
  documentId: string;
  toState: string;
  reason?: string | null;
  actorPrincipalId?: string | null;
  toolExecutionId?: string | null;
}, db: DocumentStoreDb = prisma): Promise<ManagedDocument> {
  const toState = normalizeState(input.toState);
  if (!toState) throw new Error("toState is required.");

  const row = await db.$transaction(async (tx) => {
    const current = await tx.document.findUnique({
      where: { documentId: requireText(input.documentId, "documentId") },
      select: { id: true, currentState: true },
    });
    if (!current) throw new Error(`Document not found: ${input.documentId}`);
    assertAllowedTransition(current.currentState, toState);
    await tx.document.update({
      where: { id: current.id },
      data: {
        currentState: toState,
        archivedAt: toState === "archived" ? new Date() : null,
      },
      select: { id: true },
    });
    await tx.documentLifecycleEvent.create({
      data: {
        documentId: current.id,
        fromState: current.currentState,
        toState,
        reason: input.reason ?? null,
        actorPrincipalId: input.actorPrincipalId ?? null,
        toolExecutionId: input.toolExecutionId ?? null,
      },
    });
    return tx.document.findUniqueOrThrow({
      where: { id: current.id },
      include: DOCUMENT_INCLUDE,
    });
  });

  return projectDocument(row);
}

export async function listManagedDocumentReferences(documentId: string, db: DocumentStoreDb = prisma) {
  const doc = await db.document.findUnique({
    where: { documentId: requireText(documentId, "documentId") },
    select: { id: true },
  });
  if (!doc) return { inbound: [], outbound: [] };
  const [outbound, inbound] = await Promise.all([
    db.documentReference.findMany({
      where: { sourceDocumentId: doc.id },
      orderBy: { createdAt: "desc" },
      include: {
        targetDocument: { select: { documentId: true, title: true, currentState: true } },
        sourceVersion: { select: { version: true } },
        targetVersion: { select: { version: true } },
      },
    }),
    db.documentReference.findMany({
      where: { targetDocumentId: doc.id },
      orderBy: { createdAt: "desc" },
      include: {
        sourceDocument: { select: { documentId: true, title: true, currentState: true } },
        sourceVersion: { select: { version: true } },
        targetVersion: { select: { version: true } },
      },
    }),
  ]);
  return { inbound, outbound };
}
