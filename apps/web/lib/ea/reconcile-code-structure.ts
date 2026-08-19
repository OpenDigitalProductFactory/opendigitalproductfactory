// apps/web/lib/ea/reconcile-code-structure.ts
//
// Reconcile the committed source-code graph into a live SysML projection (Parity
// Engine, domain 5). Reads the code graph (CodeFile + IMPORTS, graphKey "source-code")
// from the Postgres graph mirror (graph_node/graph_edge), aggregates to subsystem
// dependencies, and applies via the shared idempotent seeder. Re-derives every run,
// so it cannot drift.
//
// The code graph is a Build-Studio impact-analysis feature; on installs where it has
// not been built the reconcile skips cleanly (mirrors value-streams skipping when the
// IT4IT reference model is absent). db / freshness are injected for tests.

import { prisma } from "@dpf/db";
import { getCodeGraphFreshness } from "@/lib/build/code-graph-access";
import { CODE_GRAPH_GRAPH_KEY } from "@/lib/build/code-graph/constants";
import { buildCodeStructureModel, type CodeImportEdge } from "./code-structure-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

// One row per CodeFile (toPath null when it imports nothing), plus one row per
// IMPORTS edge to another CodeFile — parity with the old Neo4j OPTIONAL MATCH.
const EDGE_QUERY = [
  "SELECT f.props->>'path' AS \"fromPath\", t.props->>'path' AS \"toPath\"",
  "  FROM graph_node f",
  "  LEFT JOIN graph_edge e ON e.src_key = f.key AND e.rel_type = 'IMPORTS'",
  "  LEFT JOIN graph_node t ON t.key = e.dst_key AND 'CodeFile' = ANY(t.labels) AND t.props->>'graphKey' = $1",
  " WHERE 'CodeFile' = ANY(f.labels) AND f.props->>'graphKey' = $1",
].join("\n");

export interface CodeStructureReconcileOpts {
  db?: typeof prisma;
  getFreshness?: typeof getCodeGraphFreshness;
}

export async function reconcileCodeStructure(opts: CodeStructureReconcileOpts = {}): Promise<SysmlSeedResult> {
  const db = opts.db ?? prisma;
  const freshness = opts.getFreshness ?? getCodeGraphFreshness;

  const fresh = await freshness(CODE_GRAPH_GRAPH_KEY);
  if (!fresh.available) {
    console.warn(`[code-structure] code graph "${CODE_GRAPH_GRAPH_KEY}" not built — skipping`);
    return { status: "skipped", created: 0, updated: 0, removed: 0 };
  }

  const rows = (await db.$queryRawUnsafe(EDGE_QUERY, CODE_GRAPH_GRAPH_KEY)) as Array<{
    fromPath?: unknown;
    toPath?: unknown;
  }>;
  const edges: CodeImportEdge[] = rows
    .map((r) => ({
      fromPath: typeof r.fromPath === "string" ? r.fromPath : "",
      toPath: typeof r.toPath === "string" ? r.toPath : null,
    }))
    .filter((e) => e.fromPath);

  const result = await applySysmlModel(buildCodeStructureModel(edges), { db: opts.db });
  console.info(`[code-structure] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed}`);
  return result;
}
