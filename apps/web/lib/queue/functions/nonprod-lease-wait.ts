import { prisma } from "@dpf/db";
import { cron } from "inngest";

import {
  applyNonprodCapacityEvent,
  publishNonprodCapacityForHead,
  type NonprodCapacityEvent,
} from "@/lib/nonprod/durable-wait";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

const RECONCILE_CRON = "3,8,13,18,23,28,33,38,43,48,53,58 * * * *";

export async function reconcileNonprodLeaseWaits(input: {
  now?: Date;
  publish?: typeof publishNonprodCapacityForHead;
}) {
  const now = input.now ?? new Date();
  const environments = await prisma.nonProductionEnvironmentLease.findMany({
    where: { status: "queued" },
    distinct: ["environmentKey"],
    select: { environmentKey: true },
    take: 20,
  });
  const publish = input.publish ?? publishNonprodCapacityForHead;
  let notified = 0;
  for (const environment of environments) {
    const result = await publish({
      db: prisma as never,
      environmentKey: environment.environmentKey,
      causeLeaseId: `reconcile-${Math.floor(now.getTime() / 300_000)}`,
      now,
    });
    notified += result.notified;
  }
  return { environments: environments.length, notified };
}

export const nonprodCapacityAvailable = inngest.createFunction(
  {
    id: "nonprod/capacity-available",
    retries: 2,
    concurrency: { limit: 1, key: "event.data.environmentKey" },
    triggers: [{ event: "nonprod/capacity.available" }],
  },
  async ({ event, step }) => step.run("checkpoint-capacity-event", () =>
    applyNonprodCapacityEvent({
      db: prisma as never,
      event: event.data as NonprodCapacityEvent,
    })),
);

export const nonprodLeaseWaitReconciliation = inngest.createFunction(
  {
    id: "nonprod/lease-wait-reconciliation",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(RECONCILE_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("reconcile-durable-nonprod-waits", () => reconcileNonprodLeaseWaits({}));
  },
);
