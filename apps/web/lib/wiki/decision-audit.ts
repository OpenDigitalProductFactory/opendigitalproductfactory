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

/** Map the gate that produced a row onto its governance tier. */
export function tierForGateKey(gateKey: string | null | undefined): DecisionAuditTierOrOther {
  switch (gateKey) {
    case "build-studio":
    case "backlog-triage":
      return "wwmd";
    case "org-business":
      return "wwwd";
    case "profession":
      return "wsid";
    default:
      return "other";
  }
}

/**
 * The tier a ledger row audits under (BI-1BE30A9A).
 *
 * The gate that ran wins over the profile that resolved. Tiering on profile
 * kind alone is wrong whenever doctrine fell back across kinds: the profession
 * gate falls back to MARK_DPF_PLATFORM_PROFILE when the craft corpus has no
 * material, so a WSID decision would file itself under WWMD and the WSID tier
 * would read "never used" no matter how often the gate ran.
 *
 * `gateKey` is null only on rows written before the column existed; those fall
 * back to profile kind, which is accurate for them because the profession gate
 * had never run at the time they were written.
 */
export function tierForRow(row: {
  gateKey?: string | null;
  profile?: { kind: string } | null;
}): DecisionAuditTierOrOther {
  return row.gateKey ? tierForGateKey(row.gateKey) : tierForProfileKind(row.profile?.kind);
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

/** The gate keys whose rows belong to a tier. */
export function gateKeysForTier(tier: DecisionAuditTier): string[] {
  switch (tier) {
    case "wwmd":
      return ["build-studio", "backlog-triage"];
    case "wwwd":
      return ["org-business"];
    case "wsid":
      return ["profession"];
  }
}

/**
 * Prisma `where` fragment selecting a tier's rows, mirroring `tierForRow`:
 * the gate wins where it is recorded, and rows predating `gateKey` fall back
 * to profile kind. Both branches are needed — filtering on `gateKey` alone
 * would hide every historical row, and on profile kind alone would misfile
 * fallback rows (BI-1BE30A9A).
 */
export function tierWhere(tier: DecisionAuditTier): Record<string, unknown> {
  return {
    OR: [
      { gateKey: { in: gateKeysForTier(tier) } },
      { gateKey: null, profile: { kind: { in: profileKindsForTier(tier) } } },
    ],
  };
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
  /** The gate that produced the row; null on rows predating the column. */
  gateKey?: string | null;
  /** True when the gate's doctrine fell back off its own profile kind. */
  gateFallbackUsed?: boolean | null;
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
  /** Who consulted: client UA token, coworker agent, or calling surface. */
  callerLabel: string;
  /** Thread the consult belonged to, when the caller carried one. */
  callerThreadId: string | null;
  /** The gate that produced this row, for "which door did this come through?". */
  gateKey: string | null;
  /**
   * True when the tier's own doctrine had no material and the gate fell back.
   * Surfaced so a WSID row decided from platform defaults is not mistaken for
   * one grounded in the profession's craft corpus.
   */
  gateFallbackUsed: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const UNRESOLVED_OUTCOMES = new Set(["defer", "escalate"]);

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Derive the caller attribution for a ledger row. Precedence: the explicit
 * caller block writers persist (client UA token, else the coworker agent),
 * then the voluntary callingSurface string, then unattributed. Rows written
 * before attribution existed resolve the same way — usually to callingSurface
 * or "—".
 */
export function callerForRow(payload: Record<string, unknown>): {
  label: string;
  threadId: string | null;
} {
  const caller = asRecord(payload.caller);
  const client = asNullableString(caller.client);
  const agentId = asNullableString(caller.agentId);
  const threadId = asNullableString(caller.threadId);
  const callingSurface = asNullableString(payload.callingSurface);

  const label = client ?? (agentId ? `coworker:${agentId}` : null) ?? callingSurface ?? "—";
  return { label, threadId };
}

export type DecisionCallerStat = {
  label: string;
  total: number;
  lastAt: string;
};

/**
 * Roll the timeline rows up by caller so the page can show who is (and by
 * absence, who is not) consulting the kernel. Unattributed rows group under
 * "—". Sorted by volume.
 */
export function buildCallerStats(rows: DecisionAuditRow[]): DecisionCallerStat[] {
  const byCaller = new Map<string, { total: number; lastAt: string }>();
  for (const row of rows) {
    const existing = byCaller.get(row.callerLabel);
    if (existing) {
      existing.total += 1;
      if (row.createdAt > existing.lastAt) existing.lastAt = row.createdAt;
    } else {
      byCaller.set(row.callerLabel, { total: 1, lastAt: row.createdAt });
    }
  }
  return [...byCaller.entries()]
    .map(([label, v]) => ({ label, total: v.total, lastAt: v.lastAt }))
    .sort((a, b) => b.total - a.total);
}

export function toAuditRow(row: DecisionAuditRowInput): DecisionAuditRow {
  const tier = tierForRow(row);
  const payload = asRecord(row.outcomePayload);
  const human = asRecord(row.humanOutcome);
  const resolvedByHuman = Boolean(row.escalationCapture) || Object.keys(human).length > 0;
  const caller = callerForRow(payload);
  return {
    callerLabel: caller.label,
    callerThreadId: caller.threadId,
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
    gateKey: row.gateKey ?? null,
    gateFallbackUsed: row.gateFallbackUsed === true,
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
