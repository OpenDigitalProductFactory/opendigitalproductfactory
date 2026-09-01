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
export function detectScheduledRequiredToolFailure(input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
  executedTools: Array<{
    name: string;
    result?: { success?: boolean; data?: { proposalId?: string; status?: string } };
  }>;
}): string | null {
  const prompt = input.prompt.toLowerCase();
  for (const tool of input.authorizedTools) {
    if (!tool.sideEffect || !prompt.includes(tool.name.toLowerCase())) continue;
    const succeeded = input.executedTools.some(
      (execution) =>
        execution.name === tool.name &&
        execution.result?.success === true &&
        execution.result.data?.status !== "proposed",
    );
    if (!succeeded) return `required governed tool ${tool.name} executed zero times`;
  }
  return null;
}

export function detectScheduledRunFailure(input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
  executedTools: Array<{
    name: string;
    result?: { success?: boolean; data?: { proposalId?: string; status?: string } };
  }>;
  content: string | null | undefined;
}): string | null {
  return detectScheduledRequiredToolFailure(input) ??
    detectScheduledRunInferenceFailure({ executedToolCount: input.executedTools.length, content: input.content });
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
