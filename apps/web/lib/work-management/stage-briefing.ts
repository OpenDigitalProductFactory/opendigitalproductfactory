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

export type StageBriefInput = {
  capsuleId: string;
  /** The room's own objective — why this room exists at all. */
  roomObjective: string | null;
  shapeKey: string;
  shapeVersion: string;
  shapeTitle: string | null;
  shapeDescription: string | null;
  stageKey: string;
  stageTitle: string | null;
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
}): StageBriefInput {
  const { definition, stageKey } = input;
  const stage = definition?.stages.find((candidate) => candidate.key === stageKey);
  return {
    capsuleId: input.capsuleId,
    roomObjective: input.roomObjective,
    shapeKey: input.shapeKey,
    shapeVersion: input.shapeVersion,
    shapeTitle: definition?.title ?? null,
    shapeDescription: definition?.description ?? null,
    stageKey,
    stageTitle: stage?.title ?? null,
    doneWhen: stage?.advance.condition ?? null,
    evidenceKinds: stageEvidenceKinds(definition, stageKey),
    stopConditions: (definition?.stopConditions ?? []).map((entry) => entry.condition),
    stageTools: stageDeclaredTools(definition, stageKey),
  };
}
