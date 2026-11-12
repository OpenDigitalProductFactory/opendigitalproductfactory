import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import { buildPipelineConcurrency } from "../admission";
import {
  AGENT_TASK_DISPATCH_BATCH,
  loadAgentConcurrencyLimits,
  planDispatchLanes,
  providerSlotsFromCapacity,
  type DueAgentTask,
} from "../agent-task-dispatch-lanes";

/**
 * Polls ScheduledAgentTask every 5 minutes and dispatches up to 20 due tasks in
 * concurrent lanes (BI-6DBA2238; see ../agent-task-dispatch-lanes.ts). Each task
 * gets its own durable step, re-checks quiescence before it starts, and records
 * a failure in its own result so one task never aborts the batch.
 */
export const agentTaskDispatch = jobs.createFunction(
  {
    id: "agent/task-dispatch",
    retries: 1,
    concurrency: buildPipelineConcurrency({ limit: 1, scope: "fn" }),
    triggers: [cron("*/5 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "agent/task-dispatch");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    await step.run("reconcile-retained-foreground-work", async () => {
      try {
        const { reconcileForegroundWork } = await import("@/lib/agent/foreground-work-worker");
        return await reconcileForegroundWork();
      } catch (error) {
        console.warn("[agent-task-dispatch] foreground wake reconciliation unavailable", error);
        return { outcome: "unavailable" };
      }
    });

    await step.run("reconcile-acceptance-upgrade-wakeup", async () => {
      try {
        const { reconcileAcceptanceUpgradeWakeupFromStore } = await import(
          "@/lib/backlog/acceptance-sweep/acceptance-upgrade-wakeup"
        );
        return await reconcileAcceptanceUpgradeWakeupFromStore();
      } catch (error) {
        console.warn("[agent-task-dispatch] acceptance wakeup reconciliation unavailable", error);
        return { outcome: "unavailable" };
      }
    });

    // BI-31C1FDEC: re-send room wakes an outage left undecided (the outbox half
    // of the addressed-message wake). Idempotent per message; the room store
    // stays the record either way.
    await step.run("republish-pending-room-wakes", async () => {
      try {
        const { sweepPendingRoomWakes } = await import("@/lib/work-management/room-message-wake.server");
        return await sweepPendingRoomWakes();
      } catch (error) {
        console.warn("[agent-task-dispatch] room wake sweep unavailable", error);
        return { outcome: "unavailable" };
      }
    });

    // Once an hour (on the top-of-hour :00 tick of this */5 poll), converge every
    // coworker self-task with its owner's Proactivity toggle so the two can't
    // silently desync — create tasks for coworkers turned up before they were
    // registered, stand down quiet ones, and restore a toggle from an orphaned
    // task (BI-E962B9CD). Cheap, non-destructive DB reconcile; isolated in its
    // own step so a hiccup never blocks dispatch.
    await step.run("reconcile-coworker-self-tasks-hourly", async () => {
      const now = new Date();
      if (now.getUTCMinutes() >= 5) return { skipped: true };
      const { reconcileAllCoworkerSelfTasks } = await import(
        "@/lib/operate/scheduled-jobs/coworker-self-task-sweep"
      );
      return reconcileAllCoworkerSelfTasks();
    });

    // Plan the batch as concurrent lanes (BI-6DBA2238): at most the provider
    // slots the capacity signal reports free run at once, and no coworker runs
    // more tasks at once than its concurrency limit. One checkpointed step, so a
    // replay reuses the same lanes and step ids.
    const plan = await step.run("plan-dispatch-lanes", async () => {
      const { prisma } = await import("@dpf/db");
      const { getAllCliPoolStatuses } = await import("@/lib/routing/cli-pool-status");
      const { cliConcurrencyStats } = await import("@/lib/routing/cli-concurrency");
      const now = new Date();

      const due: DueAgentTask[] = await prisma.scheduledAgentTask.findMany({
        where: { isActive: true, nextRunAt: { lte: now } },
        select: { taskId: true, agentId: true },
        orderBy: { nextRunAt: "asc" },
        take: AGENT_TASK_DISPATCH_BATCH,
      });
      if (due.length === 0) return { lanes: [] as string[][], providerSlots: 0 };

      const providerSlots = providerSlotsFromCapacity({
        pools: await getAllCliPoolStatuses(),
        cli: cliConcurrencyStats(),
        now,
      });
      const limits = await loadAgentConcurrencyLimits(prisma, due.map((t) => t.agentId));
      const lanes = planDispatchLanes(due, { providerSlots, agentLimit: (id) => limits[id] ?? 1 });
      return { lanes, providerSlots };
    });

    if (plan.lanes.length === 0) return { dispatched: 0 };

    // Load the executor once, before the lanes fan out, so concurrent lanes
    // share one module instance rather than racing its first import.
    const run: TaskRunner = {
      ...(await import("@/lib/self-upgrade/quiescence")),
      ...(await import("@/lib/actions/agent-task-scheduler")),
    };

    // Lanes run concurrently; each lane runs its tasks in order. Every task
    // re-checks quiescence as it starts, so a drain that begins mid-batch stops
    // new starts (QR-2026-10-14-sw894lro), and a task's failure is recorded in
    // its own step result instead of aborting the batch.
    const outcomes = (
      await Promise.all(
        plan.lanes.map(async (lane) => {
          const laneOutcomes: DispatchOutcome[] = [];
          for (const taskId of lane) {
            const outcome = (await step.run(`dispatch-${taskId}`, () => dispatchOne(run, taskId))) as DispatchOutcome;
            laneOutcomes.push(outcome);
            if (outcome.status === "quiesced") break;
          }
          return laneOutcomes;
        }),
      )
    ).flat();

    const planned = plan.lanes.flat().length;
    const dispatched = outcomes.filter((o) => o.status === "ran").length;
    const failed = outcomes.filter((o) => o.status === "failed").length;
    const quiesced = outcomes.find((o) => o.status === "quiesced");
    return {
      dispatched,
      failed,
      lanes: plan.lanes.length,
      providerSlots: plan.providerSlots,
      ...(quiesced ? { quiesced: quiesced.level, notStarted: planned - dispatched - failed } : {}),
    };
  },
);

/**
 * BI-31C1FDEC: run one due task now instead of at the next five-minute tick. A room
 * wake schedules a coworker's reply task and asks for it here, so the reply
 * starts within seconds through the same quiescence check and executor as the
 * batch. A drain leaves the task due for the cron.
 */
export const agentTaskRunNow = jobs.createFunction(
  {
    id: "agent/task-run-now",
    retries: 0,
    concurrency: [{ limit: 1, key: "event.data.taskId" }],
    triggers: [{ event: "agent/task.run-now" }],
  },
  async ({ event, step }) => {
    const taskId = String(event.data.taskId ?? "");
    if (!taskId) return { status: "skipped", reason: "no task id" };
    return step.run(`dispatch-${taskId}`, async () => {
      const run: TaskRunner = {
        ...(await import("@/lib/self-upgrade/quiescence")),
        ...(await import("@/lib/actions/agent-task-scheduler")),
      };
      return dispatchOne(run, taskId);
    });
  },
);

type DispatchOutcome =
  | { status: "ran"; taskId: string }
  | { status: "failed"; taskId: string; error: string }
  | { status: "quiesced"; taskId: string; level: string };

type TaskRunner = {
  getQuiescenceLevel: () => Promise<string>;
  executeScheduledAgentTask: (taskId: string) => Promise<void>;
};

async function dispatchOne(run: TaskRunner, taskId: string): Promise<DispatchOutcome> {
  const level = await run.getQuiescenceLevel();
  if (level !== "normal") return { status: "quiesced", taskId, level };
  try {
    await run.executeScheduledAgentTask(taskId);
    return { status: "ran", taskId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[agent-task-dispatch] task failed; the rest of the batch continues", { taskId }, error);
    return { status: "failed", taskId, error: message };
  }
}
