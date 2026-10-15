// The scheduler's deterministic task kinds: each runs its executor directly,
// off the LLM path. Extracted from agent-task-scheduler.ts (a baselined
// oversized module) when the acceptance sweep joined (BI-DF255666), so the
// dispatcher stays a thin discriminator and the branches are tested alone.
//
// Acceptance claims its own fenced lease before cadence changes. Other task
// kinds reach this function after the generic cadence claim (BI-D1CD3A11).

import {
  ACCEPTANCE_SWEEP_TASK_KIND,
  BOOKKEEPING_CYCLE_TASK_KIND,
  CLIENT_CAPABILITY_REVERIFY_TASK_KIND,
  DECISION_ENGINE_REVIEW_TASK_KIND,
  DEMAND_SCORING_STEWARD_TASK_KIND,
} from "@/lib/operate/scheduled-jobs/agent-task-kind";
import { executeBookkeepingCycleTask } from "@/lib/finance/bookkeeping/bookkeeping-cycle-task";

export type DeterministicScheduledTask = {
  taskId: string;
  taskKind: string | null;
  schedule: string;
  ownerUserId: string;
  agentId: string;
  /** Per-kind config or run state; the scheduler passes the whole task row. */
  taskConfig?: unknown;
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
  // BI-00C68162: the daily demand-scoring steward.
  if (task.taskKind === DEMAND_SCORING_STEWARD_TASK_KIND) {
    const { executeDemandScoringStewardTask } = await import("@/lib/demand/scoring-steward-task");
    await executeDemandScoringStewardTask(task);
    return true;
  }
  // BI-64795FD0: the weekly client-capability re-verification.
  if (task.taskKind === CLIENT_CAPABILITY_REVERIFY_TASK_KIND) {
    const { executeClientCapabilityReverifyTask } = await import("@/lib/agent-toolchain/client-capability-reverify-task");
    await executeClientCapabilityReverifyTask(task);
    return true;
  }
  return false;
}
