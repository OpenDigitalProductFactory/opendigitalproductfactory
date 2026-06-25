// apps/web/lib/ea/reconcile-sysml-projections.ts
//
// Combined reconcile for all auto-extracted SysML/EA projections (Parity Engine).
// Runs each domain reconcile (MCP tool authority, AI coworker workforce, IT4IT value
// streams, Next.js route tree, source-code structure, platform process models) so a
// single scheduled/on-demand pass keeps every live projection current. Each reconcile
// re-derives from its source registry/manifest/graph/transition-table, so the
// projections cannot drift.
//
// Thin orchestrator over the per-domain reconciles; db injected for tests. The
// code-structure reconcile additionally reads the Neo4j code graph, so its graph deps
// (runCypher / freshness) are injectable separately via `codeGraph`.

import { prisma } from "@dpf/db";
import { reconcileMcpAuthorityModel, type McpAuthorityReconcileResult } from "./reconcile-mcp-authority";
import { reconcileCoworkerAuthority } from "./reconcile-coworker-authority";
import { reconcileValueStreams } from "./reconcile-value-streams";
import { reconcileRoutes } from "./reconcile-routes";
import { reconcileNavigation } from "./reconcile-navigation";
import { reconcileCodeStructure, type CodeStructureReconcileOpts } from "./reconcile-code-structure";
import { reconcileProcessModels } from "./reconcile-process";
import { reconcileSkillToolchain } from "./reconcile-skill-toolchain";
import { reconcileOperationalGraph } from "./reconcile-operational-bridge";
import { reconcileNetworkTopology } from "./reconcile-network-bridge";
import { reconcileIntegrations } from "./reconcile-integration-bridge";
import { reconcileScheduledJobs } from "./reconcile-scheduled-jobs";
import { reconcileIt4itCoverage } from "./reconcile-it4it-coverage";
import type { SysmlSeedResult } from "./sysml-model-seed";

export interface SysmlProjectionsResult {
  mcpAuthority: McpAuthorityReconcileResult;
  coworkerAuthority: SysmlSeedResult;
  valueStreams: SysmlSeedResult;
  routes: SysmlSeedResult;
  // Navigation surface — canonical nav model + navigates-to edges into the route
  // surface, with orphan/teleport conformance findings (EP-NAV-COHERENCE).
  navigation: SysmlSeedResult;
  codeStructure: SysmlSeedResult;
  processModels: SysmlSeedResult;
  skillToolchain: SysmlSeedResult;
  // Living-graph operational-reality bridges (EP-ARCH-GRAPH-LIVE).
  operationalGraph: SysmlSeedResult;
  networkTopology: SysmlSeedResult;
  integrations: SysmlSeedResult;
  // Scheduling surface — all scheduled work, across substrates (EP-SCHEDULING-SURFACE).
  scheduledJobs: SysmlSeedResult;
  // IT4IT conformance coverage — evidence-derived baseline vs the IT4IT functional
  // criteria, persisted to EaReferenceAssessment (EP-IT4IT-CONFORMANCE).
  it4itCoverage: SysmlSeedResult;
}

export async function reconcileSysmlProjections(
  opts: { db?: typeof prisma; codeGraph?: Omit<CodeStructureReconcileOpts, "db"> } = {},
): Promise<SysmlProjectionsResult> {
  const mcpAuthority = await reconcileMcpAuthorityModel({ db: opts.db });
  const coworkerAuthority = await reconcileCoworkerAuthority({ db: opts.db });
  const valueStreams = await reconcileValueStreams({ db: opts.db });
  const routes = await reconcileRoutes({ db: opts.db });
  const navigation = await reconcileNavigation({ db: opts.db });
  const codeStructure = await reconcileCodeStructure({ db: opts.db, ...opts.codeGraph });
  const processModels = await reconcileProcessModels({ db: opts.db });
  const skillToolchain = await reconcileSkillToolchain({ db: opts.db });
  const operationalGraph = await reconcileOperationalGraph({ db: opts.db });
  const networkTopology = await reconcileNetworkTopology({ db: opts.db });
  const integrations = await reconcileIntegrations({ db: opts.db });
  const scheduledJobs = await reconcileScheduledJobs({ db: opts.db });
  const it4itCoverage = await reconcileIt4itCoverage({ db: opts.db });
  return {
    mcpAuthority, coworkerAuthority, valueStreams, routes, navigation, codeStructure, processModels, skillToolchain,
    operationalGraph, networkTopology, integrations, scheduledJobs, it4itCoverage,
  };
}
