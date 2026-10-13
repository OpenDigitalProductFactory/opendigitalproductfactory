// apps/web/lib/gpp/shape-language/soundness.ts
//
// Structural soundness, S-1 to S-6. Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §6.1 (the restricted,
// block-structured, 1-safe token game), §6.3 (S-1…S-6), §5 construct 13
// (rework target earlier in the same block, bounded), §7.2 (S-1…S-6 are
// errors); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-2, BI-6DA17863).
//
// `checkSoundness(document)` reads the same flow graph the reference
// interpreter executes (`buildShapeFlowGraph`, which lives in
// lib/work-management/work-shape-flow-graph.ts since Phase 3c so the drive
// reads it too), over the implied sequence or
// the explicit `flow`. Because the flow is block-structured the checks are
// graph walks, not a state-space search (van der Aalst et al., 2011): each is
// a linear pass, and the per-block region walk of S-3 is linear per block.
//
// Each violation is reported ONCE, under the rule that names its root cause,
// on the element where it sits — so a seeded violation yields exactly its rule:
// - S-1 Reachability: a stage or flow node that the flow mentions but no path
//   (forward, rework or refuse route) from the start reaches.
// - S-2 Option to complete: a reachable node that is a dead end — it has no
//   forward edge, so a token there can reach no stop. Nodes upstream of a
//   dead end are explained by it and not reported again. The implied flow's
//   last stage is a dead end when the shape declares no success stop. The
//   "join a sibling branch cannot reach" clause of §6.3 is discharged by the
//   other rules: such a sibling either leaves its block (S-3), dead-ends (S-2
//   at its end) or loops (S-5).
// - S-3 Proper nesting: split/join pairing (`pairs` on the join, exactly one
//   join per split), node degrees (a split has one way in and at least two
//   out, a join at least two in and at most one out, a stage at most one each
//   way — the only choice is a gate verdict, §6.1), no edge leaving or
//   entering a split/join block except through the split and the join, every
//   edge endpoint resolves, no edge leaves a stop, and no node id shadows a
//   stage key.
// - S-4 No dead stage: with an explicit `flow`, a declared stage that no edge
//   mentions — the flow never routes a token to it. (The implied sequence
//   contains every stage.)
// - S-5 Bounded loops: every forward cycle (a cycle with no rework edge);
//   a rework edge, or a `gate.onRefuse` naming a stage, whose target is not
//   earlier in the same block; and a refuse route to a stage with no rework
//   edge carrying `maxIterations`.
// - S-6 Failure and budget exits: delegated to `validateWorkShape`'s rule.
//
// A sequential shape (no `flow`) satisfies S-1, S-3, S-4 and S-5 by
// construction, and S-2 when it declares a success stop.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import { validateWorkShape } from "@/lib/work-management/work-shapes";

import { toJsonPointer, sortDiagnostics, type GppDiagnostic } from "./diagnostics";
import { gateElementId, shapeElementId } from "./element-ids";
import type { GppShapeDocument } from "./gpp-shape-schema";
import { buildShapeFlowGraph, forwardReach, type GppFlowEdge, type GppFlowGraph } from "@/lib/work-management/work-shape-flow-graph";

type SoundnessRule = "S-1" | "S-2" | "S-3" | "S-4" | "S-5" | "S-6";
type Segment = string | number;

function finding(rule: SoundnessRule, elementId: string, path: readonly Segment[], message: string): GppDiagnostic {
  return { rule, code: rule, severity: "error", elementId, path: toJsonPointer(path), message };
}

function nodePath(graph: GppFlowGraph, id: string): Segment[] {
  const node = graph.nodes.get(id);
  if (!node) return [];
  if (node.kind === "stage") return ["stages", node.index];
  if (node.kind === "stop") return ["stopConditions", node.index];
  return ["flow", "nodes", node.index];
}

function edgePath(edge: GppFlowEdge): Segment[] {
  return edge.index === null ? [] : ["flow", "edges", edge.index];
}

/** The forward edge from → to, for reporting a cycle on it. */
function forwardEdge(graph: GppFlowGraph, from: string, to: string): GppFlowEdge | undefined {
  return graph.edges.find((edge) => !edge.rework && edge.from === from && edge.to === to);
}

/** S-3. Returns, for each node, the splits whose block encloses it (for S-5's same-block test). */
function checkStructure(document: GppShapeDocument, graph: GppFlowGraph, out: GppDiagnostic[]): Map<string, string[]> {
  const enclosing = new Map<string, string[]>();
  const flow = document.flow;
  if (!flow) return enclosing;

  const stageKeys = new Set(document.stages.map((stage) => stage.key));
  const seenNodeIds = new Set<string>();
  const splitIds = new Set(flow.nodes.filter((node) => node.type === "parallel-split").map((node) => node.id));
  const joinsBySplit = new Map<string, string[]>();
  flow.nodes.forEach((node, index) => {
    const id = `node:${node.id}`;
    const path = ["flow", "nodes", index];
    if (stageKeys.has(node.id)) out.push(finding("S-3", id, path, `Flow node "${node.id}" has the same id as a stage, so an edge naming it is ambiguous.`));
    if (seenNodeIds.has(node.id)) out.push(finding("S-3", id, path, `Flow node id "${node.id}" is declared twice.`));
    seenNodeIds.add(node.id);
    if (node.type === "parallel-split") {
      if (node.pairs !== undefined) out.push(finding("S-3", id, [...path, "pairs"], `Split "${node.id}" declares "pairs"; the pairing is declared on its join.`));
      return;
    }
    if (node.pairs === undefined) {
      out.push(finding("S-3", id, path, `Join "${node.id}" does not name the split it pairs.`));
    } else if (!splitIds.has(node.pairs)) {
      out.push(finding("S-3", id, [...path, "pairs"], `Join "${node.id}" pairs "${node.pairs}", which is not a parallel split.`));
    } else {
      const joins = joinsBySplit.get(node.pairs) ?? [];
      if (joins.length > 0) out.push(finding("S-3", id, [...path, "pairs"], `Split "${node.pairs}" is already paired by join "${joins[0]}".`));
      joinsBySplit.set(node.pairs, [...joins, node.id]);
    }
  });
  flow.nodes.forEach((node, index) => {
    if (node.type === "parallel-split" && !joinsBySplit.has(node.id)) {
      out.push(finding("S-3", `node:${node.id}`, ["flow", "nodes", index], `Split "${node.id}" has no join that pairs it.`));
    }
  });

  for (const edge of graph.edges) {
    if (edge.from === null) out.push(finding("S-3", edge.elementId, [...edgePath(edge), "from"], `Edge source "${edge.fromRef}" names no stage, flow node or stop.`));
    if (edge.to === null) out.push(finding("S-3", edge.elementId, [...edgePath(edge), "to"], `Edge target "${edge.toRef}" names no stage, flow node or stop.`));
    if (edge.from !== null && graph.nodes.get(edge.from)?.kind === "stop") {
      out.push(finding("S-3", edge.elementId, [...edgePath(edge), "from"], `Edge leaves stop "${edge.fromRef}"; a stop ends the instance.`));
    }
  }

  for (const node of graph.nodes.values()) {
    const inDegree = graph.predecessors.get(node.id)?.length ?? 0;
    const outDegree = graph.successors.get(node.id)?.length ?? 0;
    const path = nodePath(graph, node.id);
    if (node.kind === "parallel-split" && (inDegree !== 1 || outDegree < 2)) {
      out.push(finding("S-3", node.id, path, `A split needs exactly one incoming and at least two outgoing edges; it has ${inDegree} and ${outDegree}.`));
    } else if (node.kind === "parallel-join" && (inDegree < 2 || outDegree > 1)) {
      out.push(finding("S-3", node.id, path, `A join needs at least two incoming edges and at most one outgoing; it has ${inDegree} and ${outDegree}.`));
    } else if (node.kind === "stage" && (inDegree > 1 || outDegree > 1)) {
      out.push(finding("S-3", node.id, path, `A stage has at most one incoming and one outgoing edge (only a split branches); it has ${inDegree} and ${outDegree}.`));
    }
  }

  // Block regions: everything forward-reachable from the split before its join.
  flow.nodes.forEach((node) => {
    if (node.type !== "parallel-join" || node.pairs === undefined || joinsBySplit.get(node.pairs)?.[0] !== node.id) return;
    const split = `node:${node.pairs}`;
    const join = `node:${node.id}`;
    const reach = forwardReach(graph, graph.successors.get(split) ?? [], new Set([join, split]));
    if (!reach.has(join)) return;
    // The block is what the split reaches before its join, minus what lies after the join, minus stops
    // (a stop is never inside a block: reaching one from a branch leaves the block).
    const after = forwardReach(graph, graph.successors.get(join) ?? []);
    const region = new Set(
      [...reach].filter((id) => id !== join && id !== split && !after.has(id) && graph.nodes.get(id)?.kind !== "stop"),
    );
    for (const id of region) enclosing.set(id, [...(enclosing.get(id) ?? []), split]);
    for (const edge of graph.edges) {
      if (edge.rework || edge.from === null || edge.to === null) continue;
      if (region.has(edge.from) && !region.has(edge.to) && edge.to !== join) {
        out.push(finding("S-3", edge.elementId, edgePath(edge), `Edge leaves the block of split "${node.pairs}" other than through its join "${node.id}".`));
      } else if (!region.has(edge.from) && edge.from !== split && (region.has(edge.to) || edge.to === join)) {
        out.push(finding("S-3", edge.elementId, edgePath(edge), `Edge enters the block of split "${node.pairs}" other than through the split.`));
      }
    }
  });
  return enclosing;
}

function sameBlock(enclosing: Map<string, string[]>, left: string, right: string): boolean {
  const a = [...(enclosing.get(left) ?? [])].sort().join("\0");
  const b = [...(enclosing.get(right) ?? [])].sort().join("\0");
  return a === b;
}

/** Every structural soundness finding for a schema-valid document, in diagnostic order. */
export function checkSoundness(document: GppShapeDocument): GppDiagnostic[] {
  const graph = buildShapeFlowGraph(document);
  const out: GppDiagnostic[] = [];

  // S-3 first: the same-block test of S-5 needs its regions.
  const enclosing = checkStructure(document, graph, out);

  // Refuse routes, for S-1's reach and for S-5.
  const refuseTargets = new Map<string, string | null>();
  document.stages.forEach((stage) => {
    const gate = stage.advance.kind === "governed-decision" ? stage.advance.gate : undefined;
    if (gate?.onRefuse !== undefined) refuseTargets.set(`stage:${stage.key}`, graph.resolveRef(gate.onRefuse));
  });

  // Reach over every edge kind: forward, rework, refuse route.
  const reached = new Set<string>();
  const queue = graph.start ? [graph.start] : [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (reached.has(id)) continue;
    reached.add(id);
    const next = [
      ...(graph.successors.get(id) ?? []),
      ...(graph.reworkFrom.get(id) ?? []).map((edge) => edge.to as string),
    ];
    const refuse = refuseTargets.get(id);
    if (refuse) next.push(refuse);
    for (const target of next) if (!reached.has(target)) queue.push(target);
  }

  // Which stages an explicit flow mentions.
  const mentioned = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from) mentioned.add(edge.from);
    if (edge.to) mentioned.add(edge.to);
  }
  const unresolvedOut = new Set(graph.edges.filter((edge) => edge.from !== null && edge.to === null).map((edge) => edge.from as string));

  for (const node of graph.nodes.values()) {
    if (node.kind === "stop") continue;
    const path = nodePath(graph, node.id);
    if (node.kind === "stage" && graph.explicit && !mentioned.has(node.id)) {
      out.push(finding("S-4", node.id, path, `Stage "${node.stageKey}" is declared but no flow edge mentions it, so it can never hold a token.`));
      continue;
    }
    if (!reached.has(node.id)) {
      out.push(finding("S-1", node.id, path, `No path from the start stage reaches ${node.id}.`));
      continue;
    }
    const deadEnd = (graph.successors.get(node.id)?.length ?? 0) === 0 && !unresolvedOut.has(node.id);
    if (!deadEnd) continue;
    if (graph.impliedTerminal === node.id) {
      out.push(finding("S-2", node.id, path, `The shape declares no success stop, so the last stage "${node.stageKey}" has no exit to one.`));
    } else {
      out.push(finding("S-2", node.id, path, `${node.id} has no forward edge, so a token there can reach no stop.`));
    }
  }

  // S-5 (a): forward cycles. Iterative DFS from the start, then every other node in order.
  const colour = new Map<string, 1 | 2>();
  const roots = [...(graph.start ? [graph.start] : []), ...graph.nodes.keys()];
  for (const root of roots) {
    if (colour.has(root)) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: root, next: 0 }];
    colour.set(root, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as { id: string; next: number };
      const successors = graph.successors.get(frame.id) ?? [];
      if (frame.next >= successors.length) {
        colour.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const target = successors[frame.next] as string;
      frame.next += 1;
      const state = colour.get(target);
      if (state === 1) {
        const edge = forwardEdge(graph, frame.id, target);
        if (edge) out.push(finding("S-5", edge.elementId, edgePath(edge), `Cycle through ${target} has no rework edge with maxIterations, so it is unbounded.`));
      } else if (state === undefined) {
        colour.set(target, 1);
        stack.push({ id: target, next: 0 });
      }
    }
  }

  // S-5 (b): explicit rework edges go back, within their block.
  for (const edge of graph.edges) {
    if (!edge.rework || edge.from === null || edge.to === null) continue;
    if (!forwardReach(graph, [edge.to]).has(edge.from)) {
      out.push(finding("S-5", edge.elementId, edgePath(edge), `Rework target "${edge.toRef}" is not earlier than "${edge.fromRef}".`));
    } else if (!sameBlock(enclosing, edge.from, edge.to)) {
      out.push(finding("S-5", edge.elementId, edgePath(edge), `Rework edge leaves its block; its target must be in the same block.`));
    }
  }

  // S-5 (c): refuse routes name a stop, or an earlier stage in the same block through a bounded rework edge.
  document.stages.forEach((stage, index) => {
    const gate = stage.advance.kind === "governed-decision" ? stage.advance.gate : undefined;
    if (gate?.onRefuse === undefined) return;
    const source = `stage:${stage.key}`;
    const id = gateElementId(stage.key);
    const path = ["stages", index, "advance", "gate", "onRefuse"];
    const target = graph.resolveRef(gate.onRefuse);
    const targetNode = target === null ? undefined : graph.nodes.get(target);
    if (!targetNode) {
      out.push(finding("S-5", id, path, `onRefuse "${gate.onRefuse}" names no stop or stage.`));
      return;
    }
    if (targetNode.kind === "stop") return;
    if (targetNode.kind !== "stage") {
      out.push(finding("S-5", id, path, `onRefuse "${gate.onRefuse}" must name a stop or an earlier stage.`));
      return;
    }
    if (!forwardReach(graph, [targetNode.id]).has(source)) {
      out.push(finding("S-5", id, path, `onRefuse "${gate.onRefuse}" is not earlier than "${stage.key}".`));
      return;
    }
    if (!sameBlock(enclosing, source, targetNode.id)) {
      out.push(finding("S-5", id, path, `onRefuse "${gate.onRefuse}" leaves the block "${stage.key}" is in.`));
      return;
    }
    const bounded = (graph.reworkFrom.get(source) ?? []).some((edge) => edge.to === targetNode.id);
    if (!bounded) {
      out.push(finding("S-5", id, path, `onRefuse "${gate.onRefuse}" has no rework edge with maxIterations, so the loop is unbounded.`));
    }
  });

  // S-6: delegated to the runtime's own conformance rule.
  const shapeId = shapeElementId(document.key, document.version);
  for (const issue of validateWorkShape(document)) {
    if (issue.includes(": no failure exit") || issue.includes(": no budget stop")) {
      out.push(finding("S-6", shapeId, ["stopConditions"], issue));
    }
  }

  return sortDiagnostics(out);
}
