import { prisma } from "@dpf/db";

import {
  createAutonomousWorkRun,
  type AutonomousWorkRunRef,
} from "@/lib/tak/autonomous-work-run";
import {
  selectBacklogReviewCapacityWorkInputs,
  type BacklogReviewCapacityWorkInputOptions,
  type BacklogReviewCapacityWorkInputResult,
} from "./backlog-selector";

export type BacklogReviewCapacityRunResult = {
  started: AutonomousWorkRunRef[];
  rejections: BacklogReviewCapacityWorkInputResult["rejections"];
  recordedRejectionCount: number;
};

export async function runBacklogReviewCapacityContinuity(
  options: BacklogReviewCapacityWorkInputOptions,
): Promise<BacklogReviewCapacityRunResult> {
  const selection = await selectBacklogReviewCapacityWorkInputs(options);
  const started: AutonomousWorkRunRef[] = [];

  for (const input of selection.inputs) {
    started.push(await createAutonomousWorkRun(input));
  }

  let recordedRejectionCount = 0;
  for (const rejection of selection.rejections) {
    const recorded = await recordCapacityRejection({
      rejection,
      agentId: options.agentId,
      ownerPrincipalId: options.ownerPrincipalId,
    });
    if (recorded) {
      recordedRejectionCount += 1;
    }
  }

  return {
    started,
    rejections: selection.rejections,
    recordedRejectionCount,
  };
}

async function recordCapacityRejection(input: {
  rejection: BacklogReviewCapacityWorkInputResult["rejections"][number];
  agentId: string;
  ownerPrincipalId: string;
}) {
  if (input.rejection.sourceRef.kind !== "backlog-item") {
    return false;
  }

  const backlogItem = await prisma.backlogItem.findUnique({
    where: { itemId: input.rejection.sourceRef.id },
    select: { id: true },
  });

  if (!backlogItem) {
    return false;
  }

  await prisma.backlogItemActivity.create({
    data: {
      backlogItemId: backlogItem.id,
      kind: "capacity_continuity_rejected",
      summary: `Capacity continuity rejected ${input.rejection.candidateId}: ${input.rejection.rejection.reason}`,
      recordedByAgentId: input.agentId,
      payload: {
        candidateId: input.rejection.candidateId,
        ownerPrincipalId: input.ownerPrincipalId,
        rejection: input.rejection.rejection,
        sourceRef: input.rejection.sourceRef,
      },
    },
  });

  return true;
}
