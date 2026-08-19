// Consolidation bets — the closed registry of EP-8DC217EB "Vertical
// Integration Inward" structural bets, projected onto live architecture
// surfaces by the optimization cockpit (BI-D9B58004).
//
// Pure data module in the build-process-matrix idiom: no imports from app
// code, consumed by the cockpit loader (load-cockpit-data.ts) and the
// capability-map "Optimization Impact" overlay (view-model.ts).
//
// Every selector is a REAL artifact: `models` are Prisma model names (fed to
// traceCodeSurface({model})), `tools` are MCP tool names
// (traceCodeSurface({tool})), `files` are repo-relative paths
// (summarizeCodeGraphCoverage) — the contract test asserts each path exists
// and each model is declared in schema.prisma, so the registry cannot drift
// into fabrication. Grounding: the bet evidence tables in
// docs/superpowers/plans/2026-07-07-vertical-integration-inward-plan.md §4.
//
// Adding or changing a bet requires: (1) the bet exists in the plan (or the
// plan is amended first), (2) backlogItemIds point at live BI-… ids under
// EP-8DC217EB, (3) selectors verified against the tree — the contract test
// (consolidation-bets.test.ts) enforces (3) mechanically.

export const CONSOLIDATION_MOVE_TYPES = [
  "T1", // internalize (vendor)
  "T2", // dedup
  "T3", // hybridize
  "T4", // extract primitive
  "T5", // collapse surface
  "T6", // retire
  "T7", // portfolio-generalize
] as const;

export type ConsolidationMoveType = (typeof CONSOLIDATION_MOVE_TYPES)[number];

export const CONSOLIDATION_WAVES = ["0", "1", "2", "3", "continuous", "enablement"] as const;
export type ConsolidationWave = (typeof CONSOLIDATION_WAVES)[number];

export type ConsolidationEffort = "S" | "M" | "L" | "XL";
export type ConsolidationLeverage = "H" | "M" | "L";

export type ConsolidationBet = {
  /** Stable bet key from the plan (BET-0 … BET-14). */
  betKey: string;
  title: string;
  /** Live BacklogItem.itemId values under EP-8DC217EB delivering this bet. */
  backlogItemIds: string[];
  moveTypes: ConsolidationMoveType[];
  wave: ConsolidationWave;
  effort: ConsolidationEffort;
  leverage: ConsolidationLeverage;
  /** Grounded Σleaf estimate of change sites, from the plan §4. */
  leafEstimate: number;
  selectors: {
    /** Prisma model names — traceCodeSurface({ model }). */
    models: string[];
    /** MCP tool names — traceCodeSurface({ tool }). */
    tools: string[];
    /** Repo-relative file paths — summarizeCodeGraphCoverage. */
    files: string[];
  };
};

export const CONSOLIDATION_BETS: readonly ConsolidationBet[] = [
  {
    betKey: "BET-0",
    title: "Self-optimization engine — cockpit, WSID profiles, parity targets, dispatch, sweep, feedback",
    backlogItemIds: [
      "BI-D9B58004",
      "BI-ED9AC5A6",
      "BI-9900B365",
      "BI-C350F8B0",
      "BI-F95222FA",
      "BI-5C01F920",
    ],
    moveTypes: ["T4"],
    wave: "enablement",
    effort: "L",
    leverage: "H",
    leafEstimate: 6,
    selectors: {
      models: [],
      tools: ["trace_code_surface", "get_code_graph_freshness"],
      files: [
        "apps/web/lib/optimization/consolidation-bets.ts",
        "apps/web/lib/ea/architecture-parity-steward.ts",
        "apps/web/lib/decision-perspective/resolve-profession-profile.ts",
      ],
    },
  },
  {
    betKey: "BET-1",
    title: "Work-Unit spine — one spine + typed roles + shared claim + one ActivityEvent",
    backlogItemIds: ["BI-B6DD63A4"],
    moveTypes: ["T3", "T7"],
    wave: "3",
    effort: "XL",
    leverage: "H",
    leafEstimate: 40,
    selectors: {
      models: [
        "BacklogItem",
        "Epic",
        "Workroom",
        "FeatureBuild",
        "TaskRun",
        "WorkItem",
        "WorkEngagement",
      ],
      tools: [],
      files: [
        "apps/web/lib/work-management/portal-case-loader.ts",
        "apps/web/lib/work-management/workspace-case-loader.ts",
        "apps/web/lib/integrate/build-orchestrator.ts",
        "apps/web/lib/integrate/build-pipeline.ts",
        "apps/web/lib/queue/functions/build-execute.ts",
      ],
    },
  },
  {
    betKey: "BET-2",
    title: "Authorization/decision spine — one EffectivePermission resolver, fused gates",
    backlogItemIds: ["BI-F4156099"],
    moveTypes: ["T3"],
    wave: "1",
    effort: "L",
    leverage: "H",
    leafEstimate: 25,
    selectors: {
      models: ["DecisionInteraction"],
      tools: ["principle_decide"],
      files: [
        "apps/web/lib/governance/governance-resolver.ts",
        "apps/web/lib/authority/effective-authority.ts",
        "apps/web/lib/decision-perspective/evaluator.ts",
        "apps/web/lib/actions/shared/guards.ts",
        "apps/web/lib/api/auth-middleware.ts",
        "apps/web/lib/tak/agent-grants.ts",
      ],
    },
  },
  {
    betKey: "BET-3",
    title: "Integration/adapter substrate — @dpf/integration-shared absorbs the clones",
    backlogItemIds: ["BI-ABC88965"],
    moveTypes: ["T2", "T4"],
    wave: "2",
    effort: "M",
    leverage: "H",
    leafEstimate: 60,
    selectors: {
      models: [],
      tools: [],
      files: [
        "apps/web/lib/integrations/quickbooks/token-client.ts",
        "apps/web/lib/integrations/adp/token-client.ts",
        "apps/web/lib/integrations/microsoft365-communications/token-client.ts",
        "apps/web/lib/integrations/google-marketing-intelligence/token-client.ts",
        "packages/integration-shared/src/credential-crypto.ts",
        "apps/web/lib/govern/credential-crypto.ts",
        "apps/web/lib/routing/adapter-registry.ts",
      ],
    },
  },
  {
    betKey: "BET-4",
    title: "MCP tool surface + one-validation-source — drain the switch into packs",
    backlogItemIds: ["BI-2B7EE073"],
    moveTypes: ["T5", "T1"],
    wave: "2",
    effort: "L",
    leverage: "H",
    leafEstimate: 40,
    selectors: {
      models: [],
      tools: [],
      files: ["apps/web/lib/mcp-tools.ts", "apps/web/lib/mcp/tool-registry.ts"],
    },
  },
  {
    betKey: "BET-5",
    title: "Datastore hybridization — Neo4j + Qdrant onto Postgres",
    backlogItemIds: ["BI-A1E864A5"],
    moveTypes: ["T3"],
    wave: "3",
    effort: "XL",
    leverage: "H",
    leafEstimate: 15,
    selectors: {
      models: [],
      tools: [],
      files: [
        "packages/db/src/pg-graph.ts",
        "packages/db/src/qdrant.ts",
        "apps/web/lib/wiki/ppr.ts",
        "apps/web/lib/inference/embedding.ts",
        "scripts/backup-neo4j.sh",
        "scripts/backup-qdrant.sh",
      ],
    },
  },
  {
    betKey: "BET-6",
    title: "Cross-cutting micro-primitives — getErrorMessage, coercion, staleness, envelopes",
    backlogItemIds: ["BI-6A505BFF"],
    moveTypes: ["T4"],
    wave: "0",
    effort: "S",
    leverage: "H",
    leafEstimate: 1000,
    selectors: {
      models: [],
      tools: [],
      files: [
        "apps/web/lib/shared/get-error-message.ts",
        "apps/web/lib/shared/coerce.ts",
        "apps/web/lib/shared/index.ts",
      ],
    },
  },
  {
    betKey: "BET-7",
    title: "UI primitive plane — report-kit adoption + feedback primitives",
    backlogItemIds: ["BI-6182950F"],
    moveTypes: ["T2", "T4"],
    wave: "0",
    effort: "M",
    leverage: "H",
    leafEstimate: 320,
    selectors: {
      models: [],
      tools: [],
      files: [
        "apps/web/components/ui/report-kit/index.ts",
        "apps/web/components/ui/report-kit/statusColors.ts",
      ],
    },
  },
  {
    betKey: "BET-8",
    title: "Model-routing/dispatch spine — one loop, one sensitivity source",
    backlogItemIds: ["BI-0C4486A5"],
    moveTypes: ["T2", "T6"],
    wave: "1",
    effort: "L",
    leverage: "H",
    leafEstimate: 55,
    selectors: {
      models: [],
      tools: [],
      files: [
        "apps/web/lib/routing/pipeline.ts",
        "apps/web/lib/routing/pipeline-v2.ts",
        "apps/web/lib/routing/task-router.ts",
        "apps/web/lib/tak/agent-router.ts",
        "apps/web/lib/inference/ai-provider-priority.ts",
        "apps/web/lib/routing/task-dispatcher.ts",
      ],
    },
  },
  {
    betKey: "BET-9",
    title: "Financial-document family + canonical Money",
    backlogItemIds: ["BI-9D4A5D22"],
    moveTypes: ["T3", "T4"],
    wave: "3",
    effort: "XL",
    leverage: "H",
    leafEstimate: 50,
    selectors: {
      models: [
        "Quote",
        "Invoice",
        "Bill",
        "PurchaseOrder",
        "SalesOrder",
        "StorefrontOrder",
        "LedgerAccount",
      ],
      tools: [],
      files: ["apps/web/lib/finance/setup-profile.ts"],
    },
  },
  {
    betKey: "BET-10",
    title: "Live health/run read-model — OperationsRunReadModel + one reaper framework",
    backlogItemIds: ["BI-B6157FB7"],
    moveTypes: ["T4", "T5"],
    wave: "1",
    effort: "L",
    leverage: "H",
    leafEstimate: 40,
    selectors: {
      models: ["TaskRun"],
      tools: [],
      files: ["apps/web/lib/ai-operations-map/load-map-data.ts"],
    },
  },
  {
    betKey: "BET-11",
    title: "Backup/restore/scheduling substrate — runManagedBackup + one metric family",
    backlogItemIds: ["BI-B72328D5"],
    moveTypes: ["T4", "T5"],
    wave: "2",
    effort: "M",
    leverage: "H",
    leafEstimate: 90,
    selectors: {
      models: [],
      tools: [],
      files: [
        "scripts/backup-postgres.sh",
        "scripts/backup-neo4j.sh",
        "scripts/backup-qdrant.sh",
      ],
    },
  },
  {
    betKey: "BET-12",
    title: "Governance findings/evidence plane — one GovernanceFinding contract",
    backlogItemIds: ["BI-7CD647B0"],
    moveTypes: ["T3", "T7"],
    wave: "2",
    effort: "M",
    leverage: "M",
    leafEstimate: 45,
    selectors: {
      models: ["WikiLintFinding", "ComplianceEvidence", "DecisionInteraction"],
      tools: [],
      files: ["apps/web/lib/wiki/lint.ts"],
    },
  },
  {
    betKey: "BET-13",
    title: "Identity & vocabulary convergence — fold identity onto Principal/Address",
    backlogItemIds: ["BI-75B31594"],
    moveTypes: ["T2", "T3", "T7"],
    wave: "3",
    effort: "XL",
    leverage: "H",
    leafEstimate: 45,
    selectors: {
      models: [
        "Principal",
        "PrincipalAlias",
        "CustomerContact",
        "Organization",
        "CustomerAccount",
      ],
      tools: [],
      files: ["apps/web/lib/shared/org-address.ts"],
    },
  },
  {
    betKey: "BET-14",
    title: "External-surface rationalization — deps, engines, MCP fleet, services, skills",
    backlogItemIds: ["BI-C0CEB377", "BI-3B0AD9CF"],
    moveTypes: ["T1", "T5", "T6"],
    wave: "continuous",
    effort: "M",
    leverage: "M",
    leafEstimate: 45,
    selectors: {
      models: [],
      tools: [],
      files: [
        "scripts/sbom/internalization-candidates.mjs",
        "sbom/dependency-allowlist.json",
      ],
    },
  },
];

/** Every BacklogItem.itemId delivering a consolidation bet (overlay matching). */
export const CONSOLIDATION_BET_ITEM_IDS: ReadonlySet<string> = new Set(
  CONSOLIDATION_BETS.flatMap((bet) => bet.backlogItemIds),
);

export function getConsolidationBet(betKey: string): ConsolidationBet | undefined {
  return CONSOLIDATION_BETS.find((bet) => bet.betKey === betKey);
}
