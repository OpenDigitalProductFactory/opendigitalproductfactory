import type { ProductManagementScopeKind } from "./product-management-scope";

export const PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND =
  "product-management-playbook" as const;

export const PRODUCT_MANAGEMENT_PLAYBOOK_IDS = [
  "weekly-intelligence",
  "product-line-performance-review",
  "demand-triage",
  "investment-preparation",
  "roadmap-refresh",
  "commercial-opportunity-review",
  "outcome-review",
  "stakeholder-brief",
] as const;

export type ProductManagementPlaybookId =
  (typeof PRODUCT_MANAGEMENT_PLAYBOOK_IDS)[number];

export type ProductManagementPlaybookScopeKind =
  | "organization"
  | "product-line"
  | "product";

export type ProductManagementCanonicalSourceKind =
  | "backlog-item"
  | "backlog-item-activity"
  | "business-product"
  | "catalog-item"
  | "change-item"
  | "decision-interaction"
  | "knowledge-article"
  | "marketing-battlecard"
  | "product-objective"
  | "product-objective-observation"
  | "product-offering"
  | "product-sold"
  | "research-proposal"
  | "scheduled-agent-task"
  | "task-run";

export type ProductManagementPlaybookRecipe = {
  id: ProductManagementPlaybookId;
  label: string;
  shortLabel: string;
  purpose: string;
  supportedScopes: readonly ProductManagementPlaybookScopeKind[];
  canonicalInputs: readonly ProductManagementCanonicalSourceKind[];
  allowedTools: readonly string[];
  output: {
    type:
      | "intelligence-brief"
      | "performance-review"
      | "demand-triage"
      | "investment-brief"
      | "roadmap-refresh"
      | "commercial-review"
      | "outcome-review"
      | "stakeholder-brief";
    authority: "derived";
    importable: false;
  };
  proposedWrites: readonly {
    authority: string;
    canonical: true;
    approval: "required";
  }[];
  approvalBoundary: string;
  recommendedSchedule: {
    label: string;
    cron: string;
  };
  failureBehavior: string;
  refreshOn: readonly ProductManagementCanonicalSourceKind[];
  guidance: {
    ownerOperator: string;
    productManager: string;
  };
};

const COMMON_READ_TOOLS = [
  "search_portfolio_context",
] as const;

function recipe(
  value: ProductManagementPlaybookRecipe,
): ProductManagementPlaybookRecipe {
  return Object.freeze(value);
}

export const PRODUCT_MANAGEMENT_PLAYBOOKS = Object.freeze([
  recipe({
    id: "weekly-intelligence",
    label: "Weekly intelligence review",
    shortLabel: "Review what changed",
    purpose:
      "Summarize new cited market, competitor, customer, and delivery evidence for the selected business-product scope.",
    supportedScopes: ["organization", "product-line", "product"],
    canonicalInputs: [
      "research-proposal",
      "knowledge-article",
      "marketing-battlecard",
      "change-item",
    ],
    allowedTools: [
      ...COMMON_READ_TOOLS,
      "propose_product_research",
      "get_battlecards",
      "search_knowledge_base",
    ],
    output: {
      type: "intelligence-brief",
      authority: "derived",
      importable: false,
    },
    proposedWrites: [
      {
        authority: "ResearchProposal",
        canonical: true,
        approval: "required",
      },
    ],
    approvalBoundary:
      "Preview sources and proposed research; approval is required before research is started or retained.",
    recommendedSchedule: { label: "Weekly", cron: "0 9 * * 1" },
    failureBehavior:
      "Publish partial evidence with missing sources named; retain the prior result as stale rather than current.",
    refreshOn: [
      "research-proposal",
      "knowledge-article",
      "marketing-battlecard",
      "change-item",
    ],
    guidance: {
      ownerOperator:
        "See what changed this week and which change deserves your attention.",
      productManager:
        "Review evidence deltas, source freshness, contradictions, and follow-up research proposals.",
    },
  }),
  recipe({
    id: "product-line-performance-review",
    label: "Product-line performance review",
    shortLabel: "Review the product line",
    purpose:
      "Roll Product performance into an evidence-backed ProductLine view without changing the reporting boundary.",
    supportedScopes: ["organization", "product-line"],
    canonicalInputs: [
      "business-product",
      "product-sold",
      "product-objective",
      "product-objective-observation",
      "backlog-item",
    ],
    allowedTools: [
      "search_portfolio_context",
      "query_backlog",
      "evaluate_org_business_decision",
    ],
    output: {
      type: "performance-review",
      authority: "derived",
      importable: false,
    },
    proposedWrites: [
      {
        authority: "DecisionInteraction",
        canonical: true,
        approval: "required",
      },
    ],
    approvalBoundary:
      "Preview rollup evidence and proposed advice; review is required before recording a business decision.",
    recommendedSchedule: { label: "Monthly", cron: "0 9 1 * *" },
    failureBehavior:
      "Show partial or unavailable measures by Product; never fill missing performance or movement evidence.",
    refreshOn: [
      "business-product",
      "product-sold",
      "product-objective",
      "product-objective-observation",
      "backlog-item",
    ],
    guidance: {
      ownerOperator:
        "See which line is growing, at risk, or missing evidence before you choose where to focus.",
      productManager:
        "Review comparable performance, outcome posture, evidence completeness, and governed advice by ProductLine.",
    },
  }),
  recipe({
    id: "demand-triage",
    label: "Demand triage",
    shortLabel: "Sort new demand",
    purpose:
      "Prepare evidence gaps, classification, and next actions for demand without crossing the funding gate.",
    supportedScopes: ["organization", "product-line", "product"],
    canonicalInputs: ["backlog-item", "backlog-item-activity"],
    allowedTools: [
      "query_backlog",
      "score_demand_item",
      "transition_demand_item",
      "link_demand_evidence",
    ],
    output: {
      type: "demand-triage",
      authority: "derived",
      importable: false,
    },
    proposedWrites: [
      {
        authority: "BacklogItem",
        canonical: true,
        approval: "required",
      },
    ],
    approvalBoundary:
      "Preview classifications and score inputs; approval is required before canonical demand fields change.",
    recommendedSchedule: { label: "Weekly", cron: "0 10 * * 2" },
    failureBehavior:
      "Leave incomplete demand unclassified and show the missing evidence; partial scores are not funding decisions.",
    refreshOn: ["backlog-item", "backlog-item-activity"],
    guidance: {
      ownerOperator:
        "Sort new requests into what needs evidence, a decision, or no action.",
      productManager:
        "Review demand classification, score readiness, dependency evidence, and proposed canonical updates.",
    },
  }),
  recipe({
    id: "investment-preparation",
    label: "Investment preparation",
    shortLabel: "Prepare an investment decision",
    purpose:
      "Prepare a comparable evidence packet for scored demand while preserving the governed funding decision.",
    supportedScopes: ["organization", "product-line", "product"],
    canonicalInputs: [
      "backlog-item",
      "backlog-item-activity",
      "decision-interaction",
      "product-objective",
    ],
    allowedTools: [
      "query_backlog",
      "score_demand_item",
      "approve_demand_for_funding",
      "evaluate_org_business_decision",
    ],
    output: {
      type: "investment-brief",
      authority: "derived",
      importable: false,
    },
    proposedWrites: [
      {
        authority: "DecisionInteraction",
        canonical: true,
        approval: "required",
      },
      {
        authority: "BacklogItem",
        canonical: true,
        approval: "required",
      },
    ],
    approvalBoundary:
      "Preview evidence, score, alternatives, and proposed funding transition; a governed human/business decision remains required.",
    recommendedSchedule: { label: "Weekly", cron: "0 11 * * 3" },
    failureBehavior:
      "Mark the packet partial when inputs conflict or are missing and do not advance demand stage.",
    refreshOn: [
      "backlog-item",
      "backlog-item-activity",
      "decision-interaction",
      "product-objective",
    ],
    guidance: {
      ownerOperator:
        "Compare the evidence, cost, urgency, and expected result before committing resources.",
      productManager:
        "Prepare traceable investment options, score components, outcome alignment, risks, and the governed funding action.",
    },
  }),
  recipe({
    id: "roadmap-refresh",
    label: "Roadmap refresh",
    shortLabel: "Refresh current bets",
    purpose:
      "Regenerate Now, Next, and Later from funded demand, objectives, dependencies, and delivery evidence.",
    supportedScopes: ["product-line", "product"],
    canonicalInputs: [
      "backlog-item",
      "backlog-item-activity",
      "product-objective",
      "product-objective-observation",
      "change-item",
    ],
    allowedTools: [
      "search_portfolio_context",
      "query_backlog",
      "evaluate_org_business_decision",
    ],
    output: {
      type: "roadmap-refresh",
      authority: "derived",
      importable: false,
    },
    proposedWrites: [
      {
        authority: "DecisionInteraction",
        canonical: true,
        approval: "required",
      },
    ],
    approvalBoundary:
      "Preview changed lanes, sources, and confidence; review is required before retaining a stakeholder narrative.",
    recommendedSchedule: { label: "Weekly", cron: "0 9 * * 4" },
    failureBehavior:
      "Keep unclassified or contradictory work in the readiness queue and label the prior roadmap stale.",
    refreshOn: [
      "backlog-item",
      "backlog-item-activity",
      "product-objective",
      "product-objective-observation",
      "change-item",
    ],
    guidance: {
      ownerOperator:
        "See what is happening now, what is likely next, and what still needs evidence.",
      productManager:
        "Review lane changes, outcome linkage, dependencies, delivery state, confidence, and source deltas.",
    },
  }),
  recipe({
    id: "commercial-opportunity-review",
    label: "Commercial opportunity review",
    shortLabel: "Review what customers buy",
    purpose:
      "Find evidence-backed gaps and opportunities across Products, offerings, catalog items, and recorded sales.",
    supportedScopes: ["organization", "product-line", "product"],
    canonicalInputs: [
      "business-product",
      "product-offering",
      "catalog-item",
      "product-sold",
    ],
    allowedTools: [
      "search_portfolio_context",
      "list_opportunities",
      "list_quotes",
      "evaluate_org_business_decision",
    ],
    output: {
      type: "commercial-review",
      authority: "derived",
      importable: false,
    },
    proposedWrites: [
      {
        authority: "DecisionInteraction",
        canonical: true,
        approval: "required",
      },
    ],
    approvalBoundary:
      "Preview commercial evidence and proposed decision; approval is required before changing an offering, catalog item, or route-to-market.",
    recommendedSchedule: { label: "Monthly", cron: "0 10 1 * *" },
    failureBehavior:
      "Report absent sales or catalog evidence as unavailable; do not invent customers, consumers, or revenue.",
    refreshOn: [
      "business-product",
      "product-offering",
      "catalog-item",
      "product-sold",
    ],
    guidance: {
      ownerOperator:
        "See what is selling, what is missing from the offer, and where evidence supports a follow-up.",
      productManager:
        "Review Product-to-offering-to-catalog-to-sale traceability, mix, attribution, and evidence-backed opportunity.",
    },
  }),
  recipe({
    id: "outcome-review",
    label: "Outcome review",
    shortLabel: "Review whether the bet worked",
    purpose:
      "Compare objective observations with the funded work that was expected to contribute and capture learning.",
    supportedScopes: ["product-line", "product"],
    canonicalInputs: [
      "product-objective",
      "product-objective-observation",
      "backlog-item",
      "backlog-item-activity",
    ],
    allowedTools: [
      "search_portfolio_context",
      "record_product_outcome_observation",
      "review_product_objective",
      "correct_product_outcome_observation",
    ],
    output: {
      type: "outcome-review",
      authority: "derived",
      importable: false,
    },
    proposedWrites: [
      {
        authority: "ProductObjectiveObservation",
        canonical: true,
        approval: "required",
      },
      {
        authority: "ProductObjectiveReview",
        canonical: true,
        approval: "required",
      },
    ],
    approvalBoundary:
      "Preview evidence and proposed observation/review; approval is required before canonical outcome learning is recorded.",
    recommendedSchedule: { label: "Monthly", cron: "0 11 1 * *" },
    failureBehavior:
      "Show partial or unavailable evidence explicitly when baselines, observations, or comparable measures are missing; never infer movement.",
    refreshOn: [
      "product-objective",
      "product-objective-observation",
      "backlog-item",
      "backlog-item-activity",
    ],
    guidance: {
      ownerOperator:
        "Check whether the result you wanted is moving and record what you learned.",
      productManager:
        "Review measure compatibility, baseline, observations, contribution evidence, cadence, and the next learning decision.",
    },
  }),
  recipe({
    id: "stakeholder-brief",
    label: "Stakeholder or owner brief",
    shortLabel: "Prepare a shareable brief",
    purpose:
      "Prepare a concise, timestamped view of decisions, evidence, current bets, outcomes, roadmap, and risks.",
    supportedScopes: ["organization", "product-line", "product"],
    canonicalInputs: [
      "decision-interaction",
      "knowledge-article",
      "backlog-item",
      "product-objective",
      "product-objective-observation",
      "change-item",
      "scheduled-agent-task",
      "task-run",
    ],
    allowedTools: [
      "search_portfolio_context",
      "query_backlog",
      "list_scheduled_agent_tasks",
      "evaluate_org_business_decision",
    ],
    output: {
      type: "stakeholder-brief",
      authority: "derived",
      importable: false,
    },
    proposedWrites: [
      {
        authority: "DecisionInteraction",
        canonical: true,
        approval: "required",
      },
    ],
    approvalBoundary:
      "Preview the complete brief and provenance before export or optional reviewed-narrative retention.",
    recommendedSchedule: { label: "Monthly", cron: "0 12 1 * *" },
    failureBehavior:
      "Export a visibly partial brief with stale and unavailable sections named; never reuse an older section as current.",
    refreshOn: [
      "decision-interaction",
      "knowledge-article",
      "backlog-item",
      "product-objective",
      "product-objective-observation",
      "change-item",
      "scheduled-agent-task",
      "task-run",
    ],
    guidance: {
      ownerOperator:
        "Prepare a plain-language update on what changed, what you decided, and what happens next.",
      productManager:
        "Prepare an evidence-linked decision, investment, roadmap, outcome, risk, and provenance brief.",
    },
  }),
] satisfies readonly ProductManagementPlaybookRecipe[]);

const PLAYBOOK_BY_ID = new Map(
  PRODUCT_MANAGEMENT_PLAYBOOKS.map((candidate) => [candidate.id, candidate]),
);

export function isProductManagementPlaybookId(
  value: unknown,
): value is ProductManagementPlaybookId {
  return (
    typeof value === "string" &&
    (PRODUCT_MANAGEMENT_PLAYBOOK_IDS as readonly string[]).includes(value)
  );
}

export function getProductManagementPlaybook(
  id: ProductManagementPlaybookId,
): ProductManagementPlaybookRecipe {
  return PLAYBOOK_BY_ID.get(id)!;
}

export function listProductManagementPlaybooksForScope(
  scope: ProductManagementPlaybookScopeKind,
): readonly ProductManagementPlaybookRecipe[] {
  return PRODUCT_MANAGEMENT_PLAYBOOKS.filter((candidate) =>
    candidate.supportedScopes.includes(scope),
  );
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function buildPlaybookPermissionDigest(
  value: ProductManagementPlaybookRecipe,
): string {
  const payload = JSON.stringify({
    id: value.id,
    scopes: [...value.supportedScopes].sort(),
    tools: [...value.allowedTools].sort(),
    writes: value.proposedWrites
      .map((write) => `${write.authority}:${write.approval}`)
      .sort(),
  });
  return `pm-permissions-${stableHash(payload)}`;
}

export type ProductManagementPlaybookConfig = {
  schemaVersion: 1;
  recipeId: ProductManagementPlaybookId;
  permissionsDigest: string;
  minimumRefreshMinutes: number;
  lastSuccessfulFingerprint: string | null;
  lastRefreshQueuedAt: string | null;
  lastRefreshChangeKey: string | null;
};

export function parseProductManagementPlaybookConfig(
  value: unknown,
): ProductManagementPlaybookConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Product-management playbook configuration is missing.");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) {
    throw new Error("Unsupported product-management playbook schema version.");
  }
  if (!isProductManagementPlaybookId(input.recipeId)) {
    throw new Error("Unknown product-management playbook recipe.");
  }
  const recipeValue = getProductManagementPlaybook(input.recipeId);
  const expectedDigest = buildPlaybookPermissionDigest(recipeValue);
  if (input.permissionsDigest !== expectedDigest) {
    throw new Error(
      "Product-management playbook permission scope changed; preview and approve it again.",
    );
  }
  const minimumRefreshMinutes = input.minimumRefreshMinutes;
  if (
    typeof minimumRefreshMinutes !== "number" ||
    !Number.isInteger(minimumRefreshMinutes) ||
    minimumRefreshMinutes < 15 ||
    minimumRefreshMinutes > 10_080
  ) {
    throw new Error(
      "Product-management playbook refresh interval must be between 15 minutes and 7 days.",
    );
  }
  const nullableString = (candidate: unknown, label: string) => {
    if (candidate == null) return null;
    if (typeof candidate !== "string" || !candidate.trim()) {
      throw new Error(`Product-management playbook ${label} is invalid.`);
    }
    return candidate.trim();
  };
  const lastRefreshQueuedAt = nullableString(
    input.lastRefreshQueuedAt,
    "last refresh time",
  );
  if (
    lastRefreshQueuedAt &&
    Number.isNaN(new Date(lastRefreshQueuedAt).getTime())
  ) {
    throw new Error(
      "Product-management playbook last refresh time is invalid.",
    );
  }
  return {
    schemaVersion: 1,
    recipeId: input.recipeId,
    permissionsDigest: expectedDigest,
    minimumRefreshMinutes,
    lastSuccessfulFingerprint: nullableString(
      input.lastSuccessfulFingerprint,
      "input fingerprint",
    ),
    lastRefreshQueuedAt,
    lastRefreshChangeKey: nullableString(
      input.lastRefreshChangeKey,
      "last refresh change key",
    ),
  };
}

export type ProductManagementSourceReference = {
  sourceKind: ProductManagementCanonicalSourceKind;
  sourceId: string;
  asOf: Date;
};

export function buildPlaybookInputFingerprint(
  sources: readonly ProductManagementSourceReference[],
): string {
  const payload = sources
    .map(
      (source) =>
        `${source.sourceKind}:${source.sourceId}:${source.asOf.toISOString()}`,
    )
    .sort()
    .join("|");
  return `pm-input-${stableHash(payload)}`;
}

export function shouldRefreshProductManagementPlaybook(input: {
  recipeId: ProductManagementPlaybookId;
  changedSourceKind: ProductManagementCanonicalSourceKind;
  nextFingerprint: string;
  lastSuccessfulFingerprint: string | null;
  lastRefreshQueuedAt: Date | null;
  lastRefreshChangeKey?: string | null;
  changeKey?: string | null;
  minimumRefreshMinutes: number;
  now: Date;
}):
  | { shouldRefresh: true; reason: "relevant-change" }
  | {
      shouldRefresh: false;
      reason:
        | "source-not-relevant"
        | "unchanged"
        | "duplicate-change"
        | "rate-limited";
    } {
  const recipeValue = getProductManagementPlaybook(input.recipeId);
  if (!recipeValue.refreshOn.includes(input.changedSourceKind)) {
    return { shouldRefresh: false, reason: "source-not-relevant" };
  }
  if (input.nextFingerprint === input.lastSuccessfulFingerprint) {
    return { shouldRefresh: false, reason: "unchanged" };
  }
  if (
    input.changeKey &&
    input.changeKey === input.lastRefreshChangeKey
  ) {
    return { shouldRefresh: false, reason: "duplicate-change" };
  }
  if (
    input.lastRefreshQueuedAt &&
    input.now.getTime() - input.lastRefreshQueuedAt.getTime() <
      input.minimumRefreshMinutes * 60_000
  ) {
    return { shouldRefresh: false, reason: "rate-limited" };
  }
  return { shouldRefresh: true, reason: "relevant-change" };
}

export type ProductManagementBriefSnapshot = {
  schemaVersion: 1;
  importable: false;
  authority: "derived-snapshot";
  recipeId: ProductManagementPlaybookId;
  scope: {
    kind: ProductManagementPlaybookScopeKind;
    organizationId: string;
    productLineId: string | null;
    businessProductId: string | null;
  };
  generatedAt: string;
  asOf: string;
  confidence: "high" | "partial" | "unavailable";
  sourceIds: string[];
  sources: Array<{
    sourceKind: ProductManagementCanonicalSourceKind;
    sourceId: string;
    asOf: string;
  }>;
  sections: Array<{ id: string; title: string; body: string }>;
};

export function buildProductManagementBriefSnapshot(input: {
  recipeId: ProductManagementPlaybookId;
  scope: {
    kind: ProductManagementPlaybookScopeKind;
    organizationId: string;
    productLineId?: string | null;
    businessProductId?: string | null;
  };
  generatedAt: Date;
  confidence: ProductManagementBriefSnapshot["confidence"];
  sources: readonly ProductManagementSourceReference[];
  sections: Array<{ id: string; title: string; body: string }>;
}): ProductManagementBriefSnapshot {
  const sources = [...input.sources]
    .sort(
      (left, right) =>
        left.sourceKind.localeCompare(right.sourceKind) ||
        left.sourceId.localeCompare(right.sourceId),
    )
    .map((source) => ({
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      asOf: source.asOf.toISOString(),
    }));
  const newest = input.sources.reduce<Date | null>(
    (current, source) =>
      !current || source.asOf > current ? source.asOf : current,
    null,
  );
  return {
    schemaVersion: 1,
    importable: false,
    authority: "derived-snapshot",
    recipeId: input.recipeId,
    scope: {
      kind: input.scope.kind,
      organizationId: input.scope.organizationId,
      productLineId: input.scope.productLineId ?? null,
      businessProductId: input.scope.businessProductId ?? null,
    },
    generatedAt: input.generatedAt.toISOString(),
    asOf: (newest ?? input.generatedAt).toISOString(),
    confidence: input.confidence,
    sourceIds: sources.map(
      (source) => `${source.sourceKind}:${source.sourceId}`,
    ),
    sources,
    sections: input.sections,
  };
}

export function productManagementPlaybookScopeKind(
  kind: ProductManagementScopeKind | ProductManagementPlaybookScopeKind,
): ProductManagementPlaybookScopeKind {
  if (kind === "business-product") return "product";
  if (kind === "digital-product") {
    throw new Error(
      "Business product-management playbooks do not support DigitalProduct scope.",
    );
  }
  return kind;
}
