// Sub-shape fixtures for the GPP Phase 3c drive tests (BI-8875C9DF, PR-3c-5).
// Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §6.4, §9; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-5, Tests).
//
// None of these is registered (plan constraint 7). Each passes checkSoundness
// with zero findings (drive-parity-sub-shape.test.ts asserts it). The child
// they call is the two-stage SEQUENTIAL_TWIN's ref; the drive never resolves
// it (the room holding the child resolves its own claim), so these fixtures
// need no registered child.

import type { WorkShapeDefinition, WorkShapeStage } from "../../work-shapes";
import { SEQUENTIAL_TWIN } from "../graph-shape-fixtures";

/** The child every fixture calls: a two-stage shape (a → b). */
export const CHILD_REF = "graph-fixture@1.0.0" as const;

function agentStage(key: string): WorkShapeStage {
  return {
    key,
    title: `Stage ${key}`,
    accountablePrincipalRef: "agent:graph-worker",
    advance: { kind: "status-change", condition: `${key} done` },
    evidence: ["assurance-run"],
  };
}

function subShapeStage(key: string): WorkShapeStage {
  return { ...agentStage(key), title: `Run child ${key}`, evidence: ["child-completion"], subShape: CHILD_REF };
}

/** a → b (calls the two-stage child) → c → success. */
export const SUB_SEQ: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-sub-seq",
  stages: [agentStage("a"), subShapeStage("b"), agentStage("c")],
};

/** a → p → (b [calls the child], c) → j → d → success: a sub-shape inside a parallel branch. */
export const SUB_IN_BRANCH: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-sub-in-branch",
  stages: [agentStage("a"), subShapeStage("b"), agentStage("c"), agentStage("d")],
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

/**
 * a → b (calls the child) → decide → success; decide's enforced gate sends a
 * refusal back over its rework edge decide → a, at most once: a rework across
 * the sub-shape stage, which starts a new pass and so a new child.
 */
export const SUB_IN_REWORK: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-sub-in-rework",
  stages: [
    agentStage("a"),
    subShapeStage("b"),
    {
      key: "decide",
      title: "Decide",
      accountablePrincipalRef: "role:owner",
      advance: {
        kind: "governed-decision",
        condition: "The owner accepts or sends back.",
        decisionScope: "graph-fixture-scope",
        gate: { authority: "wwmd", mode: "enforced", blocking: true, resolution: "accountable-human" },
      },
      evidence: ["decision-record"],
    },
  ],
  flow: { nodes: [], edges: [{ from: "a", to: "b" }, { from: "b", to: "decide" }, { from: "decide", to: "success" }, { from: "decide", to: "a", rework: { maxIterations: 1 } }] },
};

export const SUB_SHAPE_PARITY_FIXTURES: readonly WorkShapeDefinition[] = [SUB_SEQ, SUB_IN_BRANCH];
