// packages/db/src/doc-impact-graph-sync.ts
//
// BI-6C112948 — the WRITING half of the doc-impact projection.
//
// Split from doc-impact-graph.ts on purpose. That module plans the projection and
// imports nothing; this one imports graph-sync (and therefore the Prisma client).
// Keeping the planner import-free is what lets its tests run in the database-free
// unit lane — which matters because the doc-impact GATE must stay database-free
// (policy-guards-pr in ci.yml has no `services:` block). One file could have held
// both halves, and the comment claiming purity would have been false the moment
// anyone read the import list.

import { upsertGraphEdge, upsertGraphNode } from "./graph-sync";
import { DOC_IMPACT_REL, planDocImpactProjection, type DocImpactManifest } from "./doc-impact-graph";

/**
 * Apply a manifest to the Postgres graph mirror.
 *
 * Upsert-only, exactly like every other sync in graph-sync.ts. Edges that have
 * DISAPPEARED from the manifest are NOT removed here — full-rebuild semantics are
 * the rebuild runner's job (rebuild-doc-impact-graph.ts clears the owned labels
 * first), which keeps the incremental path cheap and the destructive path explicit.
 *
 * @param syncedAt injectable so a caller can stamp a whole batch identically
 * @returns counts written, for the runner to report
 */
export async function projectDocImpactManifest(
  manifest: DocImpactManifest,
  syncedAt: string = new Date().toISOString(),
): Promise<{ nodes: number; edges: number }> {
  const plan = planDocImpactProjection(manifest);

  for (const node of plan.nodes) {
    await upsertGraphNode(node.key, [node.label], { ...node.props, syncedAt });
  }
  for (const edge of plan.edges) {
    await upsertGraphEdge(edge.srcKey, edge.dstKey, DOC_IMPACT_REL, {
      origin: edge.origin,
      syncedAt,
    });
  }

  return { nodes: plan.nodes.length, edges: plan.edges.length };
}
