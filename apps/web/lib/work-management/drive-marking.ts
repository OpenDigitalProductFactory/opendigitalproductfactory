/**
 * The drive's marking: many tokens, persisted additively (BI-8875C9DF, GPP
 * Phase 3c PR-3c-1; parallel split and join PR-3c-2).
 *
 * Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
 * §4 (state model), §6 (common rules); plan:
 * docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
 * (PR-3c-1, drive-marking.ts).
 *
 * Pure. A shape that uses a graph construct (`usesGraphConstructs`) keeps an
 * optional `marking` inside `workspaceState.workroomDrive`; a sequential shape
 * never writes one. The legacy keys keep their meaning: `stageKey` is the first
 * marked stage in document order.
 *
 * - READ (`readStoredDriveMarking`). An absent marking is derived from the
 *   stored `stageKey` (one token on it, or the start when there is none). A
 *   malformed one is never guessed at: the reader returns it verbatim with
 *   `marking_unreadable`, and the drive pauses and carries it forward. A
 *   marking from another cycle is discarded and a fresh one starts at the
 *   shape's start, as the sequential drive restarts after `cycle_complete`.
 * - STEP (`stepDriveMarking`). The drive's own implementation of the token
 *   game's rules, independent of the reference interpreter (interpreter.ts) so
 *   that the per-construct parity tests compare two statements of the rules.
 *   One firing per tick: the first marked stage, in document order, that has a
 *   completing receipt at its current iteration (and, behind an enforced,
 *   blocking gate with a refuse route, a verdict that moves it). It implements
 *   the forward move to a stage or to the success stop (PR-3c-1), parallel
 *   split and join (PR-3c-2), and refuse routes with rework edges (PR-3c-3).
 *   A stage deadline is not a step at all (PR-3c-4): timers never change the
 *   marking, and drive-deadlines.ts raises its notice beside the step. A
 *   sub-shape stage is an ordinary stage to the step (PR-3c-5): its child's
 *   success is its completing receipt (earned from `child-completion`
 *   evidence), and drive-child-rooms.ts runs the child beside the step.
 *   The one remaining construct-specific branch (a forward edge into a
 *   failure or budget stop) throws DriveConstructNotImplementedError;
 *   the graph planner turns that into a fail-closed pause, and with those flags
 *   off it is never reached, because the planner pauses first.
 * - REFUSE AND REWORK (PR-3c-3, design §6.2). A verdict is read only for a
 *   stage whose typed gate is enforced and blocking and declares a refuse
 *   route; any other stage advances on its completing receipt, as today. A
 *   refuse to a stop consumes every token. A refuse to an earlier stage counts
 *   the route's edge; past its `maxIterations` the token goes to the first
 *   budget stop; otherwise every stage of the loop region (forward-reachable
 *   from the target and forward-reaching the source) starts a new iteration,
 *   the region's tokens are removed and one token goes on the target with a
 *   fresh `enteredAt`. Receipts are never deleted: a receipt completes a stage
 *   only at its own iteration, which is observationally the interpreter's
 *   clearing. A refuse whose route is spent with no budget stop leaves the
 *   token where it is (gateHolds names it, so the planner raises
 *   `gate_refused`).
 * - LATCH (`latchPriorFor`). Each token records its own last action, reason and
 *   cycle, so the writeback latch (writeback-latch.ts) is evaluated per token:
 *   a room-level prior names one stage and would never latch a second branch
 *   (the #5166 defect, review blocker 2).
 */
import { flowEdgeElementId, stageElementId } from "@/lib/gpp/shape-language/element-ids";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";

import type { DriveAction } from "./drive-resolution";
import type { DriveReason } from "./drive-conclusion";
import {
  backwardReach,
  buildShapeFlowGraph,
  forwardReach,
  type GppFlowGraph,
  type InterpretableGate,
} from "./work-shape-flow-graph";
import type { WorkShapeDefinitionContract } from "./work-shapes";
import { isCompletingWorkroomDriveReceiptAt } from "./workroom-drive-receipts";
import type { PriorDriveForLatch } from "./writeback-latch";

export const DRIVE_MARKING_FORMAT = "drive-marking/1";

export type DriveMarkingToken = {
  /** The node's element id (`stage:<key>`, `node:<id>`), as the flow graph keys it. */
  node: string;
  /** A join arrival names the predecessor it came from. */
  from?: string;
  enteredAt: string;
  /**
   * Fixed when the token enters an agent stage (PR-3c-2): the
   * ScheduledAgentTask it dispatches through. Later ticks reuse it and never
   * recompute it from the current marking.
   */
  taskId?: string;
  lastAction?: string;
  lastReason?: string;
  lastCycleKey?: string;
};

export type DriveMarking = {
  format: typeof DRIVE_MARKING_FORMAT;
  /** The cycle this marking belongs to (projectWorkShapeCycleBoundary's cycleKey). */
  cycleKey: string;
  /** 1-safe, sorted by node then from. */
  tokens: DriveMarkingToken[];
  /** Current iteration per stage key; absent means 0. */
  iterations: Record<string, number>;
  /** Times each rework edge (edge element id) has been taken. */
  reworkTaken: Record<string, number>;
  /** Deadline notices by `<cycleKey>#<stageKey>#<iteration>` (PR-3c-4). */
  deadlines: Record<string, { raisedAt: string; notifiedAt: string | null }>;
  /**
   * Sub-shape children by `<cycleKey>#<stageKey>#<iteration>` (PR-3c-5). An
   * entry without `state` is a live child; `completed` and `abandoned` are
   * written by the runner once that effect committed, and are kept for audit.
   */
  children: Record<string, DriveMarkingChild>;
};

export const DRIVE_CHILD_STATES = ["completed", "abandoned"] as const;
export type DriveMarkingChild = { capsuleId: string; ref: string; state?: (typeof DRIVE_CHILD_STATES)[number] };

/** One marked stage's plan inside a graph plan (DrivePlan.tokens). */
export type DriveTokenPlan = {
  stageKey: string;
  iteration: number;
  action: DriveAction;
  reason: DriveReason;
  agentId: string | null;
  attentionPrincipalRef: string | null;
  taskId: string | null;
  ledger: string[];
};

export type DriveMarkingRead =
  | ActionSuccess<{ marking: DriveMarking; source: "stored" | "derived" | "new-cycle" }>
  | { ok: false; reason: "marking_unreadable"; raw: unknown };

type MarkingShape = Pick<WorkShapeDefinitionContract, "stages" | "stopConditions" | "flow">;

/** A shape that declares a flow, a deadline, a sub-shape or a refuse route: it runs on the graph path. */
export function usesGraphConstructs(definition: Pick<WorkShapeDefinitionContract, "stages" | "flow">): boolean {
  if (definition.flow !== undefined) return true;
  return definition.stages.some((stage) =>
    stage.deadline !== undefined
    || stage.subShape !== undefined
    || (stage.advance.kind === "governed-decision" && stage.advance.gate?.onRefuse !== undefined));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const isIso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function compareTokens(left: DriveMarkingToken, right: DriveMarkingToken): number {
  if (left.node !== right.node) return left.node < right.node ? -1 : 1;
  const a = left.from ?? "";
  const b = right.from ?? "";
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function countRecord(value: unknown): Record<string, number> | null {
  if (!isObject(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isCount(entry)) return null;
    out[key] = entry;
  }
  return out;
}

function parseToken(value: unknown, graph: GppFlowGraph): DriveMarkingToken | null {
  if (!isObject(value) || typeof value.node !== "string" || !isIso(value.enteredAt)) return null;
  const node = graph.nodes.get(value.node);
  if (!node || node.kind === "stop" || node.kind === "parallel-split") return null;
  if (value.from !== undefined && (typeof value.from !== "string" || node.kind !== "parallel-join")) return null;
  if (node.kind === "parallel-join" && value.from === undefined) return null;
  const optional = ["taskId", "lastAction", "lastReason", "lastCycleKey"] as const;
  if (optional.some((key) => value[key] !== undefined && typeof value[key] !== "string")) return null;
  return {
    node: value.node,
    ...(value.from !== undefined ? { from: value.from as string } : {}),
    enteredAt: value.enteredAt,
    ...Object.fromEntries(optional.filter((key) => value[key] !== undefined).map((key) => [key, value[key] as string])),
  };
}

/** The stored marking, validated strictly; null when any part of it is malformed. */
function parseMarking(value: unknown, graph: GppFlowGraph): DriveMarking | null {
  if (!isObject(value) || value.format !== DRIVE_MARKING_FORMAT || typeof value.cycleKey !== "string") return null;
  if (!Array.isArray(value.tokens)) return null;
  const tokens: DriveMarkingToken[] = [];
  for (const entry of value.tokens) {
    const token = parseToken(entry, graph);
    if (!token || tokens.some((other) => compareTokens(other, token) === 0)) return null;
    tokens.push(token);
  }
  const iterations = countRecord(value.iterations);
  const reworkTaken = countRecord(value.reworkTaken);
  if (!iterations || !reworkTaken || !isObject(value.deadlines) || !isObject(value.children)) return null;
  const deadlines: DriveMarking["deadlines"] = {};
  for (const [key, entry] of Object.entries(value.deadlines)) {
    if (!isObject(entry) || !isIso(entry.raisedAt) || !(entry.notifiedAt === null || isIso(entry.notifiedAt))) return null;
    deadlines[key] = { raisedAt: entry.raisedAt, notifiedAt: entry.notifiedAt };
  }
  const children: DriveMarking["children"] = {};
  for (const [key, entry] of Object.entries(value.children)) {
    if (!isObject(entry) || typeof entry.capsuleId !== "string" || typeof entry.ref !== "string") return null;
    if (entry.state !== undefined && !(DRIVE_CHILD_STATES as readonly unknown[]).includes(entry.state)) return null;
    children[key] = { capsuleId: entry.capsuleId, ref: entry.ref, ...(entry.state !== undefined ? { state: entry.state as DriveMarkingChild["state"] } : {}) };
  }
  return {
    format: DRIVE_MARKING_FORMAT,
    cycleKey: value.cycleKey,
    tokens: tokens.sort(compareTokens),
    iterations,
    reworkTaken,
    deadlines,
    children,
  };
}

function emptyMarking(cycleKey: string, tokens: DriveMarkingToken[]): DriveMarking {
  return { format: DRIVE_MARKING_FORMAT, cycleKey, tokens, iterations: {}, reworkTaken: {}, deadlines: {}, children: {} };
}

/** A fresh marking: one token on the shape's first stage (none for a shape with no stages). */
export function startDriveMarking(definition: MarkingShape, cycleKey: string, now: Date): DriveMarking {
  const graph = buildShapeFlowGraph(definition);
  return emptyMarking(cycleKey, graph.start ? [{ node: graph.start, enteredAt: now.toISOString() }] : []);
}

/**
 * The room's marking for this tick. `cycleKey` is the current cycle; null
 * means "do not apply the cycle rule" (the runner's receipt earning, which
 * runs before the cycle is projected). `now` dates a derived token when the
 * snapshot records no last run.
 */
export function readStoredDriveMarking(
  workspaceState: unknown,
  definition: MarkingShape,
  cycleKey: string | null,
  now: Date = new Date(0),
): DriveMarkingRead {
  const drive = isObject(workspaceState) && isObject(workspaceState.workroomDrive) ? workspaceState.workroomDrive : null;
  const graph = buildShapeFlowGraph(definition);
  if (drive && Object.hasOwn(drive, "marking") && drive.marking !== undefined) {
    const parsed = parseMarking(drive.marking, graph);
    if (!parsed) return { ok: false, reason: "marking_unreadable", raw: drive.marking };
    if (cycleKey !== null && parsed.cycleKey !== cycleKey) {
      return ok({ marking: startDriveMarking(definition, cycleKey, now), source: "new-cycle" });
    }
    return ok({ marking: parsed, source: "stored" });
  }
  const derivedCycle = cycleKey ?? (typeof drive?.lastCycleKey === "string" ? drive.lastCycleKey : "");
  const enteredAt = isIso(drive?.lastRunAt) ? drive.lastRunAt : now.toISOString();
  const stageKey = typeof drive?.stageKey === "string" ? drive.stageKey : null;
  const stageId = stageKey !== null && definition.stages.some((stage) => stage.key === stageKey) ? stageElementId(stageKey) : null;
  if (stageId) return ok({ marking: emptyMarking(derivedCycle, [{ node: stageId, enteredAt }]), source: "derived" });
  return ok({ marking: startDriveMarking(definition, derivedCycle, new Date(enteredAt)), source: "derived" });
}

/** The writeback latch's prior for one token: its own last tick, on its own stage. Null before its first tick. */
export function latchPriorFor(token: DriveMarkingToken, stageKey: string): PriorDriveForLatch | null {
  if (!token.lastAction) return null;
  return {
    action: token.lastAction,
    reason: token.lastReason ?? "",
    stageKey,
    cycleKey: token.lastCycleKey ?? null,
  };
}

/** The stage's current iteration (absent means 0). */
export function iterationOf(marking: Pick<DriveMarking, "iterations">, stageKey: string): number {
  return marking.iterations[stageKey] ?? 0;
}

/** The token holding a stage, if any (a stage token never names `from`). */
export function stageToken(marking: Pick<DriveMarking, "tokens">, stageKey: string): DriveMarkingToken | null {
  const id = stageElementId(stageKey);
  return marking.tokens.find((token) => token.node === id && token.from === undefined) ?? null;
}

/** The stage keys holding a token, in document order. */
export function markedStageKeys(definition: Pick<WorkShapeDefinitionContract, "stages">, marking: Pick<DriveMarking, "tokens">): string[] {
  return definition.stages.filter((stage) => stageToken(marking, stage.key) !== null).map((stage) => stage.key);
}

/** `stageKey#iteration` for every marked stage, sorted: what the hold key and the news check compare. */
export function markedKeysWithIteration(definition: Pick<WorkShapeDefinitionContract, "stages">, marking: DriveMarking): string[] {
  return markedStageKeys(definition, marking).map((key) => `${key}#${iterationOf(marking, key)}`).sort();
}

/** Is this receipt completing for `stageKey` at `iteration`? The graph path's predicate. */
export const isCompletingAt = isCompletingWorkroomDriveReceiptAt;

/** The marked stages with a completing receipt at their current iteration, in document order. */
export function enabledStages(
  definition: Pick<WorkShapeDefinitionContract, "stages">,
  marking: DriveMarking,
  receipts: readonly { stageKey: string; kind: string; iteration?: number }[],
): string[] {
  return markedStageKeys(definition, marking)
    .filter((key) => receipts.some((receipt) => isCompletingAt(receipt, key, iterationOf(marking, key))));
}

/** A construct-specific branch of the step that PR-3c-1 does not implement. */
export class DriveConstructNotImplementedError extends Error {
  readonly code = "construct_not_implemented";
  constructor(readonly construct: string, readonly elementId: string, detail: string) {
    super(`construct_not_implemented: ${construct} at ${elementId}: ${detail}`);
    this.name = "DriveConstructNotImplementedError";
  }
}

export type DriveMarkingStopped = { stopId: string | null; kind: "success" | "failure" | "budget"; disposition: string | null };

/** A rework the step took (PR-3c-3): the refused stage, the target, the edge counted and the stages that start a new iteration. */
export type DriveRework = {
  fromStageKey: string;
  /** The target stage key (null for a flow-node target, which a sound shape never has). */
  toStageKey: string | null;
  /** The counter key in `reworkTaken`: the rework edge's element id. */
  edgeId: string;
  /** Every stage of the loop region, in document order: each starts a new iteration and loses its token. */
  clearedStageKeys: string[];
};

export type DriveStepResult = {
  marking: DriveMarking;
  /** The stage key that fired this tick, or null. */
  fired: string | null;
  /** Set when the firing reached a stop; every token is then consumed. */
  stopped: DriveMarkingStopped | null;
  /** Set when the firing was a refuse routed back to an earlier stage (PR-3c-3). */
  reworked?: DriveRework;
};

export const DRIVE_GATE_VERDICTS = ["admit", "hold", "escalate", "refuse"] as const;
export type DriveGateVerdictKind = (typeof DRIVE_GATE_VERDICTS)[number];

/**
 * A gate verdict as the step reads it (PR-3c-3): what was decided, under which
 * gate mode, and for which iteration of the stage. A verdict for another
 * iteration, or recorded under another mode, never moves the token.
 */
export type DriveGateVerdict = { verdict: DriveGateVerdictKind; mode: "shadow" | "enforced"; iteration: number };

/**
 * Rule 7's stop event, for the parity harness, and the budget stop a spent
 * refuse route goes to (PR-3c-3): the first stop of that kind consumes every
 * token. A shape that declares no stop of the kind ignores the observation.
 */
function stopOfKind(graph: GppFlowGraph, kind: "failure" | "budget"): DriveMarkingStopped | null {
  for (const node of graph.nodes.values()) {
    if (node.kind === "stop" && node.stopKind === kind) return { stopId: node.id, kind, disposition: node.disposition ?? null };
  }
  return null;
}

type MarkingStage = MarkingShape["stages"][number];

/**
 * The gate that holds this stage's token on a verdict, or null when the stage
 * advances on its completing receipt alone. Only an enforced, blocking gate
 * that declares a refuse route (`onRefuse`, or exactly one outgoing rework
 * edge) holds the token (design §6.2): a shadow or non-blocking gate records
 * its verdict and moves on, and an enforced gate with no refuse route advances
 * as the sequential drive does today (the divergence spec §14 Q1 records).
 */
function verdictGate(graph: GppFlowGraph, stage: MarkingStage): InterpretableGate | null {
  if (stage.advance.kind !== "governed-decision") return null;
  const gate = stage.advance.gate;
  if (!gate || gate.mode !== "enforced" || !gate.blocking) return null;
  if (gate.onRefuse !== undefined) return gate;
  return (graph.reworkFrom.get(stageElementId(stage.key)) ?? []).length === 1 ? gate : null;
}

/** Whether the stage's token waits on a verdict (an enforced, blocking gate with a refuse route). */
export function stageAwaitsVerdict(definition: MarkingShape, stageKey: string): boolean {
  const stage = definition.stages.find((entry) => entry.key === stageKey);
  return stage ? verdictGate(buildShapeFlowGraph(definition), stage) !== null : false;
}

type RefuseRoute =
  | { kind: "stop"; stopped: DriveMarkingStopped }
  | { kind: "rework"; target: string; edgeId: string; taken: number };

/**
 * Where a refuse at this stage goes now, or null when it cannot go anywhere
 * and the token stays: the declared target names nothing, or the route's
 * bound is spent and the shape declares no budget stop.
 *
 * The route is `gate.onRefuse` when declared, else the stage's single rework
 * edge. A route to a stop goes there. A route to a stage is bounded by the
 * rework edge into that stage (S-5 requires one for a refuse route to a
 * stage); without one the bound is 0, so the refusal goes straight to the
 * budget stop.
 */
function refuseRoute(graph: GppFlowGraph, stageKey: string, gate: InterpretableGate, reworkTaken: Readonly<Record<string, number>>): RefuseRoute | null {
  const outgoing = graph.reworkFrom.get(stageElementId(stageKey)) ?? [];
  const declared = gate.onRefuse ?? (outgoing.length === 1 ? outgoing[0]!.toRef : null);
  if (declared === null) return null;
  const target = graph.resolveRef(declared);
  const node = target !== null ? graph.nodes.get(target) : undefined;
  if (target === null || !node) return null;
  if (node.kind === "stop") {
    return { kind: "stop", stopped: { stopId: target, kind: node.stopKind ?? "failure", disposition: node.disposition ?? null } };
  }
  const edge = outgoing.find((candidate) => candidate.to === target) ?? null;
  const edgeId = edge?.elementId ?? flowEdgeElementId(stageKey, declared);
  const taken = reworkTaken[edgeId] ?? 0;
  if (taken >= (edge?.rework?.maxIterations ?? 0)) {
    const budget = stopOfKind(graph, "budget");
    return budget ? { kind: "stop", stopped: budget } : null;
  }
  return { kind: "rework", target, edgeId, taken };
}

/** The stage's latest verdict, when it applies to this gate at this iteration. */
function applicableVerdict(
  verdicts: Readonly<Record<string, DriveGateVerdict>> | undefined,
  stageKey: string,
  gate: InterpretableGate,
  iteration: number,
): DriveGateVerdict | null {
  const recorded = verdicts?.[stageKey];
  if (!recorded || recorded.mode !== gate.mode || recorded.iteration !== iteration) return null;
  return recorded;
}

export type DriveGateHold = "awaiting_verdict" | "refused_without_route";

/**
 * Marked stages whose completing receipt does not move the token because
 * their gate holds it (PR-3c-3), in document order: no applicable verdict, or
 * `hold` / `escalate` (`awaiting_verdict`), or a refuse whose route cannot be
 * taken (`refused_without_route`, the planner's `gate_refused`). A stage the
 * step would fire (admit, or a refuse that routes) is not listed.
 */
export function gateHolds(
  definition: MarkingShape,
  marking: DriveMarking,
  observations: { receipts: readonly { stageKey: string; kind: string; iteration?: number }[]; verdicts?: Readonly<Record<string, DriveGateVerdict>> },
): Map<string, DriveGateHold> {
  const graph = buildShapeFlowGraph(definition);
  const out = new Map<string, DriveGateHold>();
  for (const stage of definition.stages) {
    if (!stageToken(marking, stage.key)) continue;
    const gate = verdictGate(graph, stage);
    if (!gate) continue;
    const iteration = iterationOf(marking, stage.key);
    if (!observations.receipts.some((receipt) => isCompletingAt(receipt, stage.key, iteration))) continue;
    const recorded = applicableVerdict(observations.verdicts, stage.key, gate, iteration);
    if (recorded?.verdict === "admit") continue;
    if (recorded?.verdict === "refuse") {
      if (refuseRoute(graph, stage.key, gate, marking.reworkTaken) === null) out.set(stage.key, "refused_without_route");
      continue;
    }
    out.set(stage.key, "awaiting_verdict");
  }
  return out;
}

/**
 * One drive tick's firing: the first marked stage, in document order, with a
 * completing receipt at its current iteration (and, behind a verdict gate, a
 * verdict that moves it) moves its token. Pure; the input marking is not
 * mutated.
 *
 * Parallel split and join (PR-3c-2, design §6.1). A token reaching a split is
 * replaced by one token on the first node of each branch, recursively through
 * nested splits. A token reaching a join becomes an arrival `{ node: join,
 * from: predecessor }`; when every forward predecessor of the join has
 * arrived, the arrivals are removed and one token goes on the join's
 * successor. There is no partial join. A stop reached on any branch consumes
 * every token. Every placed stage token takes this tick's `now` as enteredAt.
 *
 * Refuse routes and rework edges (PR-3c-3, design §6.2): see the module
 * header. A stage that waits on a verdict and has none that moves it does not
 * fire, and the next marked stage is tried, exactly as the interpreter does.
 */
export function stepDriveMarking(
  definition: MarkingShape,
  marking: DriveMarking,
  observations: {
    receipts: readonly { stageKey: string; kind: string; iteration?: number }[];
    /** The latest gate verdict per stage key (PR-3c-3); read only for a stage that waits on a verdict. */
    verdicts?: Readonly<Record<string, DriveGateVerdict>>;
    stop?: "failure" | "budget";
  },
  now: Date,
): DriveStepResult {
  const graph = buildShapeFlowGraph(definition);
  // A stage deadline never enters the step (PR-3c-4): timers never change M
  // (parent §6.1 rule 8). The planner raises notices (drive-deadlines.ts).

  if (observations.stop) {
    const stopped = stopOfKind(graph, observations.stop);
    if (stopped) return { marking: { ...marking, tokens: [] }, fired: null, stopped };
  }

  /** Place a token on `target` (arriving from `from`), routing it through splits and joins. */
  const placeInto = (tokens: DriveMarkingToken[], target: string, from: string, reached: { stopped: DriveMarkingStopped | null }): void => {
    const holds = (node: string, via?: string) => tokens.some((entry) => entry.node === node && entry.from === via);
    const enter = (next: string, via: string): void => {
      if (reached.stopped) return;
      const node = graph.nodes.get(next);
      if (!node) return;
      if (node.kind === "stop") {
        if (node.stopKind !== "success") {
          throw new DriveConstructNotImplementedError("stop", next, `a forward edge reaches a ${node.stopKind} stop, which the drive does not route yet.`);
        }
        reached.stopped = { stopId: next, kind: "success", disposition: node.disposition ?? null };
        return;
      }
      if (node.kind === "parallel-split") {
        for (const branch of graph.successors.get(next) ?? []) enter(branch, next);
        return;
      }
      if (node.kind === "parallel-join") {
        if (!holds(next, via)) tokens.push({ node: next, from: via, enteredAt: now.toISOString() });
        const incoming = graph.predecessors.get(next) ?? [];
        if (incoming.length === 0 || !incoming.every((previous) => holds(next, previous))) return;
        for (let index = tokens.length - 1; index >= 0; index -= 1) if (tokens[index]!.node === next) tokens.splice(index, 1);
        for (const after of graph.successors.get(next) ?? []) enter(after, next);
        return;
      }
      // 1-safe: a stage that already holds a token gains no second one.
      if (!holds(next)) tokens.push({ node: next, enteredAt: now.toISOString() });
    };
    enter(target, from);
  };

  for (const stage of definition.stages) {
    const token = stageToken(marking, stage.key);
    if (!token) continue;
    const iteration = iterationOf(marking, stage.key);
    if (!observations.receipts.some((receipt) => isCompletingAt(receipt, stage.key, iteration))) continue;
    const stageId = token.node;

    const gate = verdictGate(graph, stage);
    if (gate) {
      const recorded = applicableVerdict(observations.verdicts, stage.key, gate, iteration);
      if (recorded?.verdict === "refuse") {
        const route = refuseRoute(graph, stage.key, gate, marking.reworkTaken);
        // No route: the token stays, and the next marked stage may fire (a refuse never defaults to admit).
        if (route === null) continue;
        if (route.kind === "stop") return { marking: { ...marking, tokens: [] }, fired: stage.key, stopped: route.stopped };
        // The loop region: forward-reachable from the target and forward-reaching the refused stage.
        const back = backwardReach(graph, [stageId]);
        const region = new Set([...forwardReach(graph, [route.target])].filter((id) => back.has(id)));
        region.add(stageId);
        region.add(route.target);
        const clearedStageKeys = definition.stages.filter((entry) => region.has(stageElementId(entry.key))).map((entry) => entry.key);
        const iterations = { ...marking.iterations };
        for (const key of clearedStageKeys) iterations[key] = (iterations[key] ?? 0) + 1;
        const tokens = marking.tokens.filter((entry) => !region.has(entry.node));
        const reached: { stopped: DriveMarkingStopped | null } = { stopped: null };
        // The target is entered afresh: a new token, a fresh enteredAt, no task id or latch history.
        placeInto(tokens, route.target, stageId, reached);
        const reworked: DriveRework = {
          fromStageKey: stage.key,
          toStageKey: graph.nodes.get(route.target)?.stageKey ?? null,
          edgeId: route.edgeId,
          clearedStageKeys,
        };
        const next: DriveMarking = { ...marking, tokens: tokens.sort(compareTokens), iterations, reworkTaken: { ...marking.reworkTaken, [route.edgeId]: route.taken + 1 } };
        if (reached.stopped) return { marking: { ...next, tokens: [] }, fired: stage.key, stopped: reached.stopped, reworked };
        return { marking: next, fired: stage.key, stopped: null, reworked };
      }
      // No verdict for this iteration, hold or escalate: the gate keeps the token.
      if (recorded?.verdict !== "admit") continue;
    }

    if (graph.impliedTerminal === stageId) {
      return { marking: { ...marking, tokens: [] }, fired: stage.key, stopped: { stopId: null, kind: "success", disposition: null } };
    }
    const successors = graph.successors.get(stageId) ?? [];
    // A dead end in an explicit flow (S-2): the token cannot move.
    if (successors.length === 0) return { marking, fired: stage.key, stopped: null };

    const tokens = marking.tokens.filter((entry) => entry !== token);
    const reached: { stopped: DriveMarkingStopped | null } = { stopped: null };
    for (const target of successors) placeInto(tokens, target, stageId, reached);
    if (reached.stopped) return { marking: { ...marking, tokens: [] }, fired: stage.key, stopped: reached.stopped };
    return { marking: { ...marking, tokens: tokens.sort(compareTokens) }, fired: stage.key, stopped: null };
  }
  return { marking, fired: null, stopped: null };
}
