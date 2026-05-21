import { randomUUID } from "node:crypto";

import { Prisma, prisma } from "@dpf/db";

import type { SelfUpgradeConfig } from "./config";
import type { UpgradeVersionState } from "./version";
import type { PromoterStartResult } from "./promoter";

export function generateSelfUpgradeRunId(): string {
  return `SUR-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export async function createSelfUpgradeRun(input: {
  trigger: "manual" | "scheduled";
  config: Partial<SelfUpgradeConfig> | Record<string, unknown>;
  versionState: UpgradeVersionState;
}): Promise<{ runId: string }> {
  const runId = generateSelfUpgradeRunId();
  await prisma.selfUpgradeRun.create({
    data: {
      runId,
      status: "queued",
      trigger: input.trigger,
      currentSha: input.versionState.currentSha,
      targetSha: input.versionState.targetSha,
      completionEvidence: {
        reason: input.versionState.reason,
        comparable: input.versionState.comparable,
        channel: (input.config as Record<string, unknown>).channel ?? null,
      } satisfies Prisma.InputJsonObject,
    },
  });
  return { runId };
}

export async function markSelfUpgradeRunSkipped(input: {
  trigger: "manual" | "scheduled";
  reason: string;
  versionState?: UpgradeVersionState;
}): Promise<void> {
  await prisma.selfUpgradeRun.create({
    data: {
      runId: generateSelfUpgradeRunId(),
      status: "skipped",
      trigger: input.trigger,
      reason: input.reason,
      currentSha: input.versionState?.currentSha ?? null,
      targetSha: input.versionState?.targetSha ?? null,
      completedAt: new Date(),
      completionEvidence: input.versionState
        ? ({
            reason: input.versionState.reason,
            comparable: input.versionState.comparable,
          } satisfies Prisma.InputJsonObject)
        : undefined,
    },
  });
}

export async function markSelfUpgradeRunStarted(input: {
  runId: string;
  promoter: PromoterStartResult;
}): Promise<void> {
  await prisma.selfUpgradeRun.update({
    where: { runId: input.runId },
    data: {
      status: "running",
      startedAt: new Date(),
      promoterContainerName: input.promoter.containerName,
    },
  });
}
