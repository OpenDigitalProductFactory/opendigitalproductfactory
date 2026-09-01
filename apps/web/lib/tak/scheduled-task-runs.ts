import {
  createAutonomousWorkRun,
  type AutonomousWorkRunRef,
} from "@/lib/tak/autonomous-work-run";
import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";
import type { ResolvedDelegatedPosture } from "@/lib/proactivity/delegated-posture";
import {
  classifyInferenceFailure,
  type InferenceFailureKind,
} from "@/lib/build/inference-failure";

export type ScheduledTaskRunRef = AutonomousWorkRunRef;

/**
 * A scheduled run whose loop executed zero tools and produced only a
 * provider-failure apology did no work: it must fail (and enter the
 * BI-754C9E82 retry cadence), not complete quietly with a healthy lastStatus.
 * Returns the failure kind for such a run, or null for a real result. Pure.
 * (BI-E0F27E0E)
 */
export function detectScheduledRunInferenceFailure(input: {
  executedToolCount: number;
  content: string | null | undefined;
}): InferenceFailureKind | null {
  if (input.executedToolCount > 0) return null;
  return classifyInferenceFailure(input.content);
}

/** Baseline reproduction: explicit governed mutations are not yet terminal requirements. */
export function detectScheduledRequiredToolFailure(_input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
  executedTools: Array<{ name: string; result?: { success?: boolean } }>;
}): string | null {
  return null;
}

export async function createTaskRunForScheduledTask(input: {
  taskId: string;
  ownerUserId: string;
  agentId: string;
  threadId: string;
  routeContext: string;
  title: string;
  prompt: string;
  proactivity?: ProactivityPlan;
  /** BI-754C9E82: auditable effective posture the scheduler delegates with. */
  delegatedPosture?: ResolvedDelegatedPosture;
}): Promise<ScheduledTaskRunRef> {
  return createAutonomousWorkRun({
    trigger: "scheduled",
    userId: input.ownerUserId,
    agentId: input.agentId,
    routeContext: input.routeContext,
    title: input.title,
    objective: input.prompt,
    prompt: input.prompt,
    threadId: input.threadId,
    sourceRef: {
      kind: "scheduled-task",
      id: input.taskId,
    },
    proactivity: input.proactivity,
    delegatedPosture: input.delegatedPosture,
  });
}
