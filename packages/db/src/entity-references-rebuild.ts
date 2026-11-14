// packages/db/src/entity-references-rebuild.ts
//
// `references:rebuild` (BI-A63A9476; spec 2026-10-14 §5 "Rebuild"): run the
// reference writer over every body, then drop the MENTIONS edges of sources
// that no longer exist. Every step is the idempotent writer, so the rebuild can
// be re-run at any time; the weekly job and the CLI both call this. Kernel and
// profession pages are not visited: R4 gives them no edges, so any they have
// are pruned.
//
// Import-safe (no dotenv, no disconnect); the CLI runner is
// rebuild-entity-references.ts.

import { prisma } from "./client";
import { syncEntityReferences, type EntityReferenceSourceInput, type EntityReferenceSyncResult } from "./entity-reference-sync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAction<TResult = unknown> = (args: any) => Promise<TResult>;

export type EntityReferenceRebuildDb = {
  backlogItem: { findMany: PrismaAction };
  epic: { findMany: PrismaAction };
  document: { findMany: PrismaAction };
  wikiPage: { findMany: PrismaAction };
  workItemMessage: { findMany: PrismaAction };
};

export type EntityReferenceRebuildResult = { sources: number; edges: number; refused: number; failures: number; pruned: number };

type SourceRow = { source: EntityReferenceSourceInput; body: string };

const DEFAULT_PAGE_SIZE = 200;

async function* pages<T>(findMany: PrismaAction, args: Record<string, unknown>, pageSize: number): AsyncGenerator<T> {
  for (let skip = 0; ; skip += pageSize) {
    const rows = (await findMany({ ...args, skip, take: pageSize })) as T[];
    for (const row of rows) yield row;
    if (rows.length < pageSize) return;
  }
}

const by = (prefix: string, id: string | null | undefined) => (id ? `${prefix}:${id}` : null);

async function* bodySources(db: EntityReferenceRebuildDb, pageSize: number): AsyncGenerator<SourceRow> {
  for await (const row of pages<{ itemId: string; organizationId: string | null; body: string | null; submittedById: string | null; agentId: string | null }>(
    db.backlogItem.findMany,
    { select: { itemId: true, organizationId: true, body: true, submittedById: true, agentId: true }, orderBy: { itemId: "asc" } },
    pageSize,
  )) {
    yield {
      source: { kind: "backlog", key: row.itemId, organizationId: row.organizationId, field: "body", writtenBy: by("user", row.submittedById) ?? by("agent", row.agentId) },
      body: row.body ?? "",
    };
  }
  for await (const row of pages<{ epicId: string; description: string | null; submittedById: string | null }>(
    db.epic.findMany,
    { select: { epicId: true, description: true, submittedById: true }, orderBy: { epicId: "asc" } },
    pageSize,
  )) {
    yield { source: { kind: "epic", key: row.epicId, organizationId: null, field: "description", writtenBy: by("user", row.submittedById) }, body: row.description ?? "" };
  }
  for await (const row of pages<{ documentId: string; organizationId: string; currentVersion: { contentText: string | null; createdByPrincipalId: string | null } | null }>(
    db.document.findMany,
    { select: { documentId: true, organizationId: true, currentVersion: { select: { contentText: true, createdByPrincipalId: true } } }, orderBy: { documentId: "asc" } },
    pageSize,
  )) {
    yield {
      source: { kind: "document", key: row.documentId, organizationId: row.organizationId, field: "body", writtenBy: by("principal", row.currentVersion?.createdByPrincipalId) },
      body: row.currentVersion?.contentText ?? "",
    };
  }
  for await (const row of pages<{ id: string; slug: string; organizationId: string; body: string }>(
    db.wikiPage.findMany,
    { where: { organizationId: { not: null } }, select: { id: true, slug: true, organizationId: true, body: true }, orderBy: { id: "asc" } },
    pageSize,
  )) {
    yield { source: { kind: "wiki", key: row.id, organizationId: row.organizationId, slug: row.slug, field: "body", writtenBy: null }, body: row.body };
  }
  for await (const row of pages<{ id: string; body: string; senderUserId: string | null; senderAgentId: string | null; workItem: { capsules: Array<{ id: string }> } }>(
    db.workItemMessage.findMany,
    {
      where: { workItem: { capsules: { some: {} } } },
      select: { id: true, body: true, senderUserId: true, senderAgentId: true, workItem: { select: { capsules: { select: { id: true }, take: 1, orderBy: { createdAt: "asc" } } } } },
      orderBy: { id: "asc" },
    },
    pageSize,
  )) {
    const roomId = row.workItem.capsules[0]?.id ?? null;
    yield {
      source: { kind: "message", key: row.id, organizationId: null, field: "message", writtenBy: by("user", row.senderUserId) ?? by("agent", row.senderAgentId), roomId },
      body: row.body,
    };
  }
}

export async function rebuildEntityReferences(
  options: { db?: EntityReferenceRebuildDb; sync?: (source: EntityReferenceSourceInput, body: string) => Promise<EntityReferenceSyncResult>; pageSize?: number } = {},
): Promise<EntityReferenceRebuildResult> {
  const db = options.db ?? (prisma as unknown as EntityReferenceRebuildDb);
  const sync = options.sync ?? ((source, body) => syncEntityReferences(source, body));
  const result: EntityReferenceRebuildResult = { sources: 0, edges: 0, refused: 0, failures: 0, pruned: 0 };
  const visited: string[] = [];
  for await (const { source, body } of bodySources(db, options.pageSize ?? DEFAULT_PAGE_SIZE)) {
    visited.push(source.key);
    result.sources += 1;
    try {
      const synced = await sync(source, body);
      result.edges += synced.written.length;
      result.refused += synced.refused.length;
    } catch (err) {
      result.failures += 1;
      console.warn(`[references:rebuild] ${source.kind} ${source.key} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  result.pruned = Number(
    await prisma.$executeRawUnsafe(
      `DELETE FROM graph_edge WHERE rel_type = 'MENTIONS' AND NOT (src_key = ANY($1::text[]))`,
      visited,
    ),
  );
  return result;
}
