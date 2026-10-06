// apps/web/lib/gpp/shape-language/constructs-used-by.ts
//
// Which gated constructs a definition uses, with the element each sits on
// (BI-8875C9DF, GPP Phase 3c PR-3c-1). Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §7.1; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-1, "constructsUsedBy").
//
// ONE WALK, TWO READERS. The DRC's E-NOT-EXECUTABLE check (drc.ts) runs this
// over `lowerToDefinition(document)`, and the drive (drive-resolution-graph.ts)
// runs it over the definition contract it already holds. Each reader then
// asks CONSTRUCT_EXECUTABLE (executable-constructs.ts) whether the construct
// is on, so the compiler and the runtime cannot disagree about what a shape
// uses.
//
// The walk covers exactly the elements the DRC checked before Phase 3c:
// `gate.onRefuse` (rework-edge, on the gate), `stage.deadline`
// (stage-deadline, on the stage), `stage.subShape` (sub-shape, on the stage),
// each flow split or join (parallel-split-join; a join that pairs an existing
// split is not reported again) and each `flow.edges[].rework` (rework-edge, on
// the edge). A plain flow edge uses no gated construct.
//
// It lives beside executable-constructs.ts rather than inside it because
// element-ids.ts imports diagnostics.ts, which imports executable-constructs.ts
// at module evaluation: putting the walk in the table's own module would make
// a runtime import cycle.

import type { WorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";

import { flowEdgeElementId, flowNodeElementId, gateElementId, stageElementId } from "./element-ids";
import type { GppConstruct } from "./executable-constructs";

/** One gated construct a definition uses. `path` is the element's JSON path in the definition (and its document). */
export type ConstructUse = {
  construct: GppConstruct;
  elementId: string;
  path: ReadonlyArray<string | number>;
  /** What the definition says, in one sentence. */
  detail: string;
};

/** The part of a definition the walk reads. The contract and a lowered document both satisfy it. */
export type ConstructWalkable = Pick<WorkShapeDefinitionContract, "stages" | "flow">;

/** Every gated construct the definition uses, stages first (in stage order), then flow nodes and edges. */
export function constructsUsedBy(definition: ConstructWalkable): ConstructUse[] {
  const uses: ConstructUse[] = [];
  definition.stages.forEach((stage, index) => {
    const base = ["stages", index] as const;
    if (stage.advance.kind === "governed-decision" && stage.advance.gate?.onRefuse !== undefined) {
      uses.push({
        construct: "rework-edge",
        elementId: gateElementId(stage.key),
        path: [...base, "advance", "gate", "onRefuse"],
        detail: `gate:${stage.key} routes a refusal to "${stage.advance.gate.onRefuse}".`,
      });
    }
    if (stage.deadline) {
      uses.push({
        construct: "stage-deadline",
        elementId: stageElementId(stage.key),
        path: [...base, "deadline"],
        detail: `Stage "${stage.key}" declares a deadline.`,
      });
    }
    if (stage.subShape !== undefined) {
      uses.push({
        construct: "sub-shape",
        elementId: stageElementId(stage.key),
        path: [...base, "subShape"],
        detail: `Stage "${stage.key}" calls sub-shape "${stage.subShape}".`,
      });
    }
  });
  const flow = definition.flow;
  if (flow) {
    const splitIds = new Set(flow.nodes.filter((node) => node.type === "parallel-split").map((node) => node.id));
    flow.nodes.forEach((node, index) => {
      // One use per split; a join reports only when it pairs no split (a lone join).
      if (node.type === "parallel-join" && node.pairs !== undefined && splitIds.has(node.pairs)) return;
      uses.push({
        construct: "parallel-split-join",
        elementId: flowNodeElementId(node.id),
        path: ["flow", "nodes", index],
        detail: `Flow node "${node.id}" is a ${node.type}.`,
      });
    });
    flow.edges.forEach((edge, index) => {
      if (!edge.rework) return;
      uses.push({
        construct: "rework-edge",
        elementId: flowEdgeElementId(edge.from, edge.to),
        path: ["flow", "edges", index, "rework"],
        detail: `Edge ${edge.from} -> ${edge.to} is a rework edge (at most ${edge.rework.maxIterations}).`,
      });
    });
  }
  return uses;
}
