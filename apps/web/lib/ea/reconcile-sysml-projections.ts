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
// code-structure reconcile additionally reads the Postgres code-graph mirror, so its
// graph deps (freshness) are injectable separately via `codeGraph`.

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
import { reconcileSecurityPosture } from "./reconcile-security-posture";
import { reconcileWorkPatternArchitecture } from "./reconcile-work-pattern-architecture";
import { reconcileFederatedDemandArchitecture } from "./reconcile-federated-demand-architecture";
import {
  reconcileAiRoutingArchitecture,
  type AiRoutingArchitectureReconcileResult,
} from "./reconcile-ai-routing-architecture";
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
  // Security Operations (SOC) surface — normalization / detection / cases /
  // response / roster, tracing to the security data model (EP-SOVEREIGN-SOC).
  securityPosture: SysmlSeedResult;
  // Governed Adaptive Playbooks — observed work patterns, proposal guardrails,
  // promotion ladder, and no-self-activation verification cases.
  workPatternArchitecture: SysmlSeedResult;
  federatedDemandArchitecture: SysmlSeedResult;
  // Governed AI-routing behavior + requirements + realizing structure.
  aiRoutingArchitecture: AiRoutingArchitectureReconcileResult;
}

const SKIPPED: SysmlSeedResult = { status: "skipped", created: 0, updated: 0, removed: 0 };

// Run one domain reconcile in isolation. A thrown error in a single domain (e.g. a missing
// EaRelationshipType in one extractor) must NOT abort the orchestrator or block later
// domains — previously a fail-fast sequence meant one bad domain blinded every projection,
// including IT4IT coverage (last in the list). On failure we log and fall back to a skipped
// result; the architecture-parity steward then surfaces that domain as a conformance finding.
async function runDomain<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[sysml-projections] domain "${name}" failed; isolating so other domains still run:`, err);
    return fallback;
  }
}

export async function reconcileSysmlProjections(
  opts: { db?: typeof prisma; codeGraph?: Omit<CodeStructureReconcileOpts, "db"> } = {},
): Promise<SysmlProjectionsResult> {
  const mcpAuthority = await runDomain(
    "mcpAuthority",
    () => reconcileMcpAuthorityModel({ db: opts.db }),
    { ...SKIPPED, toolCount: 0, grantCount: 0 },
  );
  const coworkerAuthority = await runDomain("coworkerAuthority", () => reconcileCoworkerAuthority({ db: opts.db }), SKIPPED);
  const valueStreams = await runDomain("valueStreams", () => reconcileValueStreams({ db: opts.db }), SKIPPED);
  const routes = await runDomain("routes", () => reconcileRoutes({ db: opts.db }), SKIPPED);
  const navigation = await runDomain("navigation", () => reconcileNavigation({ db: opts.db }), SKIPPED);
  const codeStructure = await runDomain("codeStructure", () => reconcileCodeStructure({ db: opts.db, ...opts.codeGraph }), SKIPPED);
  const processModels = await runDomain("processModels", () => reconcileProcessModels({ db: opts.db }), SKIPPED);
  const skillToolchain = await runDomain("skillToolchain", () => reconcileSkillToolchain({ db: opts.db }), SKIPPED);
  const operationalGraph = await runDomain("operationalGraph", () => reconcileOperationalGraph({ db: opts.db }), SKIPPED);
  const networkTopology = await runDomain("networkTopology", () => reconcileNetworkTopology({ db: opts.db }), SKIPPED);
  const integrations = await runDomain("integrations", () => reconcileIntegrations({ db: opts.db }), SKIPPED);
  const scheduledJobs = await runDomain("scheduledJobs", () => reconcileScheduledJobs({ db: opts.db }), SKIPPED);
  const it4itCoverage = await runDomain("it4itCoverage", () => reconcileIt4itCoverage({ db: opts.db }), SKIPPED);
  // SOC posture isolated like every other domain (EP-SOVEREIGN-SOC, composed with
  // the PR-2385 fail-isolation): a security-extractor error can't blind the engine.
  const securityPosture = await runDomain("securityPosture", () => reconcileSecurityPosture({ db: opts.db }), SKIPPED);
  const workPatternArchitecture = await runDomain(
    "workPatternArchitecture",
    () => reconcileWorkPatternArchitecture({ db: opts.db }),
    SKIPPED,
  );
  const federatedDemandArchitecture = await runDomain(
    "federatedDemandArchitecture",
    () => reconcileFederatedDemandArchitecture({ db: opts.db }),
    SKIPPED,
  );
  const aiRoutingArchitecture = await runDomain(
    "aiRoutingArchitecture",
    () => reconcileAiRoutingArchitecture({ db: opts.db }),
    {
      ...SKIPPED,
      bpmn: SKIPPED,
      archimate: SKIPPED,
      sysml: SKIPPED,
    },
  );
  return {
    mcpAuthority, coworkerAuthority, valueStreams, routes, navigation, codeStructure, processModels, skillToolchain,
    operationalGraph, networkTopology, integrations, scheduledJobs, it4itCoverage, securityPosture, workPatternArchitecture,
    federatedDemandArchitecture, aiRoutingArchitecture,
  };
}
