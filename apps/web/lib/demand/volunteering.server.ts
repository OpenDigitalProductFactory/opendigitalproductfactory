// Server-side AI-led volunteering — the funded-bet → coworker-pickup seam.
// EP-DELIVERY-FLOW BI-A6648529. Kept separate from the pure volunteering.ts so
// the pure decision helpers stay importable (and unit-testable) without pulling
// in the Prisma client.
//
// Kernel decision (high confidence, composite 7.60): ship the ASK-FIRST path
// first — funding a bet raises a coworker-pickup offer that a human approves,
// rather than auto-claiming. The autonomous auto-claim path is deferred until the
// coworker execution-trust source-of-truth is decided (see the plan's blocker
// section). So this records an OFFER on the item; it never advances status on its
// own.

import { prisma } from "@dpf/db";
import { resolveVolunteeringAutonomy, shouldOfferToCoworker, type VolunteeringDecision } from "./volunteering";
import { fundedItemRiskClass } from "./funding-risk";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "@/lib/autonomy/trust-graduation";

/** The activityType under which a coworker's funded-bet-pickup trust is measured. */
const PICKUP_ACTIVITY_TYPE = "demand_bet_pickup";

/** Coerce a stored string to an AutonomyLevel, defaulting to the floor (shadow). */
function asAutonomyLevel(value: string | null | undefined): AutonomyLevel {
  return value && (AUTONOMY_LEVELS as readonly string[]).includes(value)
    ? (value as AutonomyLevel)
    : "shadow";
}

export type FundedItemOfferResult = {
  offered: boolean;
  agentId: string | null;
};

/**
 * On a funded transition (demandStage → ready), offer the item to its associated
 * coworker as a needs-you pickup gate: mark it `offered` and attribute the
 * offering coworker, and record a timeline activity. Idempotent (see
 * {@link shouldOfferToCoworker}) and non-authoritative on status — a human still
 * approves the pickup. Callers should treat this as best-effort (non-fatal): a
 * funding decision must succeed even if the offer cannot be recorded.
 */
export async function offerFundedItemToCoworker(item: {
  id: string;
  itemId: string;
  agentId: string | null;
  claimStatus: string | null;
}): Promise<FundedItemOfferResult> {
  if (!shouldOfferToCoworker(item)) {
    return { offered: false, agentId: item.agentId };
  }
  const agentId = item.agentId as string;
  await prisma.$transaction([
    prisma.backlogItem.update({
      where: { id: item.id },
      data: { claimStatus: "offered", claimedByAgentId: agentId, claimedAt: new Date() },
    }),
    prisma.backlogItemActivity.create({
      data: {
        backlogItemId: item.id,
        kind: "coworker_offered",
        summary: `Coworker ${agentId} volunteered to build this funded item — awaiting your go-ahead.`,
      },
    }),
  ]);
  return { offered: true, agentId };
}

export type VolunteeringAutonomyShadowResult = {
  recorded: boolean;
  /** What auto-claim WOULD have decided given the coworker's resolved autonomy. */
  wouldHave: VolunteeringDecision | null;
  decisionMode: string | null;
  effectiveTrustLevel: string | null;
};

/**
 * Shadow-measure what an autonomous auto-claim WOULD do for this funded bet, and
 * record it — without acting on it. Kernel decision (shadow_first, high conf,
 * composite 9.10): the TrustState tables measure trust but do not yet authorize
 * runtime autonomy, so this resolves the coworker's auto-claim authority
 * (TrustState.currentLevel → risk/regulatory ceiling → decisionMode) and writes a
 * DecisionShadowLedger row comparing the WOULD-BE decision against what actually
 * happened (the ask-first offer). This builds the graduation evidence that a
 * later, operator-gated step would need before real auto-claim is enabled — the
 * measure-before-authorize path. Non-authoritative: never claims or advances
 * status. Best-effort (callers treat as non-fatal).
 */
export async function recordVolunteeringAutonomyShadow(item: {
  id: string;
  itemId: string;
  agentId: string | null;
  investmentBucket: string | null;
  effortSize: string | null;
  claimStatus: string | null;
}): Promise<VolunteeringAutonomyShadowResult> {
  const empty: VolunteeringAutonomyShadowResult = {
    recorded: false,
    wouldHave: null,
    decisionMode: null,
    effectiveTrustLevel: null,
  };
  if (!item.agentId) return empty;

  const riskClass = fundedItemRiskClass(item.investmentBucket, item.effortSize);
  const trust = await prisma.trustState.findUnique({
    where: {
      agentId_activityType_riskClass: {
        agentId: item.agentId,
        activityType: PICKUP_ACTIVITY_TYPE,
        riskClass,
      },
    },
    select: { currentLevel: true, regulatoryCeiling: true },
  });
  const autonomy = resolveVolunteeringAutonomy({
    trustLevel: asAutonomyLevel(trust?.currentLevel),
    risk: riskClass,
    regulatoryCeiling: trust?.regulatoryCeiling ? asAutonomyLevel(trust.regulatoryCeiling) : null,
  });

  // The act stays ask-first (shadow-first): record the WOULD-BE decision against
  // what actually happens so the two can be reconciled into graduation evidence.
  const actual: VolunteeringDecision = shouldOfferToCoworker(item) ? "ask_first" : "observe";
  const ledgerId = `demand-pickup:${item.itemId}:${Date.now()}`;
  await prisma.decisionShadowLedger.create({
    data: {
      ledgerId,
      agentId: item.agentId,
      activityType: PICKUP_ACTIVITY_TYPE,
      riskClass,
      autonomyLevel: autonomy.effectiveTrustLevel,
      proposedDecision: { volunteering: autonomy.decision, decisionMode: autonomy.decisionMode },
      actualDecision: { volunteering: actual, offered: actual === "ask_first" },
      agreement: autonomy.decision === actual,
      sourceKind: "demand-bet-pickup",
      metadata: {
        itemId: item.itemId,
        risk: riskClass,
        effectiveTrustLevel: autonomy.effectiveTrustLevel,
        runtimeConsumer: "delivery-flow-volunteering",
      },
    },
  });
  return {
    recorded: true,
    wouldHave: autonomy.decision,
    decisionMode: autonomy.decisionMode,
    effectiveTrustLevel: autonomy.effectiveTrustLevel,
  };
}
