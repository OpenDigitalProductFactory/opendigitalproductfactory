// apps/web/lib/ea/reconcile-code-structure.ts
//
// Reconcile the committed source-code graph into a live SysML projection (Parity
// Engine, domain 5). Reads the Neo4j code graph (CodeFile + IMPORTS, graphKey
// "source-code") via runCypher, aggregates to subsystem dependencies, and applies via
// the shared idempotent seeder. Re-derives every run, so it cannot drift.
//
// The code graph is a Build-Studio impact-analysis feature; on installs where it has
// not been built the reconcile skips cleanly (mirrors value-streams skipping when the
// IT4IT reference model is absent). runCypher / freshness / db are injected for tests.

import { prisma, runCypher } from "@dpf/db";
import { getCodeGraphFreshness } from "@/lib/integrate/code-graph-access";
import { CODE_GRAPH_GRAPH_KEY } from "@/lib/integrate/code-graph/constants";
import { buildCodeStructureModel, type CodeImportEdge } from "./code-structure-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

const EDGE_QUERY = [
  "MATCH (f:CodeFile {graphKey: $graphKey})",
  "OPTIONAL MATCH (f)-[:IMPORTS]->(t:CodeFile {graphKey: $graphKey})",
  "RETURN f.path AS fromPath, t.path AS toPath",
].join("\n");

export interface CodeStructureReconcileOpts {
  db?: typeof prisma;
  runCypherFn?: typeof runCypher;
  getFreshness?: typeof getCodeGraphFreshness;
}

export async function reconcileCodeStructure(opts: CodeStructureReconcileOpts = {}): Promise<SysmlSeedResult> {
  const cypher = opts.runCypherFn ?? runCypher;
  const freshness = opts.getFreshness ?? getCodeGraphFreshness;

  const fresh = await freshness(CODE_GRAPH_GRAPH_KEY);
  if (!fresh.available) {
    console.warn(`[code-structure] code graph "${CODE_GRAPH_GRAPH_KEY}" not built — skipping`);
    return { status: "skipped", created: 0, updated: 0, removed: 0 };
  }

  const rows = await cypher<{ fromPath?: unknown; toPath?: unknown }>(EDGE_QUERY, { graphKey: CODE_GRAPH_GRAPH_KEY });
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
