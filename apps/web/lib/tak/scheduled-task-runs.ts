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

export type ScheduledRunToolExecution = {
  name: string;
  result?: {
    success?: boolean;
    /** "approval_required" when the call opened a CoworkerActionEnvelope. */
    error?: string;
    data?: { proposalId?: string; status?: string };
  };
};

export type ScheduledRequiredToolOutcome =
  /** The required mutation landed. */
  | { kind: "executed" }
  /**
   * The required mutation was attempted and DIVERTED to an AgentActionProposal
   * (BI-80532D5C), because the run's actionBoundary is "propose". The run did
   * its job at the boundary it was given; what is outstanding is an owner
   * decision, not a retry.
   */
  | { kind: "proposed"; toolName: string }
  /** The required mutation was never attempted. This is the failure. */
  | { kind: "absent"; toolName: string };

/**
 * Which required governed mutations a scheduled run actually completed.
 *
 * WHY THIS IS THREE STATES AND NOT TWO (BI-4F64C5D3).
 *
 * The original check asked only "did the mutation land?", and treated a
 * proposal as a no — deliberately, because a proposal is not delivery. But when
 * the run's actionBoundary is "propose", diverting the call IS the correct
 * behaviour, so every propose-boundary coworker recorded lastStatus=error and
 * was handed to the BI-754C9E82 retry cadence, which re-proposed what it had
 * already proposed.
 *
 * Measured on the reference install on 2026-09-12: 183 AgentActionProposal rows
 * in status "proposed" going back to 2026-08-26, none ever approved, including
 * 55 copies of one run_hive_scout_ingest and 50 of one run_discovery_triage.
 * Those are not seventeen days of daily proposals; that is the retry loop. The
 * lastError text said so out loud — "the daily external catalog scout pass has
 * been proposed and is now awaiting your approval" — filed as a failure.
 *
 * So: absent is a failure, executed is a success, and proposed is neither. The
 * caller records the third verdict instead of collapsing it into one of the
 * other two.
 */
export function classifyScheduledRequiredTools(input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
  executedTools: ScheduledRunToolExecution[];
}): ScheduledRequiredToolOutcome {
  const prompt = input.prompt.toLowerCase();
  let proposed: ScheduledRequiredToolOutcome | null = null;

  for (const tool of input.authorizedTools) {
    if (!tool.sideEffect || !prompt.includes(tool.name.toLowerCase())) continue;
    const calls = input.executedTools.filter((execution) => execution.name === tool.name);
    if (
      calls.some(
        (execution) =>
          execution.result?.success === true &&
          execution.result.data?.status !== "proposed",
      )
    ) {
      continue;
    }
    // Two different mechanisms park a governed mutation on a human decision.
    // Both mean "the coworker asked; a person has not answered yet".
    //   - AgentActionProposal: succeeds with data.status "proposed".
    //   - CoworkerActionEnvelope: FAILS with error "approval_required".
    // The envelope path is the larger one — 425 such tool failures on the
    // reference install since 2026-08-25, led by record_initiative_evidence
    // (187) and record_initiative_design_review (186). Reading those as "the
    // tool executed zero times" is why the readiness and evidence chain looks
    // broken: the coworker requested approval, was handed back a failure, and
    // retried until it exhausted its turn.
    const awaitingDecision = calls.some(
      (execution) =>
        (execution.result?.success === true &&
          execution.result.data?.status === "proposed") ||
        execution.result?.error === "approval_required",
    );
    if (awaitingDecision) {
      // Remember it, but keep looking: a genuinely absent mutation elsewhere
      // still outranks this.
      proposed ??= { kind: "proposed", toolName: tool.name };
      continue;
    }
    return { kind: "absent", toolName: tool.name };
  }

  return proposed ?? { kind: "executed" };
}

/** Baseline reproduction: explicit governed mutations are not yet terminal requirements. */
export function detectScheduledRequiredToolFailure(input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
  executedTools: ScheduledRunToolExecution[];
}): string | null {
  const outcome = classifyScheduledRequiredTools(input);
  return outcome.kind === "absent"
    ? `required governed tool ${outcome.toolName} executed zero times`
    : null;
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
