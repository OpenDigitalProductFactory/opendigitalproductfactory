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
import { shouldOfferToCoworker } from "./volunteering";

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
