import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import type { AttentionItem, AttentionSource } from "./types";

export type OwnerAttentionLane = "needs-you-now" | "weekly-digest" | "custodian";

export type OwnerAttentionLaneDecision = {
  lane: OwnerAttentionLane;
  reason: string;
  hardFloor: boolean;
  appliedLevel: ProactivityLevel;
};

const TECHNICAL_SOURCES = new Set<AttentionSource>([
  "escalation",
  "ai-readiness-blocker",
  "platform-health",
  "provider-credential",
  "scheduled-task",
]);

const MONEY_SOURCES = new Set<AttentionSource>(["approval-bill", "approval-expense"]);
const PUBLIC_SOURCES = new Set<AttentionSource>([
  "approval-outbound",
  "compliance-submission",
]);

export function classifyOwnerAttentionLane(
  item: AttentionItem,
  fallbackLevel: ProactivityLevel = "balanced",
): OwnerAttentionLaneDecision {
  const appliedLevel = item.proactivity?.level ?? fallbackLevel;
  if (MONEY_SOURCES.has(item.source)) {
    return decision("needs-you-now", "Money would leave the business.", true, appliedLevel);
  }
  if (PUBLIC_SOURCES.has(item.source)) {
    return decision("needs-you-now", "The result would go public or to an outside body.", true, appliedLevel);
  }
  if (item.source === "paused-ai" && item.triage.residueReason === "needs-credential") {
    return decision("custodian", "A credential is technical access work, not owner judgment.", false, appliedLevel);
  }
  if (TECHNICAL_SOURCES.has(item.source)) {
    return decision("custodian", "The technical custodian owns platform recovery.", false, appliedLevel);
  }
  if (item.source === "research-proposal") {
    return appliedLevel === "quiet"
      ? decision("needs-you-now", "Reactive mode asks before low-risk research.", false, appliedLevel)
      : decision("weekly-digest", "Low-urgency research can be reviewed together.", false, appliedLevel);
  }
  if (item.source === "coworker-memory") {
    return decision("weekly-digest", "New coworker learning is visible in the digest.", false, appliedLevel);
  }
  if (item.source === "ai-decision" || item.triage.decideEffort === "judgment") {
    return decision("needs-you-now", "A real human judgment is still required.", false, appliedLevel);
  }
  if (item.source === "agent-proposal" || item.source === "paused-ai") {
    return decision("needs-you-now", "A coworker is waiting for a bounded human choice.", false, appliedLevel);
  }
  if (appliedLevel === "assertive") {
    return decision("weekly-digest", "Assertive mode batches this reversible review.", false, appliedLevel);
  }
  return decision("needs-you-now", "This is an owner-level business choice.", false, appliedLevel);
}

function decision(
  lane: OwnerAttentionLane,
  reason: string,
  hardFloor: boolean,
  appliedLevel: ProactivityLevel,
): OwnerAttentionLaneDecision {
  return { lane, reason, hardFloor, appliedLevel };
}
