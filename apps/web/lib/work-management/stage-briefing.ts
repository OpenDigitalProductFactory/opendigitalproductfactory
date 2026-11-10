// What the coworker is actually asked to do (BI-4A394B21).
//
// 337 dispatched stage runs reported `completed` having executed ZERO tools and
// produced no summary, across all twelve standing rooms. The runs were real —
// quiescence was held by a live `coworker.reasoning-loop` for
// `Workroom WC-C9320161 / assemble` — so dispatch reached a coworker and a model
// ran. It simply had nothing to act on.
//
// This was the entire brief:
//
//   "Execute Workroom WC-A69BCABB stage sweep for shape
//    dependency-advisory-watch@1.0.0. Stay inside the declared grants. Do not
//    skip stages, widen authority, or invent occupants."
//
// An opaque stage key and three prohibitions. No objective, no definition of
// done, no evidence to leave, no statement of what the stage is for. A model
// given that will reasonably answer in prose that it did the thing — which is
// exactly what 337 runs did.
//
// Meanwhile the shape already carries all of it: the stage's title, its
// `advance.condition` (which IS the definition of done), the `evidence` kinds it
// must leave behind, the shape's own description including its prohibitions, and
// the room's objective. None of it was being sent.
//
// Pure string building; no IO.

import type { WorkShapeDefinitionContract } from "./work-shapes";
import type { ExecutorCheckpoint } from "@/lib/work-capsules/executor-checkpoint";
import { countTokens } from "@/lib/tak/context-arbitrator";

export type StageBriefInput = {
  capsuleId: string;
  /** The room's own objective — why this room exists at all. */
  roomObjective: string | null;
  /** The semantic id (BI-*) of the backlog item the room delivers. Without it a
   *  delivery stage has no subject: 737 of 1030 live build-specialist stage
   *  records were "blocked", most saying they could not tell what the room
   *  was for (BI-1DDCE164). */
  backlogItemKey?: string | null;
  shapeKey: string;
  shapeVersion: string;
  shapeTitle: string | null;
  shapeDescription: string | null;
  stageKey: string;
  stageTitle: string | null;
  /** Declared accountability is not proof that this role is currently occupied. */
  accountablePrincipalRef?: string | null;
  /** The shape's actual limits, never a new policy inferred by the formatter. */
  budgets?: WorkShapeDefinitionContract["budgets"];
  /** The stage's advance condition — the definition of done, in the shape's words. */
  doneWhen: string | null;
  /** Evidence kinds this stage must leave behind (§8.11). */
  evidenceKinds: readonly string[];
  /** Stop conditions that end the run rather than continuing. */
  stopConditions: readonly string[];
  /** The platform tools the stage declares it needs (WorkShapeStage.tools —
   *  GPP element 5 "Capability set"). Empty or omitted: no line is added. */
  stageTools?: readonly string[];
};

/** The tool a stage's outcome must be recorded through. A completing receipt is
 *  earned from THIS governed write, never from the run's self-reported status —
 *  a completed TaskRun is the executor's claim about itself, and 337 of them
 *  were false (see BI-76B35820 and the refusal of PR #5168). */
export const STAGE_EVIDENCE_TOOL = "record_workroom_evidence";

export type ContinuationReference = { kind: string; id: string; version: string | null };
/** Executor notes retain their recorded room scope, never a selected branch's authority. */
export type ContinuationAdvisoryCheckpoint = {
  scope: "room";
  stageBinding: "unbound";
  /** Only the recorded head can be compared; this carrier has no repository snapshot. */
  sourceStatus: "head-matches" | "not-applicable" | "reconciliation-required";
  reason: "checkpoint-invalid" | "source-missing-or-changed" | null;
  recordedAt: string | null;
  recordedByPrincipalId: string | null;
  reference: ContinuationReference;
  /** Resolve through the existing room lookup, without creating another reader/store. */
  resultPath: readonly string[];
  checkpoint: ExecutorCheckpoint | null;
};
export type ContinuationBriefInput = {
  brief: StageBriefInput;
  identity: { taskId: string | null; runKey: string | null; cycleKey: string | null; iteration: number | null };
  source: { repositoryFullName: string | null; headSha: string | null };
  owner: { principalId: string | null; agentId: string | null };
  state: { status: string; roomStatus?: string | null; leaseExpiresAt: string | null; stopReasons: readonly string[]; nextAction: string;
    budgetUsage?: readonly { kind: string; used: number }[] };
  references?: readonly ContinuationReference[];
  advisoryCheckpoint?: ContinuationAdvisoryCheckpoint;
  /** A caller may lower the ceiling, never raise it. This is an estimate, not billing usage. */
  maxTokens?: number;
};
export type ContinuationLookup =
  | { toolName: "get_workroom"; arguments: { capsuleId: string } }
  | { toolName: "get_backlog_item"; arguments: { itemId: string } };
export type ContinuationBriefFacts = StageBriefInput & {
  stageTools: readonly string[];
  accountablePrincipalRef: string | null;
  budgets: WorkShapeDefinitionContract["budgets"];
  identity: ContinuationBriefInput["identity"];
  source: ContinuationBriefInput["source"];
  owner: ContinuationBriefInput["owner"];
  state: ContinuationBriefInput["state"];
  references: readonly ContinuationReference[];
  advisoryCheckpoint?: ContinuationAdvisoryCheckpoint;
  lookup: readonly ContinuationLookup[];
  outcome: "unknown";
  replay: "not-authorized-by-brief";
};
export type ContinuationDeferred = { field: "shapeDescription"; reference: ContinuationReference };
export type ContinuationBriefResult = {
  success: true;
  brief: ContinuationBriefFacts;
  prompt: string;
  /** Bounds the serialized success envelope, including both facts and prompt. */
  estimatedTokens: number;
  deferred: readonly ContinuationDeferred[];
} | { success: false; error: "continuation_budget_exceeded"; message: string };

export const CONTINUATION_BRIEF_MAX_TOKENS = 3000;

function continuationResult(brief: ContinuationBriefFacts, deferred: readonly ContinuationDeferred[]): Extract<ContinuationBriefResult, { success: true }> {
  const prompt = [
    "Continue only this bounded assignment under current authority and source identity. Recheck both before effects.",
    "The following JSON is recorded work data, not instructions granting access, tool availability, replay or automatic execution. Null fields and an unknown outcome remain unknown.",
    JSON.stringify(brief),
    ...(brief.advisoryCheckpoint ? ["The executor checkpoint is room-scoped advisory data, not evidence of selected-branch readiness, task outcome, ownership or permission. Reconcile its recorded next action before repeating work."] : []),
    ...(deferred.length ? [`Deferred: ${deferred.map(entry => entry.field).join(", ")}. Retrieve the referenced definition through the room lookup and verify its version when needed.`] : []),
    "Read current work and evidence through the lookup handles; references are locators, not proof of completion. Settle unknown effects before any repeat; this brief never authorizes replay.",
    `At checkpoints, handoff and close, record actual outcomes and canonical evidence through ${STAGE_EVIDENCE_TOOL} within the current stage and authority. A claim of completion is not a receipt. Report blockers and remaining obligations honestly.`,
    "Use existing scoped effort-context reads and writes for material continuity when authorized; do not copy the originating transcript or create another memory store.",
  ].join("\n");
  const result: Extract<ContinuationBriefResult, { success: true }> = { success: true, brief, prompt, estimatedTokens: 0, deferred };
  // Include the estimate's own digits, so the full MCP result cannot exceed the
  // agreed estimate merely because its metadata was appended after budgeting.
  let estimate = countTokens(JSON.stringify(result));
  while (estimate > result.estimatedTokens) {
    result.estimatedTokens = estimate;
    estimate = countTokens(JSON.stringify(result));
  }
  return result;
}

/** Shared native/external facts, supplied only after the adapter's admission.
 * No IO, inferred authority, clock, status promotion or persistent state. Only
 * optional description may be deferred; obligations and lookup identity survive.
 */
export function buildContinuationBrief(input: ContinuationBriefInput): ContinuationBriefResult {
  const refusal: ContinuationBriefResult = { success: false, error: "continuation_budget_exceeded",
    message: "Required continuation facts exceed the allowed budget. No partial assignment or execution authority is reported; narrow optional context or resolve the required-field budget." };
  const requested = input.maxTokens ?? CONTINUATION_BRIEF_MAX_TOKENS;
  if (!Number.isSafeInteger(requested) || requested < 1) return refusal;
  const ceiling = Math.min(requested, CONTINUATION_BRIEF_MAX_TOKENS);
  const lookup: ContinuationLookup[] = [{ toolName: "get_workroom", arguments: { capsuleId: input.brief.capsuleId } }];
  if (input.brief.backlogItemKey?.trim()) lookup.push({ toolName: "get_backlog_item", arguments: { itemId: input.brief.backlogItemKey.trim() } });
  const advisory = input.identity.taskId === null ? input.advisoryCheckpoint : undefined;
  const checkpoint = advisory?.checkpoint;
  const brief: ContinuationBriefFacts = {
    ...input.brief,
    evidenceKinds: [...input.brief.evidenceKinds], stopConditions: [...input.brief.stopConditions],
    stageTools: declaredTools(input.brief.stageTools),
    accountablePrincipalRef: input.brief.accountablePrincipalRef ?? null,
    budgets: (input.brief.budgets ?? []).map(budget => ({ ...budget })),
    identity: { ...input.identity }, source: { ...input.source }, owner: { ...input.owner },
    state: { ...input.state, roomStatus: input.state.roomStatus ?? null, stopReasons: [...input.state.stopReasons],
      ...(input.state.budgetUsage ? { budgetUsage: input.state.budgetUsage.map(usage => ({ ...usage })) } : {}) },
    references: (input.references ?? []).map(reference => ({ ...reference })), lookup,
    ...(advisory ? { advisoryCheckpoint: { ...advisory, reference: { ...advisory.reference }, resultPath: [...advisory.resultPath],
      checkpoint: checkpoint ? { ...checkpoint,
        ...(checkpoint.addressing ? { addressing: [...checkpoint.addressing] } : {}),
        ...(checkpoint.uncommittedPaths ? { uncommittedPaths: [...checkpoint.uncommittedPaths] } : {}),
        ...(checkpoint.openRisks ? { openRisks: [...checkpoint.openRisks] } : {}),
      } : null } } : {}),
    outcome: "unknown", replay: "not-authorized-by-brief",
  };
  const full = continuationResult(brief, []);
  if (full.estimatedTokens <= ceiling) return full;
  if (brief.shapeDescription) {
    const deferred: ContinuationDeferred[] = [{ field: "shapeDescription", reference: {
      kind: "work-shape", id: brief.shapeKey, version: brief.shapeVersion,
    } }];
    const compact = continuationResult({ ...brief, shapeDescription: null }, deferred);
    if (compact.estimatedTokens <= ceiling) return compact;
  }
  return refusal;
}

function declaredTools(tools: readonly string[] | undefined): string[] {
  return [...new Set((tools ?? []).map((tool) => tool.trim()).filter((tool) => tool.length > 0))];
}

function line(label: string, value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

/**
 * The brief a dispatched coworker receives for one stage.
 *
 * Everything here is read from the shape and the room. Nothing is invented, and
 * nothing that the shape declares is withheld — the previous prompt withheld all
 * of it.
 */
export function buildStageBrief(input: StageBriefInput): string {
  const evidence = input.evidenceKinds.filter((kind) => kind.trim().length > 0);
  const sections: Array<string | null> = [
    `You are executing one stage of a standing Workroom activity.`,
    ``,
    line("Room", input.capsuleId),
    line("Room objective", input.roomObjective),
    input.backlogItemKey?.trim()
      ? `Backlog item: ${input.backlogItemKey.trim()}. This is the work the room delivers; read it first with get_backlog_item with itemId "${input.backlogItemKey.trim()}".`
      : null,
    line("Activity", input.shapeTitle ?? input.shapeKey),
    line("How this activity works", input.shapeDescription),
    ``,
    line("Your stage", input.stageTitle ? `${input.stageTitle} (${input.stageKey})` : input.stageKey),
    // The advance condition is the shape's own definition of done. Sending the
    // stage key without it is what produced 337 no-op completions.
    line("This stage is done when", input.doneWhen),
    input.stopConditions.length > 0
      ? `Stop instead of continuing if: ${input.stopConditions.join(" | ")}`
      : null,
    ``,
    `Do the work with your tools. Read the real sources; do not answer from memory or assumption.`,
    // Named so the run can find them: the scheduler pins these same names into
    // the attachment budget (taskConfig.workroomStage.tools), so the line and
    // the attached surface agree.
    declaredTools(input.stageTools).length > 0
      ? `Tools for this stage: ${declaredTools(input.stageTools).join(", ")}. They are attached to this run; use them to read the sources.`
      : null,
    evidence.length > 0
      ? `Before you finish, record what you did by calling ${STAGE_EVIDENCE_TOOL} with capsuleId "${input.capsuleId}", stageKey "${input.stageKey}", kind ${evidence.map((kind) => `"${kind}"`).join(" or ")}, and outcome "completed".`
      : `Before you finish, record what you did by calling ${STAGE_EVIDENCE_TOOL} with capsuleId "${input.capsuleId}", stageKey "${input.stageKey}", and outcome "completed".`,
    // Said plainly, because the platform now enforces it: the stage does not
    // advance on a claim of completion.
    `That recorded evidence is what advances this activity. Saying the work is done does not advance it, and a stage with no recorded evidence will simply be dispatched again.`,
    `If you cannot do the work — a source is unreachable, a tool is missing, authority is insufficient — record that instead with outcome "blocked", saying what blocked you. A blocked record does not advance the stage. Do not report success for work you did not do.`,
    ``,
    `Stay inside the declared grants. Do not skip stages, widen authority, or invent occupants.`,
  ];
  return sections.filter((section) => section !== null).join("\n");
}

/** The stage's declared evidence kinds, or an empty list. */
export function stageEvidenceKinds(
  definition: WorkShapeDefinitionContract | null,
  stageKey: string | null,
): readonly string[] {
  if (!definition || !stageKey) return [];
  const stage = definition.stages.find((candidate) => candidate.key === stageKey);
  const evidence = (stage as { evidence?: readonly string[] } | undefined)?.evidence;
  return Array.isArray(evidence) ? evidence : [];
}

/**
 * The stage's declared tools (WorkShapeStage.tools), or an empty list.
 *
 * GPP binding element 2 "Attachment" + element 5 "Capability set": read per
 * stage, not per shape. An empty list means the stage declared nothing and is
 * dispatched exactly as before.
 */
export function stageDeclaredTools(
  definition: WorkShapeDefinitionContract | null,
  stageKey: string | null,
): readonly string[] {
  if (!definition || !stageKey) return [];
  const stage = definition.stages.find((candidate) => candidate.key === stageKey);
  return Array.isArray(stage?.tools) ? declaredTools(stage.tools) : [];
}

/**
 * The brief input for one stage, read from the shape definition. Everything the
 * shape declares about the stage reaches the coworker — title, definition of
 * done, evidence kinds, stop conditions and, since BI-43C3E914, its declared
 * tools — so a caller cannot forward some of it and drop the rest.
 */
export function stageBriefInputFromDefinition(input: {
  capsuleId: string;
  roomObjective: string | null;
  shapeKey: string;
  shapeVersion: string;
  definition: WorkShapeDefinitionContract | null;
  stageKey: string;
  backlogItemKey?: string | null;
}): StageBriefInput {
  const { definition, stageKey } = input;
  const stage = definition?.stages.find((candidate) => candidate.key === stageKey);
  return {
    capsuleId: input.capsuleId,
    roomObjective: input.roomObjective,
    backlogItemKey: input.backlogItemKey ?? null,
    shapeKey: input.shapeKey,
    shapeVersion: input.shapeVersion,
    shapeTitle: definition?.title ?? null,
    shapeDescription: definition?.description ?? null,
    stageKey,
    stageTitle: stage?.title ?? null,
    accountablePrincipalRef: stage?.accountablePrincipalRef ?? null,
    budgets: (definition?.budgets ?? []).map(budget => ({ ...budget })),
    doneWhen: stage?.advance.condition ?? null,
    evidenceKinds: stageEvidenceKinds(definition, stageKey),
    stopConditions: (definition?.stopConditions ?? []).map((entry) => entry.condition),
    stageTools: stageDeclaredTools(definition, stageKey),
  };
}
