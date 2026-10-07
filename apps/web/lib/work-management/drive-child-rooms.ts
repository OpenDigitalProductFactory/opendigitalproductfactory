/**
 * Sub-shapes on the graph drive: the child room's lifecycle, decided purely
 * (BI-8875C9DF, GPP Phase 3c PR-3c-5).
 *
 * Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
 * §9 (sub-shape), §6.4; plan:
 * docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
 * (PR-3c-5). Founder decisions 2026-10-02 (design §14 Q2, Q6): the drive, as
 * system actor, may create, complete and abandon child rooms; a child that
 * stops on failure or budget HOLDS the parent for its owner, and the stop kind
 * is not propagated.
 *
 * A sub-shape stage runs its child as a separate Workroom pinned to the
 * stage's `key@version`. To the token step it is an ordinary stage: the
 * child's success earns the parent stage's completing receipt (from the
 * `child-completion` evidence the runner records), and the step fires it by
 * the ordinary rule. This module decides, from the marking and what the
 * child's own drive snapshot says, what the runner must do:
 *
 * - ENSURE. A marked sub-shape stage whose pass (`<cycleKey>#<stageKey>#<iteration>`)
 *   has no child entry gets one created, idempotently, under
 *   `sub-shape:<parentCapsuleId>:<cycleKey>:<stageKey>:<iteration>`. The
 *   marking's `cycleKey` is its RUN key (BI-086DC167: the calendar key of the
 *   day the run started, unchanged while the run is in flight), and it is in
 *   the key because createWorkCapsule returns the existing row for an existing
 *   key, which would hand a new run the previous run's child. A child running
 *   across UTC midnight keeps its key, so it is neither abandoned nor created
 *   twice.
 * - COMPLETE. A live child whose drive reached its success stop: record
 *   `child-completion` on the parent stage, set the child `complete`, and
 *   delete the parent→child `contains` row, in one transaction.
 * - HOLD. A live child that stopped any other way (a failure or budget stop,
 *   a conformance stop, or abandoned by someone): the parent token waits, and
 *   the token's plan is `attention` / `sub_shape_stopped` quoting the child's
 *   disposition. Nothing is propagated.
 * - ABANDON. A live child whose pass no token holds any more (a rework across
 *   the stage started a new iteration, a stop consumed every token, or its
 *   run concluded and a new one started): set it `abandoned` with a reason and delete its
 *   `contains` row, in one transaction.
 *
 * The runner writes an entry's `state` (`completed`, `abandoned`) only after
 * that effect committed, so a failed effect is simply decided again next tick.
 */
import { deadlineKey } from "./drive-deadlines";
import { iterationOf, stageToken, type DriveMarking, type DriveMarkingChild } from "./drive-marking";
import type { WorkShapeDefinitionContract } from "./work-shapes";

type SubShapeShape = Pick<WorkShapeDefinitionContract, "stages">;

/** The child entry's key: one pass through one stage in one run (the deadline key's form). */
export const subShapeChildKey = deadlineKey;

/** The idempotency key of the child room for one pass (design §9.2). */
export function subShapeIdempotencyKey(parentCapsuleId: string, cycleKey: string, stageKey: string, iteration: number): string {
  return `sub-shape:${parentCapsuleId}:${cycleKey}:${stageKey}:${iteration}`;
}

/** What the drive reads of a child room: its status and its own drive snapshot's action and reason. */
export type SubShapeChildObservation = {
  capsuleId: string;
  status: string;
  action: string | null;
  reason: string | null;
};

export type SubShapeOutcome =
  | { kind: "running" }
  | { kind: "success"; disposition: string }
  | { kind: "stopped"; disposition: string };

const TERMINAL_NOT_COMPLETE = new Set(["abandoned", "archived"]);

/**
 * How a child stands. Its drive's success stop, or the cycle-complete sleep it
 * falls into right after, is success; a room already `complete` is success.
 * Any other stop, or a room abandoned or archived by someone else, has
 * stopped; anything else is running.
 */
export function subShapeOutcome(child: SubShapeChildObservation | undefined): SubShapeOutcome {
  if (!child) return { kind: "running" };
  if (child.status === "complete") return { kind: "success", disposition: "complete" };
  if (TERMINAL_NOT_COMPLETE.has(child.status)) return { kind: "stopped", disposition: child.status };
  if ((child.action === "stop" && child.reason === "success") || (child.action === "do_not_wake" && child.reason === "cycle_complete")) {
    return { kind: "success", disposition: "success" };
  }
  if (child.action === "stop") return { kind: "stopped", disposition: child.reason ?? "stop" };
  return { kind: "running" };
}

export type SubShapeEnsure = { key: string; stageKey: string; stageTitle: string; iteration: number; ref: string; idempotencyKey: string };
export type SubShapeCompletion = { key: string; stageKey: string; iteration: number; childCapsuleId: string; ref: string; disposition: string };
export type SubShapeAbandon = { key: string; childCapsuleId: string; ref: string; reason: string };
export type SubShapeEffects = { ensure: SubShapeEnsure[]; complete: SubShapeCompletion[]; abandon: SubShapeAbandon[] };

/** A marked sub-shape stage's state this tick, for its token plan. */
export type SubShapeTokenState =
  | { kind: "creating"; key: string; ref: string }
  | { kind: "running"; key: string; ref: string; childCapsuleId: string }
  | { kind: "completing"; key: string; ref: string; childCapsuleId: string }
  | { kind: "completed"; key: string; ref: string; childCapsuleId: string }
  | { kind: "stopped"; key: string; ref: string; childCapsuleId: string; disposition: string };

/** The current pass's key for a marked sub-shape stage, or null when the stage is not one, or holds no token. */
function passKey(definition: SubShapeShape, marking: DriveMarking, stageKey: string): { key: string; ref: string } | null {
  const stage = definition.stages.find((entry) => entry.key === stageKey);
  if (!stage?.subShape || !stageToken(marking, stageKey)) return null;
  return { key: subShapeChildKey(marking.cycleKey, stageKey, iterationOf(marking, stageKey)), ref: stage.subShape };
}

export function subShapeTokenState(
  definition: SubShapeShape,
  marking: DriveMarking,
  stageKey: string,
  children: Readonly<Record<string, SubShapeChildObservation>> | undefined,
): SubShapeTokenState | null {
  const pass = passKey(definition, marking, stageKey);
  if (!pass) return null;
  const entry: DriveMarkingChild | undefined = marking.children[pass.key];
  if (!entry) return { kind: "creating", ...pass };
  if (entry.state === "completed") return { kind: "completed", ...pass, childCapsuleId: entry.capsuleId };
  const outcome = subShapeOutcome(children?.[entry.capsuleId]);
  if (outcome.kind === "success") return { kind: "completing", ...pass, childCapsuleId: entry.capsuleId };
  if (outcome.kind === "stopped" || entry.state === "abandoned") {
    return { kind: "stopped", ...pass, childCapsuleId: entry.capsuleId, disposition: outcome.kind === "stopped" ? outcome.disposition : "abandoned" };
  }
  return { kind: "running", ...pass, childCapsuleId: entry.capsuleId };
}

/**
 * What the runner must do for the marking this tick persists. `abandonReason`
 * names why a live child no token holds any more is being let go.
 */
export function subShapeEffects(
  definition: SubShapeShape,
  marking: DriveMarking,
  parentCapsuleId: string,
  children: Readonly<Record<string, SubShapeChildObservation>> | undefined,
  abandonReason: string,
): SubShapeEffects {
  const effects: SubShapeEffects = { ensure: [], complete: [], abandon: [] };
  const current = new Set<string>();
  for (const stage of definition.stages) {
    const pass = passKey(definition, marking, stage.key);
    if (!pass) continue;
    current.add(pass.key);
    const iteration = iterationOf(marking, stage.key);
    const entry = marking.children[pass.key];
    if (!entry) {
      effects.ensure.push({ ...pass, stageKey: stage.key, stageTitle: stage.title, iteration, idempotencyKey: subShapeIdempotencyKey(parentCapsuleId, marking.cycleKey, stage.key, iteration) });
      continue;
    }
    if (entry.state) continue;
    const outcome = subShapeOutcome(children?.[entry.capsuleId]);
    if (outcome.kind === "success") {
      effects.complete.push({ key: pass.key, stageKey: stage.key, iteration, childCapsuleId: entry.capsuleId, ref: entry.ref, disposition: outcome.disposition });
    }
  }
  for (const [key, entry] of Object.entries(marking.children).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (entry.state || current.has(key)) continue;
    effects.abandon.push({ key, childCapsuleId: entry.capsuleId, ref: entry.ref, reason: abandonReason });
  }
  return effects;
}

/** Whether there is anything to do. */
export function hasSubShapeEffects(effects: SubShapeEffects): boolean {
  return effects.ensure.length + effects.complete.length + effects.abandon.length > 0;
}

/** Live child entries (no `state`) of a marking: what a rebind must wait for. */
export function liveSubShapeChildren(marking: Pick<DriveMarking, "children">): Array<[string, DriveMarkingChild]> {
  return Object.entries(marking.children).filter(([, entry]) => entry.state === undefined);
}

/** The marking with an entry written or its state set. Pure. */
export function withChildEntry(marking: DriveMarking, key: string, entry: DriveMarkingChild): DriveMarking {
  return { ...marking, children: { ...marking.children, [key]: entry } };
}
