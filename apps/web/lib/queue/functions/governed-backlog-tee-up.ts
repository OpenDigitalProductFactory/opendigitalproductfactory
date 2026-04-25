import { cron } from "inngest";
import { inngest } from "../inngest-client";

async function resolveScheduledUserId(): Promise<string> {
  const { prisma } = await import("@dpf/db");
  const user = await prisma.user.findFirst({
    where: {
      isSuperuser: true,
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!user) {
    throw new Error("No active superuser is available to own governed backlog drafts.");
  }

  return user.id;
}

export const governedBacklogTeeUpScheduled = inngest.createFunction(
  {
    id: "build/governed-backlog-tee-up-scheduled",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("0 14 * * *")],
  },
  async ({ step }) => {
    return step.run("tee-up-governed-backlog-daily", async () => {
      const { prisma } = await import("@dpf/db");
      const { runGovernedBacklogTeeUp } = await import("@/lib/governed-backlog-tee-up");

      return runGovernedBacklogTeeUp({
        prisma,
        userId: await resolveScheduledUserId(),
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
