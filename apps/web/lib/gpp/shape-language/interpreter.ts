// apps/web/lib/gpp/shape-language/interpreter.ts
//
// The reference interpreter: the executable statement of the restricted,
// block-structured, 1-safe token game. Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §6.1 (token game),
// §6.2 (gates), §6.5 (reference interpreter); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-2, BI-6DA17863).
//
// `stepShapeInstance(definition, marking, event) → marking` is pure. It is not
// a second runtime; the drive (`resolveDrivePlan` / `nextStageKey` in
// lib/work-management/drive-resolution.ts) is the runtime. It is used three
// ways (§6.5):
// - interpreter-parity.test.ts checks that, for every sequential registry
//   shape and any receipt sequence, its marked stage equals `nextStageKey`'s
//   (AC-INTERPRETER);
// - soundness.ts builds its flow graph with `buildShapeFlowGraph`, so the
//   soundness rules and the token game read one graph (the builder lives in
//   lib/work-management/work-shape-flow-graph.ts since Phase 3c, PR-3c-1, so
//   the drive reads the same graph; it is re-exported here);
// - a construct's Exec flag (PR-3b-3) flips only when the drive matches this
//   interpreter for that construct.
//
// Rules (§6.1), applied ONE AT A TIME — each event records its fact, then at
// most one marked stage fires (the first in document order that is enabled).
// That is how the drive advances: one stage per tick.
// 1. Start: M = { stages[0] }.
// 3. Stage completion: a marked stage fires when a completing receipt for it
//    exists (`isCompletingWorkroomDriveReceipt`, the drive's own predicate —
//    not restated). A `status-change` advance moves the token on. A
//    `governed-decision` advance is gated (§6.2, below).
// 4. Parallel split: M := M − {p} ∪ {first node of each branch}.
// 5. Parallel join: waits until every incoming branch has delivered; no
//    partial join.
// 6. Rework edge s → t: taken only by a refuse verdict (to `gate.onRefuse`, or
//    else the stage's single outgoing rework edge). A per-edge counter bounds
//    it; past `maxIterations` the token goes to the first budget stop. Receipts
//    and verdicts of the stages the token returns across are cleared, so they
//    must be produced again (the permit revocation of §5 construct 13).
// 7. Stop: reaching a stop consumes every token and records its disposition.
//    A failure or budget stop fires from any marking on a `stop` event.
// 8. Timers never change M, so they are not events here.
//
// Gates (§6.2), for a governed-decision stage with a typed `gate`:
// - `shadow`, or `enforced` with `blocking: false`: the verdict is recorded
//   and the token moves on the completing receipt alone.
// - `enforced` and blocking: only `admit` moves the token. `hold` and
//   `escalate` keep it. `refuse` routes to `onRefuse` (or the stage's single
//   rework edge) when declared; otherwise the token stays. A refuse never
//   defaults to admit, and a verdict recorded under a mode other than the
//   gate's declared mode never moves the token.
// - A governed-decision advance WITHOUT a typed gate behaves as today's drive:
//   the completing receipt (the recorded decision) moves the token.
//
// The split, join and rework rules exist so soundness can reason about an
// explicit `flow` (and so Phase 3c can prove the drive against them). No
// emitted shape reaches them while their Exec flag is off: PR-3b-3 refuses
// such a document with E-NOT-EXECUTABLE, and nothing here makes the drive run
// them.
//
// Flow references. An edge endpoint (and `gate.onRefuse`) names a stage key, a
// flow node id, a stop element id (`stop:<kind>:<n>`, element-ids.ts), or a
// stop kind (`success` | `failure` | `budget`, meaning the first stop of that
// kind). A stage key wins over a node id or stop kind spelled the same (S-3
// reports a node id that collides with a stage key). Without `flow`, the flow
// is the implied sequence stages[0] → … → stages[n-1] → first success stop;
// when no success stop is declared the last stage completes the instance
// anyway (as `nextStageKey` does) and S-2 reports the missing exit.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import { isCompletingWorkroomDriveReceipt } from "@/lib/work-management/workroom-drive-receipts";

import {
  backwardReach,
  buildShapeFlowGraph,
  forwardReach,
  type GppFlowEdge,
  type GppFlowGraph,
  type GppGateMode,
  type InterpretableGate,
  type InterpretableShape,
} from "@/lib/work-management/work-shape-flow-graph";

import { flowEdgeElementId, stageElementId } from "./element-ids";

// The flow graph moved to work-management in Phase 3c (PR-3c-1, BI-8875C9DF)
// so the drive reads the same graph; these re-exports keep every import of it
// from this module compiling.
export {
  backwardReach,
  buildShapeFlowGraph,
  forwardReach,
  type GppFlowEdge,
  type GppFlowGraph,
  type GppFlowNode,
  type GppFlowNodeKind,
  type GppGateMode,
  type InterpretableShape,
} from "@/lib/work-management/work-shape-flow-graph";

// ── input ───────────────────────────────────────────────────────────────────

export const GPP_GATE_VERDICTS = ["admit", "hold", "escalate", "refuse"] as const;
export type GppGateVerdict = (typeof GPP_GATE_VERDICTS)[number];

// ── marking and events ──────────────────────────────────────────────────────

/** A token on a node. A join arrival also names the predecessor it came from. */
export type GppToken = { node: string; from?: string };

export type GppShapeStopped = {
  /** The stop element id, or null when the implied flow completes without a declared success stop. */
  stopId: string | null;
  kind: "success" | "failure" | "budget";
  disposition: string | null;
};

export type GppShapeMarking = {
  /** Sorted by node, then from. 1-safe: no two tokens are equal. */
  tokens: readonly GppToken[];
  /** Every receipt recorded so far, in arrival order, without exact duplicates. */
  receipts: ReadonlyArray<{ stageKey: string; kind: string }>;
  /** The latest verdict per stage key, with the mode it was recorded under. */
  verdicts: Readonly<Record<string, { verdict: GppGateVerdict; mode: GppGateMode }>>;
  /** Times each rework edge (by edge element id) has been taken. */
  reworkTaken: Readonly<Record<string, number>>;
  stopped: GppShapeStopped | null;
};

export type GppShapeEvent =
  | { type: "receipt"; stageKey: string; kind: string }
  | { type: "gate-verdict"; stageKey: string; verdict: GppGateVerdict; mode: GppGateMode }
  | { type: "stop"; kind: "failure" | "budget" };

function compareTokens(left: GppToken, right: GppToken): number {
  if (left.node !== right.node) return left.node < right.node ? -1 : 1;
  const a = left.from ?? "";
  const b = right.from ?? "";
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Mutable working copy for one step. */
type Work = {
  tokens: GppToken[];
  receipts: Array<{ stageKey: string; kind: string }>;
  verdicts: Record<string, { verdict: GppGateVerdict; mode: GppGateMode }>;
  reworkTaken: Record<string, number>;
  stopped: GppShapeStopped | null;
};

function freeze(work: Work): GppShapeMarking {
  return {
    tokens: [...work.tokens].sort(compareTokens),
    receipts: work.receipts,
    verdicts: work.verdicts,
    reworkTaken: work.reworkTaken,
    stopped: work.stopped,
  };
}

function stopAt(work: Work, graph: GppFlowGraph, stopId: string): void {
  const node = graph.nodes.get(stopId);
  work.tokens = [];
  work.stopped = {
    stopId,
    kind: node?.stopKind ?? "failure",
    disposition: node?.disposition ?? null,
  };
}

function hasToken(work: Work, token: GppToken): boolean {
  return work.tokens.some((entry) => compareTokens(entry, token) === 0);
}

/** Put a token on `node` (arriving from `from`) and route it through splits, joins and stops. */
function place(work: Work, graph: GppFlowGraph, node: string, from: string | null): void {
  if (work.stopped) return;
  const entry = graph.nodes.get(node);
  if (!entry) return;
  switch (entry.kind) {
    case "stop":
      stopAt(work, graph, node);
      return;
    case "stage":
      if (!hasToken(work, { node })) work.tokens.push({ node });
      return;
    case "parallel-split":
      for (const next of graph.successors.get(node) ?? []) place(work, graph, next, node);
      return;
    case "parallel-join": {
      const arrival: GppToken = from === null ? { node } : { node, from };
      if (!hasToken(work, arrival)) work.tokens.push(arrival);
      const incoming = graph.predecessors.get(node) ?? [];
      const complete = incoming.length > 0 && incoming.every((previous) => hasToken(work, { node, from: previous }));
      if (!complete) return;
      work.tokens = work.tokens.filter((token) => token.node !== node);
      for (const next of graph.successors.get(node) ?? []) place(work, graph, next, node);
      return;
    }
  }
}

/** Move the token on `stageId` along its forward edge. */
function advance(work: Work, graph: GppFlowGraph, stageId: string): void {
  work.tokens = work.tokens.filter((token) => token.node !== stageId);
  if (graph.impliedTerminal === stageId) {
    work.tokens = [];
    work.stopped = { stopId: null, kind: "success", disposition: null };
    return;
  }
  const next = graph.successors.get(stageId) ?? [];
  if (next.length === 0) {
    // A dead end in an explicit flow (S-2): the token cannot move.
    work.tokens.push({ node: stageId });
    return;
  }
  for (const target of next) place(work, graph, target, stageId);
}

function firstBudgetStop(graph: GppFlowGraph): string | null {
  for (const node of graph.nodes.values()) if (node.kind === "stop" && node.stopKind === "budget") return node.id;
  return null;
}

/**
 * Route a refuse verdict at `stageId`. Returns false when the gate names no
 * refuse route (the token then stays and the room is held for its owner).
 */
function routeRefusal(work: Work, graph: GppFlowGraph, stageKey: string, gate: InterpretableGate): boolean {
  const stageId = stageElementId(stageKey);
  let targetRef: string | null = gate.onRefuse ?? null;
  let edge: GppFlowEdge | null = null;
  if (targetRef === null) {
    const rework = graph.reworkFrom.get(stageId) ?? [];
    if (rework.length !== 1) return false;
    edge = rework[0] as GppFlowEdge;
    targetRef = edge.toRef;
  }
  const target = graph.resolveRef(targetRef);
  if (target === null) return false;
  const targetNode = graph.nodes.get(target);
  if (!targetNode) return false;
  if (targetNode.kind === "stop") {
    stopAt(work, graph, target);
    return true;
  }
  edge ??= (graph.reworkFrom.get(stageId) ?? []).find((candidate) => candidate.to === target) ?? null;
  const counterKey = edge?.elementId ?? flowEdgeElementId(stageKey, targetRef);
  const bound = edge?.rework?.maxIterations ?? 0;
  const taken = work.reworkTaken[counterKey] ?? 0;
  if (taken + 1 > bound) {
    const budget = firstBudgetStop(graph);
    if (budget === null) return false;
    stopAt(work, graph, budget);
    return true;
  }
  work.reworkTaken = { ...work.reworkTaken, [counterKey]: taken + 1 };
  // The stages the token returns across: forward-reachable from the target and forward-reaching the source.
  const loop = forwardReach(graph, [target]);
  const back = backwardReach(graph, [stageId]);
  const region = new Set([...loop].filter((id) => back.has(id)));
  region.add(stageId);
  region.add(target);
  const clearedKeys = new Set<string>();
  for (const id of region) {
    const node = graph.nodes.get(id);
    if (node?.stageKey !== undefined) clearedKeys.add(node.stageKey);
  }
  work.receipts = work.receipts.filter((receipt) => !clearedKeys.has(receipt.stageKey));
  work.verdicts = Object.fromEntries(Object.entries(work.verdicts).filter(([key]) => !clearedKeys.has(key)));
  work.tokens = work.tokens.filter((token) => !region.has(token.node));
  place(work, graph, target, null);
  return true;
}

/** Fire the first marked stage, in document order, that is enabled. Returns whether one fired. */
function fireOne(work: Work, graph: GppFlowGraph, definition: InterpretableShape): boolean {
  for (const stage of definition.stages) {
    const stageId = stageElementId(stage.key);
    if (!hasToken(work, { node: stageId })) continue;
    const completing = work.receipts.some((receipt) => isCompletingWorkroomDriveReceipt(receipt, stage.key));
    if (!completing) continue;
    const gate = stage.advance.kind === "governed-decision" ? stage.advance.gate : undefined;
    const gated = gate !== undefined && gate.mode === "enforced" && gate.blocking;
    if (!gated) {
      advance(work, graph, stageId);
      return true;
    }
    const recorded = work.verdicts[stage.key];
    if (!recorded || recorded.mode !== gate.mode) continue;
    if (recorded.verdict === "admit") {
      advance(work, graph, stageId);
      return true;
    }
    if (recorded.verdict === "refuse" && routeRefusal(work, graph, stage.key, gate)) return true;
    // hold, escalate, or a refuse with no route: the token stays.
  }
  return false;
}

/** Rule 1: a new instance with one token on the first stage. */
export function startShapeInstance(definition: InterpretableShape): GppShapeMarking {
  const graph = buildShapeFlowGraph(definition);
  const work: Work = { tokens: [], receipts: [], verdicts: {}, reworkTaken: {}, stopped: null };
  if (graph.start) place(work, graph, graph.start, null);
  return freeze(work);
}

/** One event → the next marking. Pure: the inputs are never mutated. */
export function stepShapeInstance(
  definition: InterpretableShape,
  marking: GppShapeMarking,
  event: GppShapeEvent,
): GppShapeMarking {
  if (marking.stopped) return marking;
  const graph = buildShapeFlowGraph(definition);
  const work: Work = {
    tokens: marking.tokens.map((token) => ({ ...token })),
    receipts: [...marking.receipts],
    verdicts: { ...marking.verdicts },
    reworkTaken: { ...marking.reworkTaken },
    stopped: null,
  };
  switch (event.type) {
    case "stop": {
      for (const node of graph.nodes.values()) {
        if (node.kind === "stop" && node.stopKind === event.kind) {
          stopAt(work, graph, node.id);
          return freeze(work);
        }
      }
      return marking;
    }
    case "receipt": {
      if (!work.receipts.some((entry) => entry.stageKey === event.stageKey && entry.kind === event.kind)) {
        work.receipts.push({ stageKey: event.stageKey, kind: event.kind });
      }
      break;
    }
    case "gate-verdict": {
      if (definition.stages.some((stage) => stage.key === event.stageKey)) {
        work.verdicts[event.stageKey] = { verdict: event.verdict, mode: event.mode };
      }
      break;
    }
  }
  fireOne(work, graph, definition);
  return freeze(work);
}

/** The stage keys holding a token, in document order. Empty once the instance has stopped. */
export function markedStageKeys(definition: InterpretableShape, marking: GppShapeMarking): string[] {
  return definition.stages
    .filter((stage) => marking.tokens.some((token) => token.node === stageElementId(stage.key)))
    .map((stage) => stage.key);
}
