import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { namesNoConcreteConsequence } from "./types";
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
  if (item.source === "reservation-exception") {
    // A guest is waiting on a reservation decision — an owner-level, customer-facing
    // choice that is never batched into a digest (BI-3DA1DFDC).
    return decision("needs-you-now", "A guest is waiting on a reservation decision.", true, appliedLevel);
  }
  if (item.source === "storefront-inquiry") {
    // A customer is waiting on the owner's first reply — hard-floored like a
    // reservation so a waiting lead is never batched into a digest (BI-A36CF68D).
    return decision("needs-you-now", "A customer is waiting on a reply.", true, appliedLevel);
  }
  if (item.source === "coworker-envelope") {
    // A governed coworker is HELD until this employee decides, and the approval
    // window is minutes wide. Batching it into a digest guarantees it expires
    // unanswered, so it is hard-floored like a waiting guest (BI-7CB2CCDE).
    return decision(
      "needs-you-now",
      "A coworker cannot act until you decide, and the window closes soon.",
      true,
      appliedLevel,
    );
  }
  if (item.source === "paused-ai" && item.triage.residueReason === "needs-credential") {
    return decision("custodian", "A credential is technical access work, not owner judgment.", false, appliedLevel);
  }
  if (TECHNICAL_SOURCES.has(item.source)) {
    return decision("custodian", "The technical custodian owns platform recovery.", false, appliedLevel);
  }
  if (item.source === "research-proposal") {
    return appliedLevel === "quiet"
      ? decision("needs-you-now", "Quiet mode asks before low-risk research.", false, appliedLevel)
      : decision("weekly-digest", "Low-urgency research can be reviewed together.", false, appliedLevel);
  }
  if (item.source === "coworker-memory") {
    return decision("weekly-digest", "New coworker learning is visible in the digest.", false, appliedLevel);
  }
  if (item.source === "ai-decision") {
    // Generic corpus-fallback residue — the kernel simply had no applicable
    // principle (coverage-gap) and nothing concrete is blocked (no blastRadius).
    // These flood the primary count with near-identical cards, so group them into
    // the advanced/weekly review BEHIND concrete operational work rather than let
    // them outrank a guest reservation (BI-348766E5 fix 4).
    const isGenericCorpusFallback =
      item.triage.residueReason === "coverage-gap" && !item.triage.blastRadius;
    if (isGenericCorpusFallback) {
      return decision(
        "weekly-digest",
        "Grouped for advanced review — no customer or build outcome is blocked.",
        false,
        appliedLevel,
      );
    }
    return decision("needs-you-now", "This still needs your judgment.", false, appliedLevel);
  }
  // A source that cannot say what is actually blocked has not established that
  // this is the owner's decision. Running a rescue for a day found 34 of 40
  // cards in the owner's inbox were paused platform task runs — spec approvals
  // and research gates against backlog items — every one of them carrying the
  // placeholder "a coworker task" and the platform's own advice to keep it with
  // the specialist (BI-79E207B9). Nothing of the rescue's was waiting on any of
  // them. This runs after the hard floors above, so money, a waiting guest, a
  // waiting customer and a closing approval window still reach the owner.
  if (namesNoConcreteConsequence(item.triage.blastRadius)) {
    return decision(
      "custodian",
      "Nothing of yours is waiting on this — the specialist owns it.",
      false,
      appliedLevel,
    );
  }
  if (item.triage.decideEffort === "judgment") {
    return decision("needs-you-now", "This still needs your judgment.", false, appliedLevel);
  }
  if (item.source === "agent-proposal" || item.source === "paused-ai") {
    return decision("needs-you-now", "A coworker is waiting for a bounded choice from you.", false, appliedLevel);
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
