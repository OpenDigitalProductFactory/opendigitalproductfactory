import { isRecord } from "@/lib/shared/coerce";
import { readDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";
import { readWorkroomStageTaskConfig, workroomStageToolsFromTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import {
  createAutonomousWorkRun,
  type AutonomousWorkRunRef,
} from "@/lib/tak/autonomous-work-run";
import type { ProactivityPlan } from "@dpf/validators/workroom-policy/proactivity-types";
import type { ResolvedDelegatedPosture } from "@dpf/validators/workroom-policy/delegated-posture";
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
/**
 * The governed writers this prompt names — the tools the run MUST reach.
 *
 * Same rule `classifyScheduledRequiredTools` judges by, hoisted so it can be
 * applied BEFORE the model runs instead of only after. A prompt that names a
 * side-effecting tool is declaring a dependency on it; ranking that tool out of
 * the attachment budget turns the dependency into a discovery problem the model
 * has to solve at runtime, and it cannot.
 *
 * ⟦Live evidence, WC-A69BCABB on 2026-09-15: the coworker reported
 * "Tools mismatch — the tools you listed don't match what's actually available
 * to me", having tried load_tools and several surface_* names, and the run was
 * then failed for `record_workroom_evidence executed zero times`. The tool was
 * granted (workroom_evidence_write) and authorized; it was simply not attached,
 * and the marketplace lookup did not find it. One function now decides what is
 * required, and both the pin and the verdict read it.⟧
 */
export function scheduledRequiredToolNames(input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
}): string[] {
  const prompt = input.prompt.toLowerCase();
  return [
    ...new Set(
      input.authorizedTools
        .filter((tool) => tool.sideEffect && prompt.includes(tool.name.toLowerCase()))
        .map((tool) => tool.name),
    ),
  ].sort();
}

/**
 * Does the prompt actually name this tool?
 *
 * A plain substring test is wrong whenever one tool's name is a prefix of
 * another's, and this codebase has that pair: `create_marketing_campaign` and
 * `create_marketing_campaign_brief` (marketing-pack.ts and
 * marketing-ops-pack.ts). The Marketing Strategist's prompt asks for the
 * BRIEF, and `"…create_marketing_campaign_brief…".includes("create_marketing_campaign")`
 * is true — so the platform demanded a tool the prompt never mentioned, never
 * saw it run, and filed the run as failed.
 *
 * Measured on the reference install 2026-09-23: the coworker wrote
 * "Foster Carer Recruitment Drive" at 14:00:23 and the run was recorded
 * `error` at 14:00:01 with "required governed tool create_marketing_campaign
 * executed zero times", its own message continuing "OK. I've created a new
 * campaign brief". The work landed and the verdict denied it — the mirror of
 * the false green BI-4F64C5D3 removed.
 *
 * A tool name is a token, so it must match on token boundaries. Underscores
 * are part of the name, which is why \b is not enough on its own.
 */
function promptNamesTool(lowerPrompt: string, toolName: string): boolean {
  const name = toolName.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lowerPrompt.indexOf(name, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : lowerPrompt[at - 1]!;
    const after = lowerPrompt[at + name.length] ?? "";
    const boundary = (ch: string) => ch === "" || !/[a-z0-9_]/.test(ch);
    if (boundary(before) && boundary(after)) return true;
    from = at + 1;
  }
}

/**
 * The tools this run must reach that are authorized but NOT attached.
 *
 * Two sources, in priority order:
 *   1. the governed writers the prompt names (scheduledRequiredToolNames) —
 *      first, because the run's verdict is judged on them;
 *   2. the tools the Workroom stage DECLARES it needs (WorkShapeStage.tools,
 *      carried as taskConfig.workroomStage.tools — BI-43C3E914).
 *
 * Pinning only prompt-named tools was a GPP C-6 "Reach reconciliation" gap in
 * the reverse direction: the stage's model admitted a tool the run never
 * reached, because ranking by prompt relevance dropped it from the attachment
 * budget and coworkers reported "no tool to read X". Declared tools are pinned
 * here; they stay subject to the agent ∩ user grant filter, which pinning never
 * bypasses — a declared name the run is not authorized for is simply absent.
 *
 * Returns an empty list when nothing needs pinning, so the caller re-resolves
 * only when a required tool would otherwise have to be discovered at runtime.
 */
export function scheduledToolsNeedingPin(input: {
  prompt: string;
  attached: Array<{ name: string; sideEffect?: boolean }>;
  deferred: Array<{ name: string; sideEffect?: boolean }>;
  /** The Workroom stage's declared tools. Omitted/empty: behaviour unchanged. */
  declaredStageTools?: readonly string[];
  /** The task's taskConfig; its workroomStage record supplies declaredStageTools
   *  when they are not passed directly (BI-43C3E914, GPP element 5). */
  taskConfig?: unknown;
}): string[] {
  const promptRequired = scheduledRequiredToolNames({
    prompt: input.prompt,
    authorizedTools: [...input.attached, ...input.deferred],
  });
  const required = [...new Set([...promptRequired, ...(input.declaredStageTools ?? workroomStageToolsFromTaskConfig(input.taskConfig))])];
  if (required.length === 0) return [];
  const deferredNames = new Set(input.deferred.map((tool) => tool.name));
  return required.some((name) => deferredNames.has(name)) ? required : [];
}

export function classifyScheduledRequiredTools(input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
  executedTools: ScheduledRunToolExecution[];
  /** Workroom runs must retain every pending required call, even beside a successful report or another missing write. */
  preservePendingApprovals?: boolean;
}): ScheduledRequiredToolOutcome {
  const prompt = input.prompt.toLowerCase();
  let proposed: ScheduledRequiredToolOutcome | null = null;
  if (input.preservePendingApprovals) {
    const pending = input.authorizedTools.find((tool) => tool.sideEffect && promptNamesTool(prompt, tool.name)
      && input.executedTools.some((call) => call.name === tool.name && scheduledCallAwaitsDecision(call)));
    if (pending) return { kind: "proposed", toolName: pending.name };
  }

  for (const tool of input.authorizedTools) {
    if (!tool.sideEffect || !promptNamesTool(prompt, tool.name)) continue;
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
    const awaitingDecision = calls.some(scheduledCallAwaitsDecision);
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

function scheduledCallAwaitsDecision(call: ScheduledRunToolExecution): boolean {
  return call.result?.success === true && call.result.data?.status === "proposed"
    || call.result?.error === "approval_required";
}

/**
 * The executions a run's verdict judges: the final loop result's, plus every
 * successful call the run already persisted under its taskRunId (BI-D48B3B0F).
 *
 * When a later turn ends in a provider failure, the loop returns only the
 * apology and none of the earlier attempt's calls. Live on 2026-10-01, four
 * Workroom stages recorded their evidence (ToolExecution success=true, twice
 * each) and were still failed for "record_workroom_evidence executed zero
 * times". A persisted call is counted once, and only when the loop result does
 * not already carry that tool.
 */
export function withPersistedExecutions<T extends ScheduledRunToolExecution>(
  executed: T[],
  persisted: Array<{ toolName: string; result: unknown }> | null | undefined,
): Array<T | ScheduledRunToolExecution> {
  const seen = new Set(executed.map((tool) => tool.name));
  const extra: ScheduledRunToolExecution[] = [];
  for (const row of persisted ?? []) {
    if (seen.has(row.toolName)) continue;
    seen.add(row.toolName);
    const result = row.result && typeof row.result === "object" ? row.result as ScheduledRunToolExecution["result"] : undefined;
    extra.push({ name: row.toolName, result: { ...result, success: true } });
  }
  return [...executed, ...extra];
}

/** Baseline reproduction: explicit governed mutations are not yet terminal requirements. */
export function detectScheduledRequiredToolFailure(input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
  executedTools: ScheduledRunToolExecution[];
  /** The names the model was handed. When the absent writer is among them, the
   *  verdict says so, so the failure is not read as an availability fault
   *  (BI-62DB6C03). */
  attachedToolNames?: readonly string[];
}): string | null {
  const outcome = classifyScheduledRequiredTools(input);
  if (outcome.kind !== "absent") return null;
  // BI-CAP-B5F50D1F: a writer the run called and the server refused was not
  // "attached and not called". Name the refusals so nobody hunts for a model
  // refusal or a missing tool that does not exist.
  const refusals = refusedCalls(input.executedTools, outcome.toolName);
  if (refusals.length > 0) {
    const codes = [...new Set(refusals.map((call) => call.result?.error?.trim() || "no error code"))].join(", ");
    return `required governed tool ${outcome.toolName} was called ${refusals.length} time${refusals.length === 1 ? "" : "s"} and refused every time (${codes})`;
  }
  const offered = input.attachedToolNames?.includes(outcome.toolName)
    ? "; it was attached to the run and not called"
    : "";
  return `required governed tool ${outcome.toolName} executed zero times${offered}`;
}

/** Calls of `toolName` the server refused (success false, not an approval wait). */
function refusedCalls(executed: ScheduledRunToolExecution[], toolName: string): ScheduledRunToolExecution[] {
  return executed.filter((call) => call.name === toolName && call.result?.success === false && call.result.error !== "approval_required");
}

/** The writer every Workroom stage run records its stage evidence through. */
export const WORKROOM_STAGE_EVIDENCE_TOOL = "record_workroom_evidence";

/**
 * The governed writers a run must be OFFERED, whatever its grants say
 * (BI-62DB6C03).
 *
 * scheduledRequiredToolNames and the verdict derive "required" from the
 * AUTHORIZED set, so a run that is not offered the writer — an advise boundary
 * strips every side-effecting tool, or the grant or owner capability is
 * missing — has nothing required, is recorded ok, and the drive dispatches the
 * stage again. A Workroom stage run (taskConfig.workroomStage, or a brief naming
 * the writer) cannot do its job without the writer, so that requirement is
 * stated here independently of authority.
 */
export function scheduledMandatoryToolNames(input: { prompt: string; taskConfig?: unknown }): string[] {
  const isStageRun = readWorkroomStageTaskConfig(input.taskConfig) !== null
    || promptNamesTool(input.prompt.toLowerCase(), WORKROOM_STAGE_EVIDENCE_TOOL);
  return isStageRun ? [WORKROOM_STAGE_EVIDENCE_TOOL] : [];
}

/**
 * Why this run must not be dispatched, or null when every mandatory writer is
 * attached. Checked BEFORE the model runs: a stage run without its writer can
 * only end in a blocked answer or a false "done", so it is refused with the
 * reason instead (BI-62DB6C03). An advise boundary withholds writers by design;
 * a Workroom stage is therefore never dispatched in advise mode.
 */
export function scheduledMandatoryToolGap(input: {
  prompt: string;
  taskConfig?: unknown;
  mode: "advise" | "act";
  attached: ReadonlyArray<{ name: string }>;
  deferred: ReadonlyArray<{ name: string }>;
}): string | null {
  const attached = new Set(input.attached.map((tool) => tool.name));
  const missing = scheduledMandatoryToolNames(input).filter((name) => !attached.has(name));
  if (missing.length === 0) return null;
  const names = missing.join(", ");
  if (input.mode === "advise") {
    return `required governed tool ${names} is withheld at the advise action boundary, so this Workroom stage is not dispatched in advise mode`;
  }
  const deferred = new Set(input.deferred.map((tool) => tool.name));
  return missing.every((name) => deferred.has(name))
    ? `required governed tool ${names} is authorized but was left outside the attachment budget, so this Workroom stage was not dispatched`
    : `required governed tool ${names} is not authorized for this coworker and owner (agent grant or user capability missing), so this Workroom stage was not dispatched`;
}

/**
 * The single correction turn for a run that was HANDED its required writer and
 * ended without calling it (BI-62DB6C03). Live, the model said the writer was
 * "unavailable" while it was listed in its tools; nothing told it otherwise.
 * Null when the writer ran, was diverted for approval, or was never attached.
 */
export function scheduledRequiredToolCorrection(input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
  attachedToolNames: readonly string[];
  executedTools: ScheduledRunToolExecution[];
}): { toolName: string; message: string } | null {
  const outcome = classifyScheduledRequiredTools(input);
  if (outcome.kind !== "absent" || !input.attachedToolNames.includes(outcome.toolName)) return null;
  // The model called it and read the refusal; telling it "you did not call it" is false (BI-CAP-B5F50D1F).
  if (refusedCalls(input.executedTools, outcome.toolName).length > 0) return null;
  const tool = outcome.toolName;
  return { toolName: tool, message: `${tool} is attached to this run: it is in your tool list now. Your answer did not call it, and it is the only thing that records this run. `
    + `Call ${tool} now. If you could not do the work, call it with outcome "blocked" and say what blocked you. `
    + `Do not say a tool is unavailable when it is in your tool list.` };
}

export function detectScheduledRunFailure(input: {
  prompt: string;
  authorizedTools: Array<{ name: string; sideEffect?: boolean }>;
  executedTools: Array<{
    name: string;
    result?: { success?: boolean; data?: { proposalId?: string; status?: string } };
  }>;
  content: string | null | undefined;
  attachedToolNames?: readonly string[];
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
  taskConfig?: unknown;
}): Promise<ScheduledTaskRunRef> {
  const checkpoint = readDispatchCheckpoint(isRecord(input.taskConfig) ? input.taskConfig.workroomDispatchCheckpoint : null);
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
    ...(checkpoint ? { metadata: { workroomDispatchCheckpoint: checkpoint } } : {}),
    proactivity: input.proactivity,
    delegatedPosture: input.delegatedPosture,
  });
}

/**
 * The lastStatus a completed scheduled run earns.
 *
 * "proposed" is the third verdict (BI-4F64C5D3): the run's required mutation is
 * parked on a human decision, so it neither succeeded nor failed. It carries no
 * lastError and must not enter the retry cadence — re-asking for an approval
 * already pending is how 183 proposals and 139 envelopes accumulated unseen.
 */
export function scheduledRunLastStatus(
  requiredTools: ScheduledRequiredToolOutcome,
  isPlaybookRun: unknown,
  playbookRunStatus?: string | null,
): "proposed" | "partial" | "ok" {
  if (requiredTools.kind === "proposed") return "proposed";
  if (isPlaybookRun && playbookRunStatus === "partial") return "partial";
  return "ok";
}
