// Graph-shape fixtures for the GPP Phase 3c drive tests (BI-8875C9DF,
// PR-3c-1). None of these is registered: no registry shape uses a graph
// construct until a consuming PR adopts one (plan constraint 7).

import type { WorkShapeDefinition, WorkShapeStage } from "../work-shapes";

function agentStage(key: string, evidence: WorkShapeStage["evidence"] = ["assurance-run"]): WorkShapeStage {
  return {
    key,
    title: `Stage ${key}`,
    accountablePrincipalRef: "agent:graph-worker",
    advance: { kind: "status-change", condition: `${key} done` },
    evidence,
  };
}

/** A two-agent-stage sequential shape: the twin every flow fixture is compared with. */
export const SEQUENTIAL_TWIN: WorkShapeDefinition = {
  key: "graph-fixture",
  version: "1.0.0",
  title: "Graph fixture",
  description: "A fixture shape for the Phase 3c drive tests.",
  triggers: ["cadence"],
  stages: [agentStage("a"), agentStage("b")],
  stopConditions: [
    { kind: "success", condition: "Both stages are done.", disposition: "proceed" },
    { kind: "failure", condition: "The substrate cannot be read.", disposition: "inconclusive" },
    { kind: "budget", condition: "More than ten runs.", disposition: "awaiting-person" },
  ],
  grants: ["tool:read"],
  measures: [],
  budgets: [{ kind: "cycles-per-window", limit: 10, unit: "cycles" }],
  reviewPoint: { everyDays: 30, description: "Monthly." },
  collaborationShape: null,
};

/** The twin with an explicit flow that says the same thing: a → b → success. Uses no gated construct. */
export const FLOW_TWIN: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-flow",
  flow: { nodes: [], edges: [{ from: "a", to: "b" }, { from: "b", to: "success" }] },
};

/** a → split p → (b, c) → join j → d → success: uses `parallel-split-join`. */
export const PARALLEL_FIXTURE: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-parallel",
  stages: [agentStage("a"), agentStage("b"), agentStage("c"), agentStage("d")],
  flow: {
    nodes: [
      { id: "p", type: "parallel-split" },
      { id: "j", type: "parallel-join", pairs: "p" },
    ],
    edges: [
      { from: "a", to: "p" },
      { from: "p", to: "b" },
      { from: "p", to: "c" },
      { from: "b", to: "j" },
      { from: "c", to: "j" },
      { from: "j", to: "d" },
      { from: "d", to: "success" },
    ],
  },
};

/** The twin with a deadline on stage b: uses `stage-deadline`. */
export const DEADLINE_FIXTURE: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-deadline",
  stages: [agentStage("a"), { ...agentStage("b"), deadline: { afterDays: 2, description: "Two days." } }],
};

/** The twin with a rework edge b → a: uses `rework-edge`. */
export const REWORK_FIXTURE: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-rework",
  flow: { nodes: [], edges: [{ from: "a", to: "b" }, { from: "b", to: "success" }, { from: "b", to: "a", rework: { maxIterations: 2 } }] },
};

/** The twin with stage b calling a sub-shape: uses `sub-shape`. */
export const SUB_SHAPE_FIXTURE: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-sub-shape",
  stages: [agentStage("a"), { ...agentStage("b"), subShape: "graph-fixture@1.0.0" }],
};

/** A governed stage whose gate refuses to the failure stop: uses `rework-edge` (gate.onRefuse). */
export const REFUSE_FIXTURE: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-refuse",
  stages: [
    agentStage("a"),
    {
      key: "decide",
      title: "Decide",
      accountablePrincipalRef: "role:owner",
      advance: {
        kind: "governed-decision",
        condition: "The owner decides.",
        decisionScope: "graph-fixture-scope",
        gate: { authority: "wwmd", mode: "enforced", blocking: true, resolution: "accountable-human", onRefuse: "failure" },
      },
      evidence: ["decision-record"],
    },
  ],
};

export const GRAPH_FIXTURES: readonly WorkShapeDefinition[] = [
  FLOW_TWIN,
  PARALLEL_FIXTURE,
  DEADLINE_FIXTURE,
  REWORK_FIXTURE,
  SUB_SHAPE_FIXTURE,
  REFUSE_FIXTURE,
];
