import { jobs } from "@/lib/jobs";
import type { RoomWakeRequestedEvent } from "@/lib/work-management/room-message-wake.server";
import { gateAtEntry } from "../quiescence-gates";

// BI-31C1FDEC (agent dialog broker B2): an addressed room message wakes its
// in-platform recipient within seconds. The dispatcher decides per room
// (external executor, hop limit, hourly budget) and requests one wake per
// recipient; wakes for one recipient in one room share an event id inside a
// 15-second window, so a burst of messages coalesces into one reply run.
// Pending wakes left by an outage are re-sent from agent/task-dispatch.

export const roomMessageDispatch = jobs.createFunction(
  {
    id: "room/message-dispatch",
    retries: 2,
    triggers: [{ event: "room/message.posted" }],
  },
  async ({ event, step }) => {
    // A drain skips here; the message stays pending or sent, and the sweep re-sends it.
    const gate = await gateAtEntry(step, "room/message-dispatch");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("dispatch-room-message", async () => {
      const { dispatchRoomMessage } = await import("@/lib/work-management/room-message-wake.server");
      return dispatchRoomMessage(event.data.messageId);
    });
  },
);

export const roomWakeRun = jobs.createFunction(
  {
    id: "room/wake-run",
    retries: 1,
    // One reply run at a time per coworker per room.
    concurrency: [{ limit: 1, key: "event.data.laneKey" }],
    triggers: [{ event: "room/wake.requested" }],
  },
  async ({ event, step }) => {
    // Let the 15-second window close, so every message in it is in the room when the coworker reads.
    await step.sleepUntil("await-window-close", new Date(event.data.closesAt));
    // No entry gate: the run schedules the reply task first and checks quiescence
    // itself, so a drain leaves the task due for the dispatch cron instead of dropping it.
    return step.run("run-room-wake", async () => {
      const [{ runRoomWake }, { executeScheduledAgentTask }, { getQuiescenceLevel }] = await Promise.all([
        import("@/lib/work-management/room-message-wake.server"),
        import("@/lib/actions/agent-task-scheduler"),
        import("@/lib/self-upgrade/quiescence"),
      ]);
      return runRoomWake(event.data as RoomWakeRequestedEvent, {
        execute: executeScheduledAgentTask,
        quiescenceLevel: () => getQuiescenceLevel(),
      });
    });
  },
);
