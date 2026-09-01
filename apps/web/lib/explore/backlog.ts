// Pure utility library — no server imports. Safe in tests and client components.

export type BacklogItemInput = {
  title: string;
  type: "product" | "portfolio";
  workType: BacklogWorkType;
  status: BacklogStatus;
  source?: BacklogSource;
  priority?: number;
  body?: string;
  taxonomyNodeId?: string;
  digitalProductId?: string;
  organizationId?: string;
  productLineId?: string;
  businessProductId?: string;
  demandStage?: DemandStage | null;
  epicId?: string;
  scopeKind?: BacklogScopeKind;
  archetypeCategories?: string[];
  archetypeIds?: string[];
  scopeRationale?: string;
  lifecycleTags?: string[];
  deferReason?: string;
  deferTrigger?: string;
  deferReviewAt?: string;
};

export type BacklogItemWithRelations = {
  id: string;
  itemId: string;
  title: string;
  status: string;
  type: string;
  workType: string | null;
  source: string | null;
  body: string | null;
  priority: number | null;
  epicId: string | null;
  triageOutcome: string | null;
  duplicateOfId?: string | null;
  effortSize: string | null;
  activeBuildId: string | null;
  scopeKind?: string | null;
  archetypeCategories?: string[];
  archetypeIds?: string[];
  scopeRationale?: string | null;
  lifecycleTags?: string[];
  activeBuild: { buildId: string; phase: string | null } | null;
  activeWorkrooms?: import("@/lib/work-capsules/backlog-workroom-ownership").BacklogWorkroomSummary[];
  digitalProduct: { id: string; productId: string; name: string } | null;
  organizationId?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
  demandStage?: string | null;
  taxonomyNode: { id: string; nodeId: string; name: string } | null;
  submittedBy: { email: string } | null;
  completedAt: Date | null;
  agentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  upstreamIssueNumber: number | null;
  upstreamIssueUrl: string | null;
  // Operator-triage inputs (BI-9952EA9E). All existing BacklogItem columns —
  // optional here so existing fixtures/callers that don't select them still
  // typecheck; the /ops loaders select them for the triage lens.
  claimStatus?: string | null;
  stalenessDetectedAt?: Date | null;
  riskOpportunity?: number | null;
  businessValue?: number | null;
  timeCriticality?: number | null;
  // Ownership — who has actively claimed this item. Drives the "mine vs
  // company-wide" scope split in the Needs-you-next band (BI-01CC2356).
  claimedById?: string | null;
  deferReason?: string | null;
  deferTrigger?: string | null;
  deferReviewAt?: Date | null;
  deferOwnerPrincipalId?: string | null;
  deferredAt?: Date | null;
  deferOwnerPrincipal?: { principalId: string; displayName: string } | null;
};

export type DigitalProductSelect = {
  id: string;
  productId: string;
  name: string;
  lifecycleStage: string;
};

export type TaxonomyNodeSelect = {
  id: string;
  nodeId: string;
  name: string;
};

export type PortfolioForSelect = {
  id: string;
  slug: string;
  name: string;
};

export type EpicInput = {
  title: string;
  description?: string;
  status: "open" | "in-progress" | "done";
  portfolioIds: string[];
};

export type EpicForSelect = {
  id: string;
  epicId: string;
  title: string;
};

export type EpicPortfolioLink = {
  epicId: string;
  portfolioId: string;
  portfolio: { id: string; slug: string; name: string };
};

export type EpicWithRelations = {
  id: string;
  epicId: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  submittedBy: { email: string } | null;
  agentId: string | null;
  completedAt: Date | null;
  portfolios: EpicPortfolioLink[];
  items: BacklogItemWithRelations[];
};

/** Returns null if valid, or an error message if invalid. */
export function validateBacklogInput(input: BacklogItemInput): string | null {
  if (!input.title.trim()) return "Title is required";
  if (
    input.type === "product" &&
    !input.digitalProductId &&
    !input.businessProductId
  ) {
    return "A business product or digital product is required for product-type items";
  }
  const narrowTargets = [
    input.productLineId,
    input.businessProductId,
    input.digitalProductId,
  ].filter((value) => Boolean(value?.trim()));
  if (narrowTargets.length > 1) {
    return "Choose one product-management target: product line, business product, or digital product";
  }
  if (
    (input.productLineId || input.businessProductId) &&
    !input.organizationId
  ) {
    return "An organization is required for business product demand";
  }
  if (
    input.demandStage !== undefined &&
    input.demandStage !== null &&
    !(DEMAND_STAGE_VALUES as readonly string[]).includes(input.demandStage)
  ) {
    return "Invalid demand stage";
  }
  if (
    narrowTargets.length > 0 &&
    input.demandStage !== undefined &&
    input.demandStage !== null &&
    input.demandStage !== "raw"
  ) {
    return "New scoped product demand must enter at raw";
  }
  if (input.scopeKind && !BACKLOG_SCOPE_KIND_VALUES.includes(input.scopeKind)) {
    return "Invalid scope kind";
  }
  if (input.status === "deferred") {
    if (!input.deferReason?.trim()) return "Why this item is deferred is required";
    if (!input.deferTrigger?.trim()) return "A resume trigger is required";
    if (!input.deferReviewAt || Number.isNaN(new Date(input.deferReviewAt).getTime())) {
      return "A valid deferral review date is required";
    }
    if (new Date(input.deferReviewAt).getTime() <= Date.now()) {
      return "The deferral review date must be in the future";
    }
  }
  return null;
}

/** New scoped product demand enters intake explicitly; legacy rows stay null. */
export function initialDemandStageForInput(
  input: {
    productLineId?: string | null;
    businessProductId?: string | null;
    digitalProductId?: string | null;
    demandStage?: DemandStage | null;
  },
): DemandStage | null {
  if (input.demandStage !== undefined) return input.demandStage;
  return input.productLineId || input.businessProductId || input.digitalProductId
    ? "raw"
    : null;
}

export const EPIC_STATUSES = ["open", "in-progress", "done"] as const;
export type EpicStatus = typeof EPIC_STATUSES[number];

export const BACKLOG_STATUS_VALUES = [
  "triaging",
  "open",
  "in-progress",
  "done",
  "deferred",
  "retired",
] as const;
export type BacklogStatus = (typeof BACKLOG_STATUS_VALUES)[number];

// Federation demand sharing operates on OPEN work only — "closed is closed."
// Closed items are never projected to a peer; an item that transitions out of
// this set leaves projection scope and is withdrawn from peers on the next
// reconciliation. `deferred` is treated as not-currently-syncable per the
// live-work convention (paused work resumes syncing when it reopens); `done`
// is terminal. This is the single source of truth for that grouping — the same
// federation lanes (demand-reconciliation, channel-demand) must import it rather
// than re-listing statuses. See BI-8A8C1D3A.
export const FEDERATION_SYNCABLE_BACKLOG_STATUSES = [
  "triaging",
  "open",
  "in-progress",
] as const satisfies readonly BacklogStatus[];

export function isFederationSyncableBacklogStatus(status: string): boolean {
  return (FEDERATION_SYNCABLE_BACKLOG_STATUSES as readonly string[]).includes(status);
}

export const BACKLOG_TRIAGE_OUTCOMES = [
  "build",
  "runbook",
  "coworker-task",
  "defer",
  "duplicate",
  "discard",
] as const;
export type BacklogTriageOutcome = (typeof BACKLOG_TRIAGE_OUTCOMES)[number];

// Pure intake-origin enum. The previous mixed-axis values
// (feature-gap, bug, tool-gap, skill-gap, doc-gap) moved into
// BACKLOG_WORK_TYPE_VALUES below; this enum now answers "how did it arrive"
// not "what kind of work is it".
//
// New values are added only when a writer needs them
// (single-source-of-truth + YAGNI).
export const BACKLOG_SOURCE_VALUES = [
  "user-request",
  "automated-detection",
] as const;
export type BacklogSource = (typeof BACKLOG_SOURCE_VALUES)[number];

// Closed work-type enum (the WHAT). Required on every new BacklogItem.
// Aligned with the Conventional Commits subset that maps cleanly to today's
// BI consumers: bug == fix, feature == feat, plus chore | doc | tool | skill |
// refactor. perf | test | security | ci | style | revert are deferred until a
// writer needs them.
//
// Adding a value requires updating this enum AND the mirror in
// apps/web/lib/mcp-tools.ts (create_backlog_item, update_backlog_item,
// list_backlog_items) in the same commit per AGENTS.md §3.
export const BACKLOG_WORK_TYPE_VALUES = [
  "bug",
  "feature",
  "chore",
  "doc",
  "tool",
  "skill",
  "refactor",
] as const;
export type BacklogWorkType = (typeof BACKLOG_WORK_TYPE_VALUES)[number];

export const BACKLOG_EFFORT_SIZES = ["small", "medium", "large", "xlarge"] as const;
export type BacklogEffortSize = (typeof BACKLOG_EFFORT_SIZES)[number];

// Demand-management funnel + scoring (EP-DEMAND-MGMT Phase 1).
// The graded demand funnel — a facet orthogonal to `status` (which gates
// work-claims). raw -> screened -> shaped -> ready, then promote. WWMD-confirmed
// four-stage shape (ledger DI-5CB3AFE78912). Adding a value requires updating
// this enum AND the mirror in apps/web/lib/mcp-tools.ts in the same commit.
export const DEMAND_STAGE_VALUES = ["raw", "screened", "shaped", "ready"] as const;
export type DemandStage = (typeof DEMAND_STAGE_VALUES)[number];

// The pluggable scoring frameworks. Inputs are stored; the score is computed by
// the active framework (apps/web/lib/demand/scoring.ts). RICE is the seeded
// default (WWMD ledger DI-4CEA0F5FACCE); the others are presets an org selects
// via WWWD doctrine. Adding a value requires updating this enum AND the mirror
// in apps/web/lib/mcp-tools.ts in the same commit.
export const DEMAND_SCORE_FRAMEWORKS = ["rice", "wsjf", "value_effort", "weighted"] as const;
export type DemandScoreFramework = (typeof DEMAND_SCORE_FRAMEWORKS)[number];

// Investment buckets (EP-DEMAND-MGMT Phase 3): the strategic-balance axis so
// demand is prioritized against a target allocation (Run/Grow/Transform, aka
// McKinsey 3 Horizons). WWMD-confirmed label set (ledger DI-8E489A791375).
// Adding a value requires updating this enum AND the mirror in mcp-tools.ts.
export const INVESTMENT_BUCKET_VALUES = ["run", "grow", "transform"] as const;
export type InvestmentBucket = (typeof INVESTMENT_BUCKET_VALUES)[number];

// Backlog/epic planning scope (BI-E387A203): lets roadmap and budget views
// distinguish platform/common work from category/leaf-specific vertical gaps.
// Adding a value requires updating MCP schema parity tests in the same commit.
export const BACKLOG_SCOPE_KIND_VALUES = [
  "platform",
  "common",
  "archetype-category",
  "archetype-leaf",
  "multi-archetype",
  "unknown",
] as const;
export type BacklogScopeKind = (typeof BACKLOG_SCOPE_KIND_VALUES)[number];

/** Returns null if valid, or an error message if invalid. */
export function validateEpicInput(input: EpicInput): string | null {
  if (!input.title.trim()) return "Title is required";
  if (!(EPIC_STATUSES as readonly string[]).includes(input.status)) return "Invalid status";
  return null;
}

/** Status badge colours (inline styles). */
export const BACKLOG_STATUS_COLOURS: Record<string, string> = {
  "open":        "#38bdf8",
  "in-progress": "#fb923c",
  "done":        "#4ade80",
  "deferred":    "#8888a0",
  "retired":     "var(--dpf-muted)",
};

/** Epic status badge colours (inline styles). */
export const EPIC_STATUS_COLOURS: Record<string, string> = {
  "open":        "#38bdf8",
  "in-progress": "#fb923c",
  "done":        "#4ade80",
};

/** Human-readable labels for CSDM lifecycle stages. */
export const LIFECYCLE_STAGE_LABELS: Record<string, string> = {
  plan:       "Plan",
  design:     "Design",
  build:      "Build",
  production: "Production",
  retirement: "Retirement",
};

/** Human-readable labels for CSDM lifecycle statuses. */
export const LIFECYCLE_STATUS_LABELS: Record<string, string> = {
  draft:    "Draft",
  active:   "Active",
  inactive: "Inactive",
};
