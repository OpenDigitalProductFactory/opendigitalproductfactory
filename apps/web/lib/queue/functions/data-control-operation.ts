import { randomUUID } from "node:crypto";

import { cron } from "inngest";

import { DATA_CONTROL_TARGET_ADAPTERS } from "@/lib/govern/data/control-operation-adapters";
import {
  createPrismaDataControlRecoveryStore,
  listRecoverableDataControlOperationIds,
} from "@/lib/govern/data/control-operation-repository";
import { reconcileDataControlOperation } from "@/lib/govern/data/control-operation-runner";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const DATA_CONTROL_OPERATION_RECOVERY_CRON =
  "4,9,14,19,24,29,34,39,44,49,54,59 * * * *";
export const DATA_CONTROL_OPERATION_RECOVERY_EVENT =
  "govern/data-control-operation.recover";

export async function runDataControlOperationRecovery(input: {
  workerId: string;
  limit: number;
  listIds?: (input: { now: Date; limit: number }) => Promise<string[]>;
  reconcile?: typeof reconcileDataControlOperation;
}) {
  const now = new Date();
  const ids = await (input.listIds ?? listRecoverableDataControlOperationIds)({
    now,
    limit: input.limit,
  });
  const counts = {
    inspected: ids.length,
    reconciled: 0,
    partial: 0,
    compensated: 0,
    blockedTargets: 0,
  };
  const store = createPrismaDataControlRecoveryStore();
  for (const operationId of ids) {
    const result = await (input.reconcile ?? reconcileDataControlOperation)({
      operationId,
      workerId: input.workerId,
      store,
      adapters: DATA_CONTROL_TARGET_ADAPTERS,
      now,
    });
    if (result.status === "reconciled") counts.reconciled += 1;
    if (result.status === "partially-complete") counts.partial += 1;
    if (result.status === "compensated") counts.compensated += 1;
    counts.blockedTargets += result.blockedTargets.length;
  }
  return counts;
}

export const dataControlOperationRecoveryScheduled = inngest.createFunction(
  {
    id: "govern/data-control-operation-recovery-scheduled",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(DATA_CONTROL_OPERATION_RECOVERY_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "govern/data-control-operation-recovery-scheduled");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("recover-data-control-operations", () =>
      runDataControlOperationRecovery({
        workerId: `inngest-${randomUUID()}`,
        limit: 50,
      }),
    );
  },
);

export const dataControlOperationRecoveryRequested = inngest.createFunction(
  {
    id: "govern/data-control-operation-recovery-requested",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: DATA_CONTROL_OPERATION_RECOVERY_EVENT }],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "govern/data-control-operation-recovery-requested");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("recover-data-control-operations-requested", () =>
      runDataControlOperationRecovery({
        workerId: `inngest-${randomUUID()}`,
        limit: 50,
      }),
    );
  },
);
