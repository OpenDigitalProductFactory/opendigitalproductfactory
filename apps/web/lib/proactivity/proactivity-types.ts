export const PROACTIVITY_LEVELS = ["quiet", "balanced", "assertive"] as const;
export type ProactivityLevel = (typeof PROACTIVITY_LEVELS)[number];

export const PROACTIVITY_ACTIVITY_FAMILIES = [
  "interactive-chat",
  "todo-follow-up",
  "scheduled-task",
  "field-dispatch-appointment",
  "build-studio-custodian",
  "technology-debt",
  "platform-health",
  "tax-compliance",
  "customer-communication",
  "finance-close",
  "security-incident",
  // EP-3516E23D: queue backpressure — a scarce-resource queue backing up past
  // its thresholds warrants a more assertive nudge to whoever manages it.
  "queue-health",
  // BI-B2497DFB: thin prospect/account/contact intake — the coworker offers to
  // enrich from public sources (permission + scope confirmed). Cadence only;
  // the write still routes through the governed apply step.
  "crm-record-enrichment",
  // BI-C26FE785: campaign production and creative review cadence. Without this
  // family the marketing coworker could not be described to the resolver at
  // all, so no posture could govern it and it never acted unprompted.
  // Deliberately NOT folded into "customer-communication": that names
  // transactional outbound to a specific customer (a reply, a receipt), which
  // carries a different cadence and a different approval boundary from
  // producing campaign creative nobody asked for yet.
  "marketing-campaign",
] as const;
export type ProactivityActivityFamily = (typeof PROACTIVITY_ACTIVITY_FAMILIES)[number];

export type ProactivitySpendClass = "minimal" | "standard" | "elevated";
export type ProactivityChannelPolicy = "in-app-only" | "preferred-channel" | "urgent-channel" | "multi-channel";
export type ProactivityActionBoundary = "advise" | "propose" | "preauthorized";
export type ProactivityRiskBand = "low" | "medium" | "high" | "critical";

export type ProactivityEscalationTarget =
  | "attention-surface"
  | "owner"
  | "role"
  | "dispatcher"
  | "platform-operator";

export type ProactivityPlan = {
  resolvedLevel: ProactivityLevel;
  policyId: string;
  attentionWindowMinutes: number;
  followUpCadenceMinutes: number[];
  maxAttempts: number;
  spendClass: ProactivitySpendClass;
  channelPolicy: ProactivityChannelPolicy;
  escalationTarget: ProactivityEscalationTarget;
  actionBoundary: ProactivityActionBoundary;
  explanation: string;
  evidenceRefs: Array<{ kind: string; id: string }>;
  preferenceSource?: "rule" | "user-override";
  userOverrideScopeKey?: string;
  suggestionSuppressed?: boolean;
  suggestionCooldownUntil?: string;
  suggestionCooldownScopeKey?: string;
};

export type ProactivityResolverInput = {
  activityFamily: ProactivityActivityFamily;
  agentId?: string | null;
  routeContext?: string | null;
  riskBand?: ProactivityRiskBand;
  statusSignal?: "normal" | "blocked" | "stalled" | "degraded" | "offline" | null;
  deadlineWindowDays?: number | null;
  regulated?: boolean;
  archetype?: {
    archetypeId?: string | null;
    archetypeCategory?: string | null;
    demandSignature?: string | null;
    capacityUnit?: string | null;
    fieldDispatchRunningLate?: boolean;
    loadBearingStageKeys?: string[];
    trustGates?: string[];
  } | null;
};

export function isProactivityLevel(value: unknown): value is ProactivityLevel {
  return typeof value === "string" && (PROACTIVITY_LEVELS as readonly string[]).includes(value);
}
