// apps/web/lib/ea/reconcile-sysml-projections.ts
//
// Combined reconcile for all auto-extracted SysML projections (Parity Engine).
// Runs each domain reconcile (MCP tool authority, AI coworker workforce) so a
// single scheduled/on-demand pass keeps every live projection current. Each
// reconcile re-derives from its source registry, so the projections cannot drift.
//
// Thin orchestrator over the per-domain reconciles; db injected for tests.

import { prisma } from "@dpf/db";
import { reconcileMcpAuthorityModel, type McpAuthorityReconcileResult } from "./reconcile-mcp-authority";
import { reconcileCoworkerAuthority } from "./reconcile-coworker-authority";
import { reconcileValueStreams } from "./reconcile-value-streams";
import type { SysmlSeedResult } from "./sysml-model-seed";

export interface SysmlProjectionsResult {
  mcpAuthority: McpAuthorityReconcileResult;
  coworkerAuthority: SysmlSeedResult;
  valueStreams: SysmlSeedResult;
}

export async function reconcileSysmlProjections(
  opts: { db?: typeof prisma } = {},
): Promise<SysmlProjectionsResult> {
  const mcpAuthority = await reconcileMcpAuthorityModel({ db: opts.db });
  const coworkerAuthority = await reconcileCoworkerAuthority({ db: opts.db });
  const valueStreams = await reconcileValueStreams({ db: opts.db });
  return { mcpAuthority, coworkerAuthority, valueStreams };
}
