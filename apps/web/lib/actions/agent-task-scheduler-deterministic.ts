// The scheduler's deterministic task kinds: each runs its executor directly,
// off the LLM path. Extracted from agent-task-scheduler.ts (a baselined
// oversized module) when the acceptance sweep joined (BI-DF255666), so the
// dispatcher stays a thin discriminator and the branches are tested alone.
//
// Runs after the scheduler's guarded claim (BI-D1CD3A11), which is what makes
// each of these single-flight: only the dispatcher that advanced nextRunAt
// reaches this function for a given due tick.

import {
  ACCEPTANCE_SWEEP_TASK_KIND,
  BOOKKEEPING_CYCLE_TASK_KIND,
  DECISION_ENGINE_REVIEW_TASK_KIND,
} from "@/lib/operate/scheduled-jobs/agent-task-kind";
import { executeBookkeepingCycleTask } from "@/lib/finance/bookkeeping/bookkeeping-cycle-task";

export type DeterministicScheduledTask = {
  taskId: string;
  taskKind: string | null;
  schedule: string;
  ownerUserId: string;
  agentId: string;
};

/** Runs the task when its kind is deterministic. False means the scheduler handles it. */
export async function runDeterministicScheduledTaskKind(task: DeterministicScheduledTask): Promise<boolean> {
  // S-TRIG (BI-DC738330): the weekly books cadence.
  if (task.taskKind === BOOKKEEPING_CYCLE_TASK_KIND) {
    await executeBookkeepingCycleTask(task);
    return true;
  }
  // BI-19CEC4B4: the weekly decision-engine self-review.
  if (task.taskKind === DECISION_ENGINE_REVIEW_TASK_KIND) {
    const { executeDecisionEngineReviewTask } = await import("@/lib/decision/self-review/decision-engine-review-task");
    await executeDecisionEngineReviewTask(task);
    return true;
  }
  // BI-DF255666: the daily acceptance sweep.
  if (task.taskKind === ACCEPTANCE_SWEEP_TASK_KIND) {
    const { executeAcceptanceSweepTask } = await import("@/lib/backlog/acceptance-sweep/acceptance-sweep-task");
    await executeAcceptanceSweepTask(task);
    return true;
  }
  return false;
}
