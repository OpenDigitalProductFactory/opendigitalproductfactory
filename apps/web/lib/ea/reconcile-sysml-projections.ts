// apps/web/lib/ea/reconcile-sysml-projections.ts
//
// Combined reconcile for all auto-extracted SysML projections (Parity Engine).
// Runs each domain reconcile (MCP tool authority, AI coworker workforce, IT4IT value
// streams, Next.js route tree, source-code structure) so a single scheduled/on-demand
// pass keeps every live projection current. Each reconcile re-derives from its source
// registry/manifest/graph, so the projections cannot drift.
//
// Thin orchestrator over the per-domain reconciles; db injected for tests. The
// code-structure reconcile additionally reads the Neo4j code graph, so its graph deps
// (runCypher / freshness) are injectable separately via `codeGraph`.

import { prisma } from "@dpf/db";
import { reconcileMcpAuthorityModel, type McpAuthorityReconcileResult } from "./reconcile-mcp-authority";
import { reconcileCoworkerAuthority } from "./reconcile-coworker-authority";
import { reconcileValueStreams } from "./reconcile-value-streams";
import { reconcileRoutes } from "./reconcile-routes";
import { reconcileCodeStructure, type CodeStructureReconcileOpts } from "./reconcile-code-structure";
import type { SysmlSeedResult } from "./sysml-model-seed";

export interface SysmlProjectionsResult {
  mcpAuthority: McpAuthorityReconcileResult;
  coworkerAuthority: SysmlSeedResult;
  valueStreams: SysmlSeedResult;
  routes: SysmlSeedResult;
  codeStructure: SysmlSeedResult;
}

export async function reconcileSysmlProjections(
  opts: { db?: typeof prisma; codeGraph?: Omit<CodeStructureReconcileOpts, "db"> } = {},
): Promise<SysmlProjectionsResult> {
  const mcpAuthority = await reconcileMcpAuthorityModel({ db: opts.db });
  const coworkerAuthority = await reconcileCoworkerAuthority({ db: opts.db });
  const valueStreams = await reconcileValueStreams({ db: opts.db });
  const routes = await reconcileRoutes({ db: opts.db });
  const codeStructure = await reconcileCodeStructure({ db: opts.db, ...opts.codeGraph });
  return { mcpAuthority, coworkerAuthority, valueStreams, routes, codeStructure };
}
