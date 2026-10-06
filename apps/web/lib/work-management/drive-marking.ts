/**
 * The drive's marking: many tokens, persisted additively (BI-8875C9DF, GPP
 * Phase 3c PR-3c-1).
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
 *   completing receipt at its current iteration. PR-3c-1 implements only the
 *   forward move to a stage or to the success stop. Every construct-specific
 *   branch (split, join, rework, refuse route, deadline, sub-shape, a forward
 *   edge into a failure or budget stop) throws DriveConstructNotImplementedError;
 *   the graph planner turns that into a fail-closed pause, and with the flags
 *   off it is never reached, because the planner pauses first.
 * - LATCH (`latchPriorFor`). Each token records its own last action, reason and
 *   cycle, so the writeback latch (writeback-latch.ts) is evaluated per token:
 *   a room-level prior names one stage and would never latch a second branch
 *   (the #5166 defect, review blocker 2).
 */
import { stageElementId } from "@/lib/gpp/shape-language/element-ids";

import type { DriveAction } from "./drive-resolution";
import type { DriveReason } from "./drive-conclusion";
import { buildShapeFlowGraph, type GppFlowGraph } from "./work-shape-flow-graph";
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
  /** Fixed when the token enters an agent stage (PR-3c-2). */
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
  /** Sub-shape children by `<cycleKey>#<stageKey>#<iteration>` (PR-3c-5). */
  children: Record<string, { capsuleId: string; ref: string }>;
};

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
  | { ok: true; marking: DriveMarking; source: "stored" | "derived" | "new-cycle" }
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
    children[key] = { capsuleId: entry.capsuleId, ref: entry.ref };
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
      return { ok: true, marking: startDriveMarking(definition, cycleKey, now), source: "new-cycle" };
    }
    return { ok: true, marking: parsed, source: "stored" };
  }
  const derivedCycle = cycleKey ?? (typeof drive?.lastCycleKey === "string" ? drive.lastCycleKey : "");
  const enteredAt = isIso(drive?.lastRunAt) ? drive.lastRunAt : now.toISOString();
  const stageKey = typeof drive?.stageKey === "string" ? drive.stageKey : null;
  const stageId = stageKey !== null && definition.stages.some((stage) => stage.key === stageKey) ? stageElementId(stageKey) : null;
  if (stageId) return { ok: true, marking: emptyMarking(derivedCycle, [{ node: stageId, enteredAt }]), source: "derived" };
  return { ok: true, marking: startDriveMarking(definition, derivedCycle, new Date(enteredAt)), source: "derived" };
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

export type DriveStepResult = {
  marking: DriveMarking;
  /** The stage key that fired this tick, or null. */
  fired: string | null;
  /** Set when the firing reached a stop; every token is then consumed. */
  stopped: DriveMarkingStopped | null;
};

/**
 * One drive tick's firing: the first marked stage, in document order, with a
 * completing receipt at its current iteration moves its token along its
 * forward edge. Pure; the input marking is not mutated.
 */
export function stepDriveMarking(
  definition: MarkingShape,
  marking: DriveMarking,
  observations: { receipts: readonly { stageKey: string; kind: string; iteration?: number }[] },
  now: Date,
): DriveStepResult {
  const graph = buildShapeFlowGraph(definition);
  const stagesByKey = new Map(definition.stages.map((stage) => [stage.key, stage]));
  for (const token of marking.tokens) {
    const node = graph.nodes.get(token.node);
    if (node?.kind === "parallel-join") {
      throw new DriveConstructNotImplementedError("parallel-split-join", token.node, "a join arrival is marked (PR-3c-2).");
    }
    const stage = node?.stageKey !== undefined ? stagesByKey.get(node.stageKey) : undefined;
    if (stage?.deadline) throw new DriveConstructNotImplementedError("stage-deadline", token.node, "a marked stage declares a deadline (PR-3c-4).");
  }

  for (const stage of definition.stages) {
    const token = stageToken(marking, stage.key);
    if (!token) continue;
    const iteration = iterationOf(marking, stage.key);
    if (!observations.receipts.some((receipt) => isCompletingAt(receipt, stage.key, iteration))) continue;
    const stageId = token.node;
    if (stage.advance.kind === "governed-decision" && stage.advance.gate?.onRefuse !== undefined) {
      throw new DriveConstructNotImplementedError("rework-edge", `gate:${stage.key}`, "the stage declares a refuse route (PR-3c-3).");
    }
    if ((graph.reworkFrom.get(stageId) ?? []).length > 0) {
      throw new DriveConstructNotImplementedError("rework-edge", stageId, "the stage has a rework edge (PR-3c-3).");
    }

    const remaining = marking.tokens.filter((entry) => entry !== token);
    if (graph.impliedTerminal === stageId) {
      return { marking: { ...marking, tokens: [] }, fired: stage.key, stopped: { stopId: null, kind: "success", disposition: null } };
    }
    const successors = graph.successors.get(stageId) ?? [];
    // A dead end in an explicit flow (S-2): the token cannot move.
    if (successors.length === 0) return { marking, fired: stage.key, stopped: null };
    const placed: DriveMarkingToken[] = [];
    for (const target of successors) {
      const node = graph.nodes.get(target);
      if (!node) continue;
      if (node.kind === "stop") {
        if (node.stopKind !== "success") {
          throw new DriveConstructNotImplementedError("stop", target, `a forward edge reaches a ${node.stopKind} stop, which the drive does not route yet.`);
        }
        return {
          marking: { ...marking, tokens: [] },
          fired: stage.key,
          stopped: { stopId: target, kind: "success", disposition: node.disposition ?? null },
        };
      }
      if (node.kind !== "stage") {
        throw new DriveConstructNotImplementedError("parallel-split-join", target, `a forward edge reaches a ${node.kind} (PR-3c-2).`);
      }
      const next = node.stageKey !== undefined ? stagesByKey.get(node.stageKey) : undefined;
      if (next?.subShape !== undefined) throw new DriveConstructNotImplementedError("sub-shape", target, "the next stage calls a sub-shape (PR-3c-5).");
      if (next?.deadline) throw new DriveConstructNotImplementedError("stage-deadline", target, "the next stage declares a deadline (PR-3c-4).");
      // 1-safe: a stage that already holds a token gains no second one.
      if (!remaining.some((entry) => entry.node === target) && !placed.some((entry) => entry.node === target)) {
        placed.push({ node: target, enteredAt: now.toISOString() });
      }
    }
    return { marking: { ...marking, tokens: [...remaining, ...placed].sort(compareTokens) }, fired: stage.key, stopped: null };
  }
  return { marking, fired: null, stopped: null };
}
