import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const governedBacklogTeeUpScheduled = inngest.createFunction(
  {
    id: "build/governed-backlog-tee-up-scheduled",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("0 14 * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("tee-up-governed-backlog-daily", async () => {
      const { prisma } = await import("@dpf/db");
      const { runGovernedBacklogTeeUp } = await import("@/lib/governed-backlog-tee-up");
      const { resolveScheduledOwnerUserId } = await import("../scheduled-owner");

      return runGovernedBacklogTeeUp({
        prisma,
        userId: await resolveScheduledOwnerUserId(),
        trigger: "daily",
      });
    });
  },
);

export const governedBacklogTeeUpRequested = inngest.createFunction(
  {
    id: "build/governed-backlog-tee-up-requested",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: "build/backlog-tee-up.requested" }],
  },
  async ({ event, step }) => {
    return step.run("tee-up-governed-backlog-manual", async () => {
      const { prisma } = await import("@dpf/db");
      const { runGovernedBacklogTeeUp } = await import("@/lib/governed-backlog-tee-up");

      return runGovernedBacklogTeeUp({
        prisma,
        userId: event.data.userId,
        trigger: "manual",
        limit: event.data.limit ?? undefined,
      });
    });
  },
);
