import { cron, jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

// BI-95638941: a provider-held Workroom releases itself. Every 5 minutes, holds
// past their releaseAt are released through resumeWorkroomQueue, so the held
// stage runs again; a room that fails again is re-held with a longer backoff.
// Replay-safe: releasing an already-released room is a no-op.
export const WORKROOM_QUEUE_HOLD_RELEASE_ID = "workroom/queue-hold-release";

export const workroomQueueHoldRelease = jobs.createFunction(
  { id: WORKROOM_QUEUE_HOLD_RELEASE_ID, retries: 1, triggers: [cron("3,8,13,18,23,28,33,38,43,48,53,58 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, WORKROOM_QUEUE_HOLD_RELEASE_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("release-due-holds", async () => {
      const { releaseDueWorkroomQueueHolds } = await import("@/lib/work-capsules/workroom-queue-hold");
      const released = await releaseDueWorkroomQueueHolds();
      return { released: released.length, rooms: released };
    });
  },
);
