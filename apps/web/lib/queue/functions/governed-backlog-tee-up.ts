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
    const gate = await gateAtEntry(step, "build/governed-backlog-tee-up-scheduled");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("tee-up-governed-backlog-daily", async () => {
      const { prisma } = await import("@dpf/db");
      const { runGovernedBacklogTeeUp } = await import("@/lib/governed-backlog-tee-up");
      const { dispatchApprovedIdeateBuilds } = await import("@/lib/build/ideate-on-approval");
      const { resolveScheduledOwnerUserId } = await import("../scheduled-owner");

      const userId = await resolveScheduledOwnerUserId();
      const teeUp = await runGovernedBacklogTeeUp({ prisma, userId, trigger: "daily" });
      // BI-3E0EE3BA: complete the autopilot path. The tee-up auto-approves an
      // eligible draft but never fired its Ideate research (the only caller was
      // the operator's Approve-Start click), leaving auto-promoted builds
      // dead-on-arrival in `ideate`. Fire Ideate for the drafts this run promoted
      // AND recover any older approved-but-undriven drafts in one pass.
      const ideateDispatch = await dispatchApprovedIdeateBuilds({ userId });
      return { ...teeUp, ideateDispatch };
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
      const { dispatchApprovedIdeateBuilds } = await import("@/lib/build/ideate-on-approval");

      const userId = event.data.userId;
      const teeUp = await runGovernedBacklogTeeUp({
        prisma,
        userId,
        trigger: "manual",
        limit: event.data.limit ?? undefined,
      });
      // BI-3E0EE3BA: fire Ideate for approved drafts this run promoted + recover
      // older approved-but-undriven drafts (see the scheduled fn for the why).
      const ideateDispatch = await dispatchApprovedIdeateBuilds({ userId });
      return { ...teeUp, ideateDispatch };
    });
  },
);
