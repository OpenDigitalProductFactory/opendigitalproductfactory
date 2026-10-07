// Parallel split/join fixtures for the GPP Phase 3c drive tests (BI-8875C9DF,
// PR-3c-2). Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §6.1 ("Parity
// test"); plan: docs/superpowers/plans/
// 2026-10-02-gpp-phase-3c-drive-graph-execution.md (PR-3c-2, Tests).
//
// None of these is registered: no registry shape uses a graph construct until
// a consuming PR adopts one (plan constraint 7; R2D, BI-580A970A, is the
// first). Each passes checkSoundness with zero findings
// (drive-parity-parallel.test.ts asserts it).

import type { WorkShapeDefinition, WorkShapeStage } from "../../work-shapes";
import { SEQUENTIAL_TWIN } from "../graph-shape-fixtures";

function agentStage(key: string): WorkShapeStage {
  return {
    key,
    title: `Stage ${key}`,
    accountablePrincipalRef: "agent:graph-worker",
    advance: { kind: "status-change", condition: `${key} done` },
    evidence: ["assurance-run"],
  };
}

function governedStage(key: string): WorkShapeStage {
  return {
    key,
    title: `Decide ${key}`,
    accountablePrincipalRef: "role:owner",
    advance: { kind: "governed-decision", condition: `The owner accepts or defers ${key}.`, decisionScope: "graph-fixture-scope" },
    evidence: ["decision-record"],
  };
}

/** a → split p → (b, c) → join j → d → success. */
export const SPLIT_2: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-split-2",
  stages: ["a", "b", "c", "d"].map(agentStage),
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

/** a → p1 → (b, p2 → (c, d) → j2 → e) → j1 → f → success: a split nested in a branch. */
export const SPLIT_NESTED: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-split-nested",
  stages: ["a", "b", "c", "d", "e", "f"].map(agentStage),
  flow: {
    nodes: [
      { id: "p1", type: "parallel-split" },
      { id: "p2", type: "parallel-split" },
      { id: "j2", type: "parallel-join", pairs: "p2" },
      { id: "j1", type: "parallel-join", pairs: "p1" },
    ],
    edges: [
      { from: "a", to: "p1" },
      { from: "p1", to: "b" },
      { from: "p1", to: "p2" },
      { from: "p2", to: "c" },
      { from: "p2", to: "d" },
      { from: "c", to: "j2" },
      { from: "d", to: "j2" },
      { from: "j2", to: "e" },
      { from: "b", to: "j1" },
      { from: "e", to: "j1" },
      { from: "j1", to: "f" },
      { from: "f", to: "success" },
    ],
  },
};

/** a → p → (review [governed, role:owner], build [agent]) → j → ship → success. */
export const SPLIT_GOVERNED_BRANCH: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-split-governed",
  stages: [agentStage("a"), governedStage("review"), agentStage("build"), agentStage("ship")],
  flow: {
    nodes: [
      { id: "p", type: "parallel-split" },
      { id: "j", type: "parallel-join", pairs: "p" },
    ],
    edges: [
      { from: "a", to: "p" },
      { from: "p", to: "review" },
      { from: "p", to: "build" },
      { from: "review", to: "j" },
      { from: "build", to: "j" },
      { from: "j", to: "ship" },
      { from: "ship", to: "success" },
    ],
  },
};

export const R2D_TARGETS = ["linux", "macos", "windows", "edge"] as const;
const R2D_STEPS = ["plan", "fulfill", "validate", "observe"] as const;

/**
 * The R2D reference room's Deploy fork (BI-580A970A, design §6.1): a deploy
 * stage forks one branch per target (Linux, macOS, Windows, Edge), each
 * plan → fulfill → validate → observe; the branches join, then release.
 */
export const R2D_DEPLOY_FORK: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-r2d-deploy-fork",
  stages: [
    agentStage("deploy"),
    ...R2D_TARGETS.flatMap((target) => R2D_STEPS.map((step) => agentStage(`${target}-${step}`))),
    agentStage("release"),
  ],
  flow: {
    nodes: [
      { id: "fork", type: "parallel-split" },
      { id: "targets-done", type: "parallel-join", pairs: "fork" },
    ],
    edges: [
      { from: "deploy", to: "fork" },
      ...R2D_TARGETS.flatMap((target) => [
        { from: "fork", to: `${target}-plan` },
        ...R2D_STEPS.slice(1).map((step, index) => ({ from: `${target}-${R2D_STEPS[index]}`, to: `${target}-${step}` })),
        { from: `${target}-observe`, to: "targets-done" },
      ]),
      { from: "targets-done", to: "release" },
      { from: "release", to: "success" },
    ],
  },
};

/** a → p → (legal, security), both governed → j → ship → success: two decisions pending at once. */
export const SPLIT_TWO_DECISIONS: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-split-two-decisions",
  stages: [agentStage("a"), governedStage("legal"), governedStage("security"), agentStage("ship")],
  flow: {
    nodes: [
      { id: "p", type: "parallel-split" },
      { id: "j", type: "parallel-join", pairs: "p" },
    ],
    edges: [
      { from: "a", to: "p" },
      { from: "p", to: "legal" },
      { from: "p", to: "security" },
      { from: "legal", to: "j" },
      { from: "security", to: "j" },
      { from: "j", to: "ship" },
      { from: "ship", to: "success" },
    ],
  },
};

/** The four parity fixtures of plan PR-3c-2. */
export const PARALLEL_PARITY_FIXTURES: readonly WorkShapeDefinition[] = [SPLIT_2, SPLIT_NESTED, SPLIT_GOVERNED_BRANCH, R2D_DEPLOY_FORK];
