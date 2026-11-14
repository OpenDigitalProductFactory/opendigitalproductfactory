// packages/db/src/entity-reference-sync.ts
//
// The reference writer (BI-A63A9476; spec 2026-10-14 §5). Every committed write
// of a body field calls `syncEntityReferences`. It parses the body with the one
// parser (wiki-frontmatter.ts), keeps the mentions that resolve to an existing
// key, applies R4 (entity-reference-scope.ts) and replaces the source's
// `MENTIONS` edges, so running it twice on the same body changes nothing.
//
// Import-safe: no dotenv, no CLI specifiers, no disconnect. The rebuild runner
// lives in rebuild-entity-references.ts.

import { prisma } from "./client";
import { GraphNodeLabelConflictError, replaceGraphEdgesFromSource, upsertContentFreeNode, upsertGraphEdge } from "./graph-sync";
import { entityKindOfId, extractEntityIds, extractWikilinks } from "./wiki-frontmatter";
import { resolveWikiLinkTargets } from "./wiki-links";
import {
  planReferenceEdges,
  REBUILD_WRITER,
  recordScope,
  REFERENCE_NODE_LABEL,
  REFERENCE_REL_TYPE,
  referenceDirectionAllowed,
  wikiPageScope,
  type ReferenceEntityKind,
  type ReferenceScope,
  type ReferenceSourceField,
  type ReferenceTarget,
} from "./entity-reference-scope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAction<TResult = unknown> = (args: any) => Promise<TResult>;

/** The slice of the Prisma client the resolver reads; a $transaction client fits. */
export type EntityReferenceDb = {
  backlogItem: { findMany: PrismaAction };
  epic: { findMany: PrismaAction };
  document: { findMany: PrismaAction };
  workroom: { findMany: PrismaAction };
  wikiPage: { findMany: PrismaAction };
};

export type EntityReferenceSourceInput = {
  kind: ReferenceEntityKind;
  /** The graph key: itemId, epicId, documentId, WikiPage.id or the message id. */
  key: string;
  organizationId: string | null;
  /** Wiki sources: the slug, which places a null-organization page in the kernel or a profession. */
  slug?: string;
  field: ReferenceSourceField;
  /** Who wrote this body. Null (a rebuild) keeps each existing edge's writer. */
  writtenBy: string | null;
  roomId?: string | null;
};

export type EntityReferenceSyncResult = {
  written: string[];
  /** Mentions that resolve but break R4 or a node label; shown to the author like an unknown id. */
  refused: string[];
  unresolved: string[];
};

function sourceScopeOf(source: EntityReferenceSourceInput): ReferenceScope {
  return source.kind === "wiki"
    ? wikiPageScope({ slug: source.slug ?? "", organizationId: source.organizationId })
    : recordScope(source.organizationId);
}

/** Resolve a body's mentions to targets that exist, each with its scope. */
export async function resolveReferenceTargets(
  db: EntityReferenceDb,
  source: EntityReferenceSourceInput,
  body: string,
): Promise<{ targets: ReferenceTarget[]; unresolved: string[] }> {
  const ids = extractEntityIds(body);
  const byKind = (kind: string) => ids.filter((id) => entityKindOfId(id) === kind);
  const backlogIds = byKind("backlog");
  const epicIds = byKind("epic");
  const documentIds = byKind("document");
  const roomIds = byKind("workroom");
  // Wiki-to-wiki links stay on LINKS_TO; only a non-wiki body references a page.
  const slugs = source.kind === "wiki" ? [] : extractWikilinks(body).filter((slug) => !slug.startsWith("raw-sources/"));

  const [items, epics, documents, rooms, pageIdsBySlug] = await Promise.all([
    backlogIds.length ? db.backlogItem.findMany({ where: { itemId: { in: backlogIds } }, select: { itemId: true, organizationId: true } }) : [],
    epicIds.length ? db.epic.findMany({ where: { epicId: { in: epicIds } }, select: { epicId: true } }) : [],
    documentIds.length ? db.document.findMany({ where: { documentId: { in: documentIds } }, select: { documentId: true, organizationId: true } }) : [],
    roomIds.length ? db.workroom.findMany({ where: { capsuleId: { in: roomIds } }, select: { capsuleId: true } }) : [],
    resolveWikiLinkTargets(db as never, source.organizationId, slugs),
  ]) as [
    Array<{ itemId: string; organizationId: string | null }>,
    Array<{ epicId: string }>,
    Array<{ documentId: string; organizationId: string }>,
    Array<{ capsuleId: string }>,
    Map<string, string>,
  ];
  const pageIds = [...new Set(pageIdsBySlug.values())];
  const pages = pageIds.length
    ? ((await db.wikiPage.findMany({ where: { id: { in: pageIds } }, select: { id: true, slug: true, organizationId: true } })) as Array<{ id: string; slug: string; organizationId: string | null }>)
    : [];

  const found = new Map<string, ReferenceTarget>();
  for (const row of items) found.set(row.itemId, { kind: "backlog", key: row.itemId, scope: recordScope(row.organizationId) });
  for (const row of epics) found.set(row.epicId, { kind: "epic", key: row.epicId, scope: recordScope(null) });
  for (const row of documents) found.set(row.documentId, { kind: "document", key: row.documentId, scope: recordScope(row.organizationId) });
  for (const row of rooms) found.set(row.capsuleId, { kind: "workroom", key: row.capsuleId, scope: recordScope(null) });
  const pagesById = new Map(pages.map((page) => [page.id, page]));

  const targets: ReferenceTarget[] = [];
  const unresolved: string[] = [];
  for (const id of ids) {
    const target = found.get(id);
    if (target) targets.push(target);
    else unresolved.push(id);
  }
  for (const slug of slugs) {
    const page = pagesById.get(pageIdsBySlug.get(slug) ?? "");
    if (page) targets.push({ kind: "wiki", key: page.id, scope: wikiPageScope(page) });
    else unresolved.push(slug);
  }
  return { targets, unresolved };
}

async function existingWriters(srcKey: string): Promise<Map<string, string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ dst_key: string; written_by: string | null }>>(
    `SELECT dst_key, props->>'writtenBy' AS written_by
       FROM graph_edge WHERE src_key = $1 AND rel_type = 'MENTIONS'`,
    srcKey,
  );
  return new Map(rows.filter((r) => r.written_by).map((r) => [r.dst_key, r.written_by as string]));
}

function scopeProps(scope: ReferenceScope, roomId?: string | null): Record<string, unknown> {
  return { scope: scope.corpus, organizationId: scope.organizationId, ...(roomId ? { roomId } : {}) };
}

/**
 * Make the source's `MENTIONS` edges exactly the resolvable, allowed mentions
 * in `body`. Nodes for gated kinds carry only key, label and scope. Throws on a
 * database failure; callers that follow a user's save catch and log it.
 */
export async function syncEntityReferences(
  source: EntityReferenceSourceInput,
  body: string,
  options: { db?: EntityReferenceDb; now?: Date } = {},
): Promise<EntityReferenceSyncResult> {
  const db = options.db ?? (prisma as unknown as EntityReferenceDb);
  const scope = sourceScopeOf(source);
  const { targets, unresolved } = await resolveReferenceTargets(db, source, body ?? "");
  const writers = await existingWriters(source.key);
  const plan = planReferenceEdges(
    { kind: source.kind, key: source.key, scope, field: source.field, writtenBy: source.writtenBy ?? REBUILD_WRITER, roomId: source.roomId ?? null },
    targets,
    { now: options.now ?? new Date(), existingWriters: writers },
  );
  const refused = plan.refused.map((target) => target.key);

  if (source.kind !== "wiki") {
    await upsertContentFreeNode(source.key, REFERENCE_NODE_LABEL[source.kind], scopeProps(scope, source.roomId));
  }
  const byKey = new Map(targets.map((target) => [target.key, target]));
  const edges = [];
  for (const edge of plan.edges) {
    const target = byKey.get(edge.dstKey)!;
    if (target.kind !== "wiki") {
      try {
        await upsertContentFreeNode(target.key, REFERENCE_NODE_LABEL[target.kind], scopeProps(target.scope));
      } catch (err) {
        if (!(err instanceof GraphNodeLabelConflictError)) throw err;
        refused.push(target.key);
        continue;
      }
    }
    edges.push(edge);
  }
  await replaceGraphEdgesFromSource(source.key, REFERENCE_REL_TYPE, edges);
  return { written: edges.map((edge) => edge.dstKey), refused, unresolved };
}

/**
 * `merge_backlog_items`: re-point the merged item's inbound edges at the item
 * that survives. An edge the survivor's scope would refuse under R4 is dropped.
 */
export async function repointReferenceTarget(fromKey: string, toKey: string, toScope: ReferenceScope): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ src_key: string; dst_key: string; props: Record<string, unknown> }>>(
    `SELECT src_key, dst_key, props FROM graph_edge WHERE dst_key = $1 AND rel_type = 'MENTIONS'`,
    fromKey,
  );
  let moved = 0;
  for (const row of rows) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM graph_edge WHERE src_key = $1 AND dst_key = $2 AND rel_type = 'MENTIONS'`,
      row.src_key,
      fromKey,
    );
    const sourceScope: ReferenceScope = {
      corpus: (row.props.sourceScope as ReferenceScope["corpus"]) ?? "install",
      organizationId: (row.props.sourceOrganizationId as string | null) ?? null,
      family: (row.props.sourceFamily as string | null) ?? null,
    };
    if (row.src_key === toKey || !referenceDirectionAllowed(sourceScope, toScope)) continue;
    await upsertGraphEdge(row.src_key, toKey, REFERENCE_REL_TYPE, {
      ...row.props,
      targetScope: toScope.corpus,
      targetOrganizationId: toScope.organizationId,
      targetFamily: toScope.family,
      syncedAt: new Date().toISOString(),
    });
    moved += 1;
  }
  return moved;
}

/** A wiki page, document or message was deleted: remove the edges that start or end at it. */
export async function removeEntityReferences(key: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_edge WHERE rel_type = 'MENTIONS' AND (src_key = $1 OR dst_key = $1)`,
    key,
  );
}
