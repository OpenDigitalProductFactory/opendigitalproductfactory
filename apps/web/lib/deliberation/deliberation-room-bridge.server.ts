/**
 * Server bridge: seal a completed deliberation onto a finite Work Room
 * (EP-DELIBERATION-ROOMS, BI-F8C5444A). Materializes the adjudicator TaskNode as a
 * `task-node` room (idempotent) and persists the verdict as a durable
 * work-room-outcome-packet message. Called NON-FATALLY from the deliberation
 * runner after synthesis — the deliberation stands even if room-sealing fails.
 * See deliberation-room.ts for the pure core.
 */
import { prisma } from "@dpf/db";

import { bridgeTaskNodeToWorkItem } from "@/lib/queue/bridges/task-node-bridge";
import { WORKROOM_OUTCOME_MESSAGE_TYPE } from "@/lib/work-management/room-cycle-adapter";
import { buildDeliberationOutcomeSeal, verdictNeedsEscalation } from "./deliberation-room";

/** Accountable ref for a machine-sealed deliberation verdict (a system record; a human reviews the room). */
const DELIBERATION_ACCOUNTABLE_REF = "system:deliberation";

export interface SealDeliberationOnRoomResult {
  workItemId: string;
  outcomeState: string;
  needsEscalation: boolean;
}

/**
 * Seal a completed deliberation's verdict onto its room. Returns null when there
 * is nothing to seal (no synthesized outcome, or no adjudicator node).
 */
export async function sealDeliberationOnRoom(input: {
  deliberationRunId: string;
  adjudicatorTaskNodeId: string;
  consensusState: string;
  completedAt?: Date;
}): Promise<SealDeliberationOnRoomResult | null> {
  const outcome = await prisma.deliberationOutcome.findUnique({
    where: { deliberationRunId: input.deliberationRunId },
    select: { id: true, mergedRecommendation: true },
  });
  if (!outcome) return null;

  // Materialize (idempotently) the adjudicator TaskNode as a finite task-node room.
  const itemId = await bridgeTaskNodeToWorkItem(input.adjudicatorTaskNodeId);
  const workItem = await prisma.workItem.findUnique({ where: { itemId }, select: { id: true } });
  if (!workItem) return null;

  // Idempotent: don't re-seal a room that already carries an outcome packet.
  const existing = await prisma.workItemMessage.findFirst({
    where: { workItemId: workItem.id, messageType: WORKROOM_OUTCOME_MESSAGE_TYPE },
    select: { messageId: true },
  });

  const { packet, storedPayload } = buildDeliberationOutcomeSeal({
    deliberationRunId: input.deliberationRunId,
    adjudicatorTaskNodeId: input.adjudicatorTaskNodeId,
    deliberationOutcomeId: outcome.id,
    consensusState: input.consensusState,
    mergedRecommendation: outcome.mergedRecommendation,
    accountablePrincipalRef: DELIBERATION_ACCOUNTABLE_REF,
    completedAt: input.completedAt ?? new Date(),
  });

  if (!existing) {
    await prisma.workItemMessage.create({
      data: {
        workItemId: workItem.id,
        senderType: "system",
        messageType: WORKROOM_OUTCOME_MESSAGE_TYPE,
        body: packet.summary,
        structuredPayload: storedPayload as never,
        channel: "in-app",
      },
    });
  }

  return {
    workItemId: workItem.id,
    outcomeState: packet.outcomeState,
    needsEscalation: verdictNeedsEscalation(input.consensusState),
  };
}
