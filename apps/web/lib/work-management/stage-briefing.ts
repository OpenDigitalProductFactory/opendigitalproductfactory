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
};

/** The tool a stage's outcome must be recorded through. A completing receipt is
 *  earned from THIS governed write, never from the run's self-reported status —
 *  a completed TaskRun is the executor's claim about itself, and 337 of them
 *  were false (see BI-76B35820 and the refusal of PR #5168). */
export const STAGE_EVIDENCE_TOOL = "record_workroom_evidence";

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
    evidence.length > 0
      ? `Before you finish, record what you did by calling ${STAGE_EVIDENCE_TOOL} with capsuleId "${input.capsuleId}", stageKey "${input.stageKey}", and kind ${evidence.map((kind) => `"${kind}"`).join(" or ")}.`
      : `Before you finish, record what you did by calling ${STAGE_EVIDENCE_TOOL} with capsuleId "${input.capsuleId}" and stageKey "${input.stageKey}".`,
    // Said plainly, because the platform now enforces it: the stage does not
    // advance on a claim of completion.
    `That recorded evidence is what advances this activity. Saying the work is done does not advance it, and a stage with no recorded evidence will simply be dispatched again.`,
    `If you cannot do the work — a source is unreachable, a tool is missing, authority is insufficient — record that instead, with what blocked you. Do not report success for work you did not do.`,
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
