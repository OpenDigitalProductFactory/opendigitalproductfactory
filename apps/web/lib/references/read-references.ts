// BI-A63A9476: the one reader of reference edges (spec 2026-10-14 §3.4).
//
// Every "Referenced by" surface, the renderer's id resolution and the MCP
// `referencedBy` field call this module; none queries graph_edge and decides
// visibility itself. R1 shapes it: an entity the reader cannot open is left out
// entirely, with no title, no snippet, no count and no placeholder. Each read:
//   1. pushes the cheap filters (organization, corpus, profession family) into SQL;
//   2. checks readability once per kind, never once per row;
//   3. loads titles and snippets from the source rows that passed, at read time.
// Pagination is keyset on the far-end key and counts only rows that passed.

import { recordScope, wikiPageScope, type ReferenceCorpus, type ReferenceEntityKind } from "@dpf/db/entity-reference-scope";
import { entityKindOfId } from "@dpf/db/wiki-frontmatter";

import { readableDocumentWhere, type DocumentViewer } from "@/lib/documents/document-access";
import { wikiReaderForCorpusScope, type CorpusReadScope } from "@/lib/tak/corpus-read-scope";
import { canReadWikiPage } from "@/lib/wiki/backlinks";

import { entityHref } from "./entity-reference-hrefs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaAction<TResult = unknown> = (args: any) => Promise<TResult>;

export type ReferenceReadDb = {
  $queryRawUnsafe: <T = unknown>(sql: string, ...params: unknown[]) => Promise<T>;
  backlogItem: { findMany: PrismaAction };
  epic: { findMany: PrismaAction };
  document: { findMany: PrismaAction };
  wikiPage: { findMany: PrismaAction };
  workroom: { findMany: PrismaAction };
  workItemMessage: { findMany: PrismaAction };
};

/** Who is reading (R2). For a coworker the fields are already the intersection with its operator. */
export type ReferenceReader = {
  kind: "person" | "agent";
  userId: string | null;
  agentId: string | null;
  /** From the session (or the operator's), never `organization.findFirst()`. */
  organizationId: string | null;
  corpus: CorpusReadScope;
  /** Backlog read capability (people: view_operations; agents: backlog_read and the operator's capability). */
  canReadBacklog: boolean;
  /** Sensitivity levels held; for an agent, those both it and its operator hold. */
  clearance: ReadonlySet<string>;
  /** Documents are always read as the person (BI-957915CB). */
  documentViewer: DocumentViewer;
};

export type ReferenceReadDeps = {
  db: ReferenceReadDb;
  /** Room admission at `content` for this reader, by Workroom row id. */
  canReadRoom: (roomRowId: string) => Promise<boolean>;
};

export type ReferenceRow = {
  key: string;
  kind: ReferenceEntityKind;
  title: string;
  status: string | null;
  scope: ReferenceCorpus;
  href: string;
  snippet: string | null;
};

export type ReferencePage = { rows: ReferenceRow[]; count: number; nextCursor: string | null };

export type ReferencePageRequest = { after?: string | null; limit?: number; snippets?: boolean; mention?: string };

type Loaded = Omit<ReferenceRow, "snippet"> & { family: string | null; body: string | null };

const RESTRICTED_SENSITIVITIES = new Set(["confidential", "restricted"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function backlogReadable(reader: ReferenceReader, row: { organizationId: string | null; sensitivity: string }): boolean {
  if (row.organizationId !== null && row.organizationId !== reader.organizationId) return false;
  return !RESTRICTED_SENSITIVITIES.has(row.sensitivity) || reader.clearance.has(row.sensitivity);
}

async function loadKind(reader: ReferenceReader, kind: ReferenceEntityKind, keys: string[], deps: ReferenceReadDeps): Promise<Loaded[]> {
  if (keys.length === 0) return [];
  const { db } = deps;
  switch (kind) {
    case "backlog": {
      if (!reader.canReadBacklog) return [];
      const rows = (await db.backlogItem.findMany({
        where: { itemId: { in: keys } },
        select: { itemId: true, title: true, status: true, organizationId: true, sensitivity: true, body: true },
      })) as Array<{ itemId: string; title: string; status: string; organizationId: string | null; sensitivity: string; body: string | null }>;
      return rows.filter((row) => backlogReadable(reader, row)).map((row) => ({
        key: row.itemId, kind, title: row.title, status: row.status, scope: recordScope(row.organizationId).corpus,
        href: entityHref(kind, row.itemId), family: null, body: row.body,
      }));
    }
    case "epic": {
      if (!reader.canReadBacklog) return [];
      const rows = (await db.epic.findMany({
        where: { epicId: { in: keys } },
        select: { epicId: true, title: true, status: true, description: true },
      })) as Array<{ epicId: string; title: string; status: string; description: string | null }>;
      return rows.map((row) => ({
        key: row.epicId, kind, title: row.title, status: row.status, scope: "install" as const,
        href: entityHref(kind, row.epicId), family: null, body: row.description,
      }));
    }
    case "document": {
      if (reader.organizationId === null) return [];
      const rows = (await db.document.findMany({
        where: { AND: [{ documentId: { in: keys } }, { organizationId: reader.organizationId }, readableDocumentWhere(reader.documentViewer)] },
        select: { documentId: true, title: true, currentState: true, organizationId: true, currentVersion: { select: { contentText: true } } },
      })) as Array<{ documentId: string; title: string; currentState: string; currentVersion: { contentText: string | null } | null }>;
      return rows.map((row) => ({
        key: row.documentId, kind, title: row.title, status: row.currentState, scope: "organization" as const,
        href: entityHref(kind, row.documentId), family: null, body: row.currentVersion?.contentText ?? null,
      }));
    }
    case "wiki": {
      const wikiReader = wikiReaderForCorpusScope(reader.corpus, reader.organizationId);
      const rows = (await db.wikiPage.findMany({
        where: { id: { in: keys } },
        select: { id: true, slug: true, title: true, status: true, organizationId: true, body: true },
      })) as Array<{ id: string; slug: string; title: string; status: string; organizationId: string | null; body: string }>;
      return rows.filter((row) => canReadWikiPage(wikiReader, row)).map((row) => {
        const scope = wikiPageScope(row);
        return { key: row.id, kind, title: row.title, status: row.status, scope: scope.corpus, href: entityHref(kind, row.id, { slug: row.slug }), family: scope.family, body: row.body };
      });
    }
    case "workroom": {
      const rows = (await db.workroom.findMany({
        where: { capsuleId: { in: keys } },
        select: { id: true, capsuleId: true, title: true, status: true },
      })) as Array<{ id: string; capsuleId: string; title: string; status: string }>;
      const admitted = await Promise.all(rows.map((row) => deps.canReadRoom(row.id)));
      return rows.filter((_, i) => admitted[i]).map((row) => ({
        key: row.capsuleId, kind, title: row.title, status: row.status, scope: "install" as const,
        href: entityHref(kind, row.capsuleId), family: null, body: null,
      }));
    }
    case "message": {
      const rows = (await db.workItemMessage.findMany({
        where: { id: { in: keys } },
        select: { id: true, body: true, workItem: { select: { capsules: { select: { id: true, capsuleId: true, title: true }, take: 1, orderBy: { createdAt: "asc" } } } } },
      })) as Array<{ id: string; body: string; workItem: { capsules: Array<{ id: string; capsuleId: string; title: string }> } }>;
      const rooms = new Map<string, boolean>();
      for (const row of rows) {
        const room = row.workItem.capsules[0];
        if (room && !rooms.has(room.id)) rooms.set(room.id, await deps.canReadRoom(room.id));
      }
      return rows.flatMap((row) => {
        const room = row.workItem.capsules[0];
        if (!room || !rooms.get(room.id)) return [];
        return [{ key: row.id, kind, title: room.title, status: null, scope: "install" as const, href: entityHref(kind, row.id, { roomKey: room.capsuleId }), family: null, body: row.body }];
      });
    }
  }
}

/** The keys of `kind` this reader may open: one batch check per kind (§3.4 step 2). */
export async function canReadEntities(reader: ReferenceReader, kind: ReferenceEntityKind, keys: readonly string[], deps: ReferenceReadDeps): Promise<Set<string>> {
  return new Set((await loadKind(reader, kind, [...new Set(keys)], deps)).map((row) => row.key));
}

const SNIPPET_RADIUS = 70;

/** About one line of plain text around the first mention, read from the source row now. */
function snippetOf(body: string | null, mention: string): string | null {
  if (!body) return null;
  const index = body.indexOf(mention);
  const start = Math.max(0, index < 0 ? 0 : index - SNIPPET_RADIUS);
  const end = Math.min(body.length, (index < 0 ? 0 : index + mention.length) + SNIPPET_RADIUS);
  const text = body.slice(start, end).replace(/\[\[([^\]|\n]*)\|([^\]\n]*)\]\]/g, "$2").replace(/[`*_>#[\]]/g, "").replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${end < body.length ? "…" : ""}` || null;
}

/** R5 ranking, after the R1 filter: own family, then kernel and organization, then other families. */
function rank(reader: ReferenceReader, row: Loaded): number {
  if (row.scope !== "profession") return 1;
  return row.family !== null && row.family === reader.corpus.familyKey ? 0 : 2;
}

type EdgeRow = { src_key: string; dst_key: string; props: Record<string, unknown> };

const INBOUND_SQL = `
  SELECT src_key, dst_key, props FROM graph_edge
   WHERE dst_key = $1 AND rel_type = 'MENTIONS'
     AND (props->>'sourceOrganizationId' IS NULL OR props->>'sourceOrganizationId' = $2)
     AND ($3::boolean OR coalesce(props->>'sourceScope', '') <> 'kernel')
     AND ($4::text[] IS NULL OR coalesce(props->>'sourceScope', '') <> 'profession' OR props->>'sourceFamily' = ANY($4::text[]))
     AND ($5::boolean OR NOT (props->>'sourceKind' = 'wiki' AND props->>'sourceScope' = 'organization'))
     AND ($6::text IS NULL OR src_key > $6)
   ORDER BY src_key
   LIMIT $7`;

const OUTBOUND_SQL = `
  SELECT src_key, dst_key, props FROM graph_edge
   WHERE src_key = $1 AND rel_type = 'MENTIONS'
     AND (props->>'targetOrganizationId' IS NULL OR props->>'targetOrganizationId' = $2)
     AND ($3::boolean OR coalesce(props->>'targetScope', '') <> 'kernel')
     AND ($4::text[] IS NULL OR coalesce(props->>'targetScope', '') <> 'profession' OR props->>'targetFamily' = ANY($4::text[]))
     AND ($5::boolean OR NOT (props->>'targetKind' = 'wiki' AND props->>'targetScope' = 'organization'))
     AND ($6::text IS NULL OR dst_key > $6)
   ORDER BY dst_key
   LIMIT $7`;

const REFERENCE_KINDS: readonly ReferenceEntityKind[] = ["wiki", "backlog", "epic", "document", "workroom", "message"];

function kindOf(raw: unknown, key: string): ReferenceEntityKind | null {
  if (typeof raw === "string" && (REFERENCE_KINDS as readonly string[]).includes(raw)) return raw as ReferenceEntityKind;
  const fromId = entityKindOfId(key);
  return fromId && fromId !== "knowledge-article" ? fromId : null;
}

async function readPage(
  direction: "inbound" | "outbound",
  key: string,
  reader: ReferenceReader,
  request: ReferencePageRequest,
  deps: ReferenceReadDeps,
): Promise<ReferencePage> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, request.limit ?? DEFAULT_LIMIT));
  const far = direction === "inbound" ? "src_key" : "dst_key";
  const kindProp = direction === "inbound" ? "sourceKind" : "targetKind";
  const families = reader.corpus.professionFamilies === null ? null : [...reader.corpus.professionFamilies];
  const passed: Loaded[] = [];
  let cursor = request.after ?? null;
  let exhausted = false;
  while (passed.length < limit && !exhausted) {
    const params = [key, reader.organizationId, reader.corpus.kernel, families, reader.corpus.organization, cursor, limit * 2] as const;
    const batch = direction === "inbound"
      ? await deps.db.$queryRawUnsafe<EdgeRow[]>(INBOUND_SQL, ...params)
      : await deps.db.$queryRawUnsafe<EdgeRow[]>(OUTBOUND_SQL, ...params);
    exhausted = batch.length < limit * 2;
    if (batch.length === 0) break;
    const byKind = new Map<ReferenceEntityKind, string[]>();
    for (const edge of batch) {
      const kind = kindOf(edge.props?.[kindProp], edge[far]);
      if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), edge[far]]);
    }
    const loaded = new Map<string, Loaded>();
    for (const [kind, keys] of byKind) for (const row of await loadKind(reader, kind, keys, deps)) loaded.set(row.key, row);
    for (const edge of batch) {
      cursor = edge[far];
      const row = loaded.get(edge[far]);
      if (row) passed.push(row);
      if (passed.length === limit) break;
    }
  }
  const mention = request.mention ?? key;
  const rows = passed
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(reader, a.row) - rank(reader, b.row) || a.index - b.index)
    .map(({ row }) => ({
      key: row.key, kind: row.kind, title: row.title, status: row.status, scope: row.scope, href: row.href,
      snippet: request.snippets === false || direction === "outbound" ? null : snippetOf(row.body, mention),
    }));
  return { rows, count: rows.length, nextCursor: passed.length === limit && !exhausted ? cursor : null };
}

/** What references `targetKey`, limited to what the reader may open. Pass `mention` (e.g. `[[slug`) for a wiki target. */
export function listInbound(targetKey: string, reader: ReferenceReader, request: ReferencePageRequest, deps: ReferenceReadDeps): Promise<ReferencePage> {
  return readPage("inbound", targetKey, reader, request, deps);
}

/** What `sourceKey` references, limited to what the reader may open. */
export function listOutbound(sourceKey: string, reader: ReferenceReader, request: ReferencePageRequest, deps: ReferenceReadDeps): Promise<ReferencePage> {
  return readPage("outbound", sourceKey, reader, request, deps);
}

/** For the renderer: the hrefs of the ids in a body that the reader may open. Others stay plain text. */
export async function resolveReadableEntityHrefs(ids: readonly string[], reader: ReferenceReader, deps: ReferenceReadDeps): Promise<Record<string, string>> {
  const byKind = new Map<ReferenceEntityKind, string[]>();
  for (const id of new Set(ids)) {
    const kind = entityKindOfId(id);
    if (kind && kind !== "knowledge-article") byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
  }
  const hrefs: Record<string, string> = {};
  for (const [kind, keys] of byKind) for (const row of await loadKind(reader, kind, keys, deps)) hrefs[row.key] = row.href;
  return hrefs;
}
