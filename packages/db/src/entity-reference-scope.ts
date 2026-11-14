// packages/db/src/entity-reference-scope.ts
//
// The pure half of the reference writer (BI-A63A9476). Spec:
// docs/superpowers/specs/2026-10-14-knowledge-linking-design.md §2 R3–R4, §3.2–3.3, §5.
//
// A body is the system of record; its `MENTIONS` edges in graph_edge are a
// derived projection. This module decides which mentions become edges and what
// each edge records. It reads nothing: entity-reference-sync.ts resolves the
// mentions and writes the plan.
//
// The stored relation type is `MENTIONS` (BI-85389A35 retired `REFERENCES`
// before any row existed and registered `MENTIONS` for this edge); the UI keeps
// the words "Referenced by".

import type { GraphEdgeTarget } from "./graph-sync";

/** The corpus half of a scope. A scope is the pair (corpus, organization). */
export type ReferenceCorpus = "kernel" | "profession" | "organization" | "install";

export type ReferenceScope = {
  corpus: ReferenceCorpus;
  /** Set for organization pages and records; null for kernel, profession and install-scoped rows. */
  organizationId: string | null;
  /** The profession family of a profession page (`professions/<family>/…`). */
  family: string | null;
};

export type ReferenceEntityKind = "wiki" | "backlog" | "epic" | "document" | "workroom" | "message";

/** graph_node labels for the gated kinds; wiki pages keep their `Wiki__*` label. */
export const REFERENCE_NODE_LABEL: Record<Exclude<ReferenceEntityKind, "wiki">, string> = {
  backlog: "BacklogItem",
  epic: "Epic",
  document: "Document",
  workroom: "Workroom",
  message: "WorkroomMessage",
};

/** Labels whose nodes and edges hold no content and are read only through the shared reader. */
export const GATED_REFERENCE_LABELS: readonly string[] = Object.values(REFERENCE_NODE_LABEL);

export const REFERENCE_REL_TYPE = "MENTIONS" as const;
export const REFERENCE_PROJECTION = "references" as const;
/** writtenBy for an edge first written by the rebuild, whose author the source row does not record. */
export const REBUILD_WRITER = "projection:references-rebuild";

export type ReferenceSourceField = "body" | "description" | "message";

export type ReferenceSource = {
  kind: ReferenceEntityKind;
  key: string;
  scope: ReferenceScope;
  field: ReferenceSourceField;
  /** The principal whose write produced the edges (R3), e.g. `user:<id>` or `agent:<id>`. */
  writtenBy: string;
  /** For a Workroom message: the room row id that gates it. */
  roomId?: string | null;
};

export type ReferenceTarget = { kind: ReferenceEntityKind; key: string; scope: ReferenceScope };

/** The family a profession slug belongs to. */
export function professionFamilyOfReferenceSlug(slug: string): string | null {
  return /^professions\/([^/]+)\//.exec(slug)?.[1] ?? null;
}

/** A wiki page's scope: organization pages, then profession pages by slug, then the kernel. */
export function wikiPageScope(page: { slug: string; organizationId: string | null }): ReferenceScope {
  if (page.organizationId !== null) return { corpus: "organization", organizationId: page.organizationId, family: null };
  const family = professionFamilyOfReferenceSlug(page.slug);
  return family === null ? { corpus: "kernel", organizationId: null, family: null } : { corpus: "profession", organizationId: null, family };
}

/** A work record's scope: its organization, or install-scoped platform work when it has none. */
export function recordScope(organizationId: string | null | undefined): ReferenceScope {
  return organizationId ? { corpus: "organization", organizationId, family: null } : { corpus: "install", organizationId: null, family: null };
}

const WWWD: ReadonlySet<ReferenceCorpus> = new Set(["organization", "install"]);

/**
 * R4: edges cross scopes in one direction only. WWWD records may reference
 * WWMD and WSID pages. A kernel or profession page never references a WWWD
 * record, and one organization's record never references another's.
 * Install-scoped platform work may reference the install's records.
 */
export function referenceDirectionAllowed(source: ReferenceScope, target: ReferenceScope): boolean {
  if (!WWWD.has(target.corpus)) return true;
  if (!WWWD.has(source.corpus)) return false;
  if (source.organizationId !== null && target.organizationId !== null) return source.organizationId === target.organizationId;
  return true;
}

export type ReferencePlan = { edges: GraphEdgeTarget[]; refused: ReferenceTarget[] };

/**
 * The `MENTIONS` edges a source should have. Targets are deduped in order and
 * a self-mention is dropped. Each edge records both scopes, the field and its
 * writer, and never a title or snippet (§3.2). An edge that already existed
 * keeps the writer that first wrote it, so a later save does not overwrite the
 * provenance of a mention someone else planted (R3).
 */
export function planReferenceEdges(
  source: ReferenceSource,
  targets: readonly ReferenceTarget[],
  options: { now: Date; existingWriters?: ReadonlyMap<string, string> },
): ReferencePlan {
  const edges: GraphEdgeTarget[] = [];
  const refused: ReferenceTarget[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    if (target.key === source.key || seen.has(target.key)) continue;
    seen.add(target.key);
    if (!referenceDirectionAllowed(source.scope, target.scope)) {
      refused.push(target);
      continue;
    }
    edges.push({
      dstKey: target.key,
      props: {
        projection: REFERENCE_PROJECTION,
        sourceKind: source.kind,
        sourceField: source.field,
        sourceScope: source.scope.corpus,
        sourceOrganizationId: source.scope.organizationId,
        sourceFamily: source.scope.family,
        targetKind: target.kind,
        targetScope: target.scope.corpus,
        targetOrganizationId: target.scope.organizationId,
        targetFamily: target.scope.family,
        roomId: source.roomId ?? null,
        writtenBy: options.existingWriters?.get(target.key) ?? source.writtenBy,
        syncedAt: options.now.toISOString(),
      },
    });
  }
  return { edges, refused };
}
