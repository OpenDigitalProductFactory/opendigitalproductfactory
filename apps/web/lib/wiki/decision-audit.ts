// Decision audit — per-tier (WWMD/WWWD/WSID) read model over the
// DecisionInteraction ledger for the decision-governance hub.
//
// Pure mapping/summarization lives here (unit-testable); the pages do the
// Prisma I/O and pass rows in, mirroring decision-governance-hub.ts.

export const DECISION_AUDIT_TIERS = ["wwmd", "wwwd", "wsid"] as const;
export type DecisionAuditTier = (typeof DECISION_AUDIT_TIERS)[number];

export type DecisionAuditTierOrOther = DecisionAuditTier | "other";

/** Map a decision-perspective profile kind onto its governance tier. */
export function tierForProfileKind(kind: string | null | undefined): DecisionAuditTierOrOther {
  switch (kind) {
    case "platform":
      return "wwmd";
    case "organization":
      return "wwwd";
    case "profession":
      return "wsid";
    default:
      return "other";
  }
}

export const TIER_LABELS: Record<DecisionAuditTierOrOther, { code: string; expansion: string }> = {
  wwmd: { code: "WWMD", expansion: "Platform doctrine" },
  wwwd: { code: "WWWD", expansion: "Your business" },
  wsid: { code: "WSID", expansion: "Role craft" },
  other: { code: "Other", expansion: "Other perspectives" },
};

/** Profile-kind filter for a tier, for Prisma `profile: { kind: ... }` clauses. */
export function profileKindsForTier(tier: DecisionAuditTier): string[] {
  switch (tier) {
    case "wwmd":
      return ["platform"];
    case "wwwd":
      return ["organization"];
    case "wsid":
      return ["profession"];
  }
}

export type DecisionAuditRowInput = {
  interactionId: string;
  createdAt: Date;
  question: string;
  options: unknown;
  outcomeType: string;
  riskTier: string;
  principleConflict: boolean;
  domainClass: string;
  routeContext: string | null;
  rationale: string | null;
  confidenceAfter: number | null;
  outcomePayload: unknown;
  humanOutcome: unknown;
  profile: { kind: string; name: string } | null;
  escalationCapture: { createdAt: Date } | null;
  deferralCapture: { gapReason: string } | null;
};

export type DecisionAuditRow = {
  interactionId: string;
  createdAt: string;
  tier: DecisionAuditTierOrOther;
  tierCode: string;
  profileName: string;
  question: string;
  optionCount: number;
  recommendedOptionId: string | null;
  outcomeType: string;
  /** True for defer/escalate rows with no human resolution yet. */
  awaitingHuman: boolean;
  riskTier: string;
  principleConflict: boolean;
  domainClass: string;
  routeContext: string;
  confidence: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const UNRESOLVED_OUTCOMES = new Set(["defer", "escalate"]);

export function toAuditRow(row: DecisionAuditRowInput): DecisionAuditRow {
  const tier = tierForProfileKind(row.profile?.kind);
  const payload = asRecord(row.outcomePayload);
  const human = asRecord(row.humanOutcome);
  const resolvedByHuman = Boolean(row.escalationCapture) || Object.keys(human).length > 0;
  return {
    interactionId: row.interactionId,
    createdAt: row.createdAt.toISOString(),
    tier,
    tierCode: TIER_LABELS[tier].code,
    profileName: row.profile?.name ?? "—",
    question: row.question,
    optionCount: Array.isArray(row.options) ? row.options.length : 0,
    recommendedOptionId:
      typeof payload.recommendedOptionId === "string" ? payload.recommendedOptionId : null,
    outcomeType: row.outcomeType,
    awaitingHuman: UNRESOLVED_OUTCOMES.has(row.outcomeType) && !resolvedByHuman,
    riskTier: row.riskTier,
    principleConflict: row.principleConflict,
    domainClass: row.domainClass,
    routeContext: row.routeContext ?? "—",
    confidence: row.confidenceAfter,
  };
}

export type DecisionTierStats = {
  tier: DecisionAuditTier;
  code: string;
  expansion: string;
  total: number;
  last7d: number;
  last30d: number;
  unresolved: number;
  lastDecisionAt: string | null;
};

/**
 * Summarize per-tier usage from raw per-tier counts. The page supplies the
 * counts (Prisma count queries); this shapes them for the stat cards,
 * including the "never used" signal the hub uses to flag a dormant tier.
 */
export function buildTierStats(input: {
  tier: DecisionAuditTier;
  total: number;
  last7d: number;
  last30d: number;
  unresolved: number;
  lastDecisionAt: Date | null;
}): DecisionTierStats {
  return {
    tier: input.tier,
    code: TIER_LABELS[input.tier].code,
    expansion: TIER_LABELS[input.tier].expansion,
    total: input.total,
    last7d: input.last7d,
    last30d: input.last30d,
    unresolved: input.unresolved,
    lastDecisionAt: input.lastDecisionAt ? input.lastDecisionAt.toISOString() : null,
  };
}
