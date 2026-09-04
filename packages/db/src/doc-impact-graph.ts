// packages/db/src/doc-impact-graph.ts
//
// BI-6C112948 — project the doc-impact manifest into the Postgres graph mirror.
//
// THE GAP THIS CLOSES: scripts/gen-doc-impact.mjs already derives the doc↔code and
// doc↔route edges (155 code edges after PR #4004 widened them from the links docs
// already contain). Until now the ONLY consumer was the CI gate, which can answer
// exactly one question — "is this PR's diff missing a doc update?" — and answers it
// as a pass/fail that evaporates when the job ends. Nothing could ask the standing
// questions: what docs does this file affect, what code does this page describe,
// what is the blast radius of touching this module. Those need the edges in a store
// you can query. gen-doc-impact.mjs's own header calls this out as spec §5.5's
// deliberate later step, gated on the manifest being green first. It is green.
//
// THE HARD CONSTRAINT: **the CI gate must stay database-free.** `policy-guards-pr`
// in .github/workflows/ci.yml has no `services:` block (only the test-web and
// test-packages jobs do), so a DB-backed gate simply cannot run there. The
// generated JSON manifest therefore remains the source-controlled contract the gate
// reads. This projection is an ADDITIONAL, downstream consumer — never a
// prerequisite. Nothing in this file is imported by any gate.
//
// THIS MODULE IMPORTS NOTHING. That is enforcement, not preference: the moment it
// imports ./graph-sync it transitively pulls in ./client and the generated Prisma
// client, and a test of the planner would need a database to run. The writing half
// lives in doc-impact-graph-sync.ts precisely so this half cannot acquire one.
//
// ─── Key space: reuse the code graph's, do not mint a parallel one ──────────────
//
// The mirror ALREADY contains the files and routes this manifest talks about. The
// Code Intelligence Graph (EP-CODE-GRAPH) indexes them as:
//     CodeFile   → "source-code:apps/web/lib/docs-route-map.ts"
//     CodeRoute  → "source-code:route:/platform/audit"
// (see buildCodeFileKey in apps/web/lib/integrate/code-graph/neo4j-projection.ts —
// `${graphKey}:${path}`, graphKey "source-code"). Verified live: 4,215 CodeFile and
// 459 CodeRoute nodes.
//
// So this projection attaches its edges to THOSE keys rather than minting
// "apps/web/lib/docs-route-map.ts" as a second node for the same real file. Keying
// by the natural path — the first shape this took — would have split every file
// across two identities: IMPORTS / TESTED_BY / IMPLEMENTS_ROUTE hanging off one,
// IMPACTS off the other, and no traversal able to cross between them. Sharing the
// key is what makes "change this file → which tests, which importers, AND which
// docs" a single walk.
//
// Endpoint nodes are upserted with the additive label DOC_IMPACT_SOURCE_LABEL
// rather than CodeFile. graph-sync's upsertGraphNode UNION-merges labels, so a file
// the code graph already indexes ends up as one node labelled both. A file it does
// NOT index (`.sh`, `.yml`, `.prisma` are in the manifest but outside the code
// graph's extractors) gets a node honestly labelled only DocImpactSource, instead of
// a counterfeit CodeFile with no checksum that would pollute the code-structure
// queries filtering on props->>'graphKey'.
//
// KNOWN INTERACTION: the code graph's own upsert REPLACES the label array
// (`SET labels = excluded.labels`), so a later code-graph reconcile drops the
// DocImpactSource label from nodes it also owns. The IMPACTS EDGES survive — edges
// are keyed by (src_key, dst_key, rel_type) and never consulted the label — so this
// costs a cosmetic label until the next rebuild, not the projection.
//
// Doc pages get their own namespace, "doc-impact:<repo path>", because they are not
// code-graph artifacts and must not be deleted or rewritten by a code-graph
// reconcile. DocPage is the one label this projection OWNS, which is what lets the
// rebuild runner clear it safely.
//
// EDGE DIRECTION: src → dst runs the way blast radius runs — from the thing that
// CHANGED to the doc that must be reviewed. "What does changing this file affect?"
// is a forward walk; "what does this page document?" is the reverse walk.
//
// NOT in IMPACT_RELATIONSHIP_TYPES (pg-graph.ts) on purpose: that list drives
// infrastructure impact analysis, and adding IMPACTS to it would start surfacing
// markdown pages in the middle of CI dependency traversals.

/** The on-disk shape of apps/web/lib/docs/doc-impact.generated.json. */
export interface DocImpactManifest {
  generatedBy?: string;
  /** route prefix → doc paths it impacts */
  routeToDocs?: Record<string, string[]>;
  /** source file path → doc paths it impacts */
  codeToDocs?: Record<string, string[]>;
  /** doc path → route prefixes (inverse of routeToDocs) */
  docToRoutes?: Record<string, string[]>;
  /** doc path → source file paths (inverse of codeToDocs) */
  docToCode?: Record<string, string[]>;
}

/** Namespace the Code Intelligence Graph mints its node keys under. */
export const CODE_GRAPH_KEY = "source-code";
/** Namespace for published doc pages — owned by this projection alone. */
export const DOC_GRAPH_KEY = "doc-impact";

/** Label this projection owns; safe for the rebuild runner to clear. */
export const DOC_PAGE_LABEL = "DocPage";
/** Additive label on shared code-graph nodes. Never cleared by this projection. */
export const DOC_IMPACT_SOURCE_LABEL = "DocImpactSource";
/** Relationship type for "changing src should flag dst for doc review". */
export const DOC_IMPACT_REL = "IMPACTS";

/** Canonical mirror key for a repo source file (parity with buildCodeFileKey). */
export function sourceFileKey(filePath: string): string {
  return `${CODE_GRAPH_KEY}:${filePath}`;
}

/** Canonical mirror key for an application route. */
export function routeKey(route: string): string {
  return `${CODE_GRAPH_KEY}:route:${route}`;
}

/** Mirror key for a published doc page. */
export function docPageKey(docPath: string): string {
  return `${DOC_GRAPH_KEY}:${docPath}`;
}

export interface PlannedNode {
  key: string;
  label: typeof DOC_PAGE_LABEL | typeof DOC_IMPACT_SOURCE_LABEL;
  props: Record<string, unknown>;
}

export interface PlannedEdge {
  srcKey: string;
  dstKey: string;
  /** "code" when the edge came from codeToDocs, "route" from routeToDocs. */
  origin: "code" | "route";
}

export interface DocImpactPlan {
  nodes: PlannedNode[];
  edges: PlannedEdge[];
}

/**
 * How many DocPage nodes this manifest SHOULD produce — the source-of-truth count
 * for the doc-impact reconciliation invariant (BI-A73954F7).
 *
 * Derived from `planDocImpactProjection` rather than counted off the manifest's
 * `docToRoutes`/`docToCode` maps on purpose: the projection reads only the FORWARD
 * maps, so a hand-rolled count off the inverse maps could disagree with what the
 * projection actually writes and would report phantom drift. The invariant and the
 * projection must share one derivation or the check becomes its own bug source.
 */
export function countDocPagesInManifest(manifest: DocImpactManifest): number {
  return planDocImpactProjection(manifest).nodes.filter((n) => n.label === DOC_PAGE_LABEL).length;
}

/** Last path segment without a `.md` extension — a readable name in graph views. */
function displayName(docPath: string): string {
  const base = docPath.slice(docPath.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

/**
 * Turn a manifest into the exact set of nodes and edges to upsert.
 *
 * PURE — no database, no filesystem, no clock. That is what lets this be tested in
 * the DB-free unit lane, and it keeps the projection's correctness reviewable
 * independently of whether Postgres is reachable.
 *
 * Only the forward maps (`routeToDocs`, `codeToDocs`) are read. `docToRoutes` and
 * `docToCode` are their inverses, already guaranteed consistent by the generator;
 * walking them too would double every edge and give the same fact two owners.
 *
 * Output is sorted so a re-projection over an unchanged manifest issues an
 * identical, diffable sequence of writes.
 */
export function planDocImpactProjection(manifest: DocImpactManifest): DocImpactPlan {
  const nodes = new Map<string, PlannedNode>();
  const edges = new Map<string, PlannedEdge>();

  const addNode = (key: string, label: PlannedNode["label"], props: Record<string, unknown>) => {
    if (!nodes.has(key)) nodes.set(key, { key, label, props });
  };

  const addSide = (
    map: Record<string, string[]> | undefined,
    origin: PlannedEdge["origin"],
    toKey: (raw: string) => string,
  ) => {
    for (const [raw, docPaths] of Object.entries(map ?? {})) {
      if (!raw) continue;
      const srcKey = toKey(raw);
      addNode(srcKey, DOC_IMPACT_SOURCE_LABEL, {
        kind: origin === "code" ? "file" : "route",
        // `path` matches the prop name the code graph already uses for CodeFile,
        // so a shared node keeps one consistent property rather than two spellings.
        path: raw,
        name: origin === "code" ? displayName(raw) : raw,
        graphKey: CODE_GRAPH_KEY,
      });
      for (const docPath of docPaths ?? []) {
        if (!docPath) continue;
        const dstKey = docPageKey(docPath);
        addNode(dstKey, DOC_PAGE_LABEL, {
          path: docPath,
          name: displayName(docPath),
          graphKey: DOC_GRAPH_KEY,
        });
        // The same (src,dst) can arrive from a declared `relatedCode:` edge AND a
        // derived link edge; the mirror keys edges by (src,dst,rel_type), so
        // collapse here rather than issuing a redundant second upsert.
        edges.set(`${srcKey} ${dstKey}`, { srcKey, dstKey, origin });
      }
    }
  };

  addSide(manifest.codeToDocs, "code", sourceFileKey);
  addSide(manifest.routeToDocs, "route", routeKey);

  return {
    nodes: [...nodes.values()].sort((a, b) => a.key.localeCompare(b.key)),
    edges: [...edges.values()].sort(
      (a, b) => a.srcKey.localeCompare(b.srcKey) || a.dstKey.localeCompare(b.dstKey),
    ),
  };
}
