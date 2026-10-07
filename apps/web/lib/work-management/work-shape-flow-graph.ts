// apps/web/lib/work-management/work-shape-flow-graph.ts
//
// The flow graph of a work shape: one graph for the drive, the reference
// interpreter and the soundness rules (BI-8875C9DF, GPP Phase 3c PR-3c-1).
// Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §3 ("Shared flow
// graph") and §6 ("Two implementations, one graph"); plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-1).
//
// MOVED, NOT REWRITTEN, from apps/web/lib/gpp/shape-language/interpreter.ts
// (PR-3b-2), so the drive's token step (drive-marking.ts) can read the graph
// without importing the compiler. interpreter.ts re-exports every moved name,
// so existing imports compile unchanged, and soundness.ts imports from here.
//
// The only import is element-ids.ts, whose runtime dependencies are
// diagnostics.ts and executable-constructs.ts: plain constants and helpers, no
// schema, resolver or design rule.
//
// Flow references. An edge endpoint (and `gate.onRefuse`) names a stage key, a
// flow node id, a stop element id (`stop:<kind>:<n>`, element-ids.ts), or a
// stop kind (`success` | `failure` | `budget`, meaning the first stop of that
// kind). A stage key wins over a node id or stop kind spelled the same. Without
// `flow`, the flow is the implied sequence stages[0] → … → stages[n-1] → first
// success stop; when no success stop is declared the last stage completes the
// instance anyway (as `nextStageKey` does).

import { flowEdgeElementId, flowNodeElementId, stageElementId, stopElementId } from "@/lib/gpp/shape-language/element-ids";

export type GppGateMode = "shadow" | "enforced";

export type InterpretableGate = {
  readonly mode: GppGateMode;
  readonly blocking: boolean;
  readonly onRefuse?: string;
};

/**
 * The part of a shape the token game reads. A WorkShapeDefinition (registry),
 * a WorkShapeDefinitionContract (what the drive reads) and a GppShapeDocument
 * are all assignable to it.
 */
export type InterpretableShape = {
  readonly stages: ReadonlyArray<{
    readonly key: string;
    readonly advance: { readonly kind: "status-change" | "governed-decision"; readonly gate?: InterpretableGate };
  }>;
  readonly stopConditions: ReadonlyArray<{ readonly kind: "success" | "failure" | "budget"; readonly disposition: string }>;
  readonly flow?: {
    readonly nodes: ReadonlyArray<{ readonly id: string; readonly type: "parallel-split" | "parallel-join"; readonly pairs?: string }>;
    readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string; readonly rework?: { readonly maxIterations: number } }>;
  };
};

// ── flow graph (shared with soundness.ts) ───────────────────────────────────

export type GppFlowNodeKind = "stage" | "parallel-split" | "parallel-join" | "stop";

export type GppFlowNode = {
  /** The node's §9.1 element id; tokens and the graph are keyed by it. */
  id: string;
  kind: GppFlowNodeKind;
  /** Index in `stages`, `flow.nodes` or `stopConditions`. */
  index: number;
  stageKey?: string;
  pairs?: string;
  stopKind?: "success" | "failure" | "budget";
  disposition?: string;
};

export type GppFlowEdge = {
  /** `edge:<from>-><to>` over the refs as written; implied edges use stage keys and the stop element id. */
  elementId: string;
  /** Index in `flow.edges`, or null for an implied edge. */
  index: number | null;
  fromRef: string;
  toRef: string;
  /** Resolved element ids; null when the ref names nothing. */
  from: string | null;
  to: string | null;
  rework: { maxIterations: number } | null;
};

export type GppFlowGraph = {
  explicit: boolean;
  /** Element id of stages[0], or null for a shape with no stages. */
  start: string | null;
  /** Every node, in order: stages, flow nodes, stops. */
  nodes: Map<string, GppFlowNode>;
  edges: GppFlowEdge[];
  /** Forward (non-rework, resolved) successors and predecessors, in edge order. */
  successors: Map<string, string[]>;
  predecessors: Map<string, string[]>;
  /** Resolved rework edges, by source. */
  reworkFrom: Map<string, GppFlowEdge[]>;
  /** The implied flow's last stage when no success stop exists: it completes the instance. */
  impliedTerminal: string | null;
  resolveRef(ref: string): string | null;
};

const STOP_REF = /^stop:(success|failure|budget):([1-9]\d*)$/;
const STOP_KINDS = ["success", "failure", "budget"] as const;

/** Build the node/edge graph of a shape: the explicit `flow` when present, else the implied sequence. */
export function buildShapeFlowGraph(definition: InterpretableShape): GppFlowGraph {
  const nodes = new Map<string, GppFlowNode>();
  const stageIdsByKey = new Map<string, string>();
  definition.stages.forEach((stage, index) => {
    const id = stageElementId(stage.key);
    if (!nodes.has(id)) nodes.set(id, { id, kind: "stage", index, stageKey: stage.key });
    if (!stageIdsByKey.has(stage.key)) stageIdsByKey.set(stage.key, id);
  });
  const flowNodeIds = new Map<string, string>();
  definition.flow?.nodes.forEach((node, index) => {
    const id = flowNodeElementId(node.id);
    if (!nodes.has(id)) {
      nodes.set(id, { id, kind: node.type, index, ...(node.pairs !== undefined ? { pairs: node.pairs } : {}) });
    }
    if (!flowNodeIds.has(node.id)) flowNodeIds.set(node.id, id);
  });
  const ordinals = new Map<string, number>();
  const firstStopOfKind = new Map<string, string>();
  definition.stopConditions.forEach((stop, index) => {
    const ordinal = (ordinals.get(stop.kind) ?? 0) + 1;
    ordinals.set(stop.kind, ordinal);
    const id = stopElementId(stop.kind, ordinal);
    nodes.set(id, { id, kind: "stop", index, stopKind: stop.kind, disposition: stop.disposition });
    if (!firstStopOfKind.has(stop.kind)) firstStopOfKind.set(stop.kind, id);
  });

  const resolveRef = (ref: string): string | null => {
    const stage = stageIdsByKey.get(ref);
    if (stage) return stage;
    const flowNode = flowNodeIds.get(ref);
    if (flowNode) return flowNode;
    if (STOP_REF.test(ref)) return nodes.has(ref) ? ref : null;
    if ((STOP_KINDS as readonly string[]).includes(ref)) return firstStopOfKind.get(ref) ?? null;
    return null;
  };

  const edges: GppFlowEdge[] = [];
  let impliedTerminal: string | null = null;
  if (definition.flow) {
    definition.flow.edges.forEach((edge, index) => {
      edges.push({
        elementId: flowEdgeElementId(edge.from, edge.to),
        index,
        fromRef: edge.from,
        toRef: edge.to,
        from: resolveRef(edge.from),
        to: resolveRef(edge.to),
        rework: edge.rework ? { maxIterations: edge.rework.maxIterations } : null,
      });
    });
  } else {
    const stages = definition.stages;
    stages.forEach((stage, index) => {
      const next = stages[index + 1];
      if (next) {
        edges.push({
          elementId: flowEdgeElementId(stage.key, next.key),
          index: null,
          fromRef: stage.key,
          toRef: next.key,
          from: stageElementId(stage.key),
          to: stageElementId(next.key),
          rework: null,
        });
        return;
      }
      const success = firstStopOfKind.get("success");
      if (success) {
        edges.push({
          elementId: flowEdgeElementId(stage.key, success),
          index: null,
          fromRef: stage.key,
          toRef: success,
          from: stageElementId(stage.key),
          to: success,
          rework: null,
        });
      } else {
        impliedTerminal = stageElementId(stage.key);
      }
    });
  }

  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  const reworkFrom = new Map<string, GppFlowEdge[]>();
  for (const id of nodes.keys()) {
    successors.set(id, []);
    predecessors.set(id, []);
  }
  for (const edge of edges) {
    if (edge.from === null || edge.to === null) continue;
    if (edge.rework) {
      reworkFrom.set(edge.from, [...(reworkFrom.get(edge.from) ?? []), edge]);
      continue;
    }
    successors.get(edge.from)?.push(edge.to);
    predecessors.get(edge.to)?.push(edge.from);
  }

  const first = definition.stages[0];
  return {
    explicit: Boolean(definition.flow),
    start: first ? stageElementId(first.key) : null,
    nodes,
    edges,
    successors,
    predecessors,
    reworkFrom,
    impliedTerminal,
    resolveRef,
  };
}

/** Node ids forward-reachable from `from` (inclusive), never expanding `barrier`. */
export function forwardReach(graph: GppFlowGraph, from: readonly string[], barrier?: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...from];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    if (barrier?.has(id)) continue;
    for (const next of graph.successors.get(id) ?? []) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

/** Node ids that forward-reach `to` (inclusive). */
export function backwardReach(graph: GppFlowGraph, to: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...to];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const previous of graph.predecessors.get(id) ?? []) if (!seen.has(previous)) queue.push(previous);
  }
  return seen;
}
