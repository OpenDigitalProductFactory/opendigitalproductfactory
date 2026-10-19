// Refuse-route and rework-edge fixtures for the GPP Phase 3c drive tests
// (BI-8875C9DF, PR-3c-3). Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §6.2 ("Parity
// test"); plan: docs/superpowers/plans/
// 2026-10-02-gpp-phase-3c-drive-graph-execution.md (PR-3c-3, Tests).
//
// None of these is registered: no registry shape uses a graph construct until
// a consuming PR adopts one (plan constraint 7). Each passes checkSoundness
// with zero findings except REFUSE_BOUND_NO_BUDGET_STOP, which is deliberately
// not S-6-sound (it declares no budget stop) so that a refuse whose bound is
// spent has no route (drive-parity-rework.test.ts asserts both).

import type { WorkShapeDefinition, WorkShapeGate, WorkShapeStage } from "../../work-shapes";
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

const ENFORCED: WorkShapeGate = { authority: "wwmd", mode: "enforced", blocking: true, resolution: "accountable-human" };

function gatedStage(key: string, gate: Partial<WorkShapeGate> = {}, condition = `The owner accepts, defers or sends back ${key}.`): WorkShapeStage {
  return {
    key,
    title: `Decide ${key}`,
    accountablePrincipalRef: "role:owner",
    advance: { kind: "governed-decision", condition, decisionScope: "graph-fixture-scope", gate: { ...ENFORCED, ...gate } },
    evidence: ["decision-record"],
  };
}

/** a → b → success; b's enforced gate sends a refusal back over its single rework edge b → a, at most once. */
export const REWORK_1: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-rework-1",
  stages: [agentStage("a"), gatedStage("b")],
  flow: { nodes: [], edges: [{ from: "a", to: "b" }, { from: "b", to: "success" }, { from: "b", to: "a", rework: { maxIterations: 1 } }] },
};

/** As REWORK_1 with the bound at 2, so a sequence can be driven past it to the budget stop. */
export const REWORK_2_BOUND: WorkShapeDefinition = {
  ...REWORK_1,
  key: "graph-fixture-rework-2-bound",
  flow: { nodes: [], edges: [{ from: "a", to: "b" }, { from: "b", to: "success" }, { from: "b", to: "a", rework: { maxIterations: 2 } }] },
};

/** a → decide → success (the implied sequence); decide's gate refuses to the failure stop. */
export const REFUSE_TO_STOP: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-refuse-to-stop",
  stages: [agentStage("a"), gatedStage("decide", { onRefuse: "failure" })],
};

/**
 * As REWORK_1 but with no budget stop: once the bound is spent a refusal has
 * no route, so the token stays (interpreter.ts routeRefusal returns false).
 * Parity-only and deliberately not S-6-sound (renamed from refuse-no-route).
 */
export const REFUSE_BOUND_NO_BUDGET_STOP: WorkShapeDefinition = {
  ...REWORK_1,
  key: "graph-fixture-refuse-bound-no-budget-stop",
  stopConditions: SEQUENTIAL_TWIN.stopConditions.filter((stop) => stop.kind !== "budget"),
};

/** As REWORK_1, but b's gate is shadow: a refusal is recorded and the token moves on its receipt alone. */
export const SHADOW_GATE: WorkShapeDefinition = {
  ...REWORK_1,
  key: "graph-fixture-shadow-gate",
  stages: [agentStage("a"), gatedStage("b", { mode: "shadow", onRefuse: "a" })],
};

/**
 * a → review → approve → success. review's enforced gate declares a refuse
 * route (onRefuse a, bounded by the rework edge review → a, at most 2), so a
 * `defer` there HOLDS the token (DI-0D9DFB0FC0EF). approve's enforced gate
 * declares none, so it advances on its receipt alone, as today (a `defer`
 * there keeps advancing).
 */
export const DEFER_ON_REFUSE_ROUTE: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-defer-on-refuse-route",
  stages: [agentStage("a"), gatedStage("review", { onRefuse: "a" }), gatedStage("approve", {}, "The owner accepts or defers approve.")],
  flow: {
    nodes: [],
    edges: [
      { from: "a", to: "review" },
      { from: "review", to: "approve" },
      { from: "approve", to: "success" },
      { from: "review", to: "a", rework: { maxIterations: 2 } },
    ],
  },
};

/**
 * a → p → (b1 → b2, c) → j → d → success. b2's enforced gate sends a refusal
 * back to b1, inside the same branch (the same-block rule), at most once; the
 * sibling branch c is untouched by the rework.
 */
export const REWORK_INSIDE_BRANCH: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-rework-inside-branch",
  stages: [agentStage("a"), agentStage("b1"), gatedStage("b2"), agentStage("c"), agentStage("d")],
  flow: {
    nodes: [
      { id: "p", type: "parallel-split" },
      { id: "j", type: "parallel-join", pairs: "p" },
    ],
    edges: [
      { from: "a", to: "p" },
      { from: "p", to: "b1" },
      { from: "b1", to: "b2" },
      { from: "p", to: "c" },
      { from: "b2", to: "j" },
      { from: "c", to: "j" },
      { from: "j", to: "d" },
      { from: "d", to: "success" },
      { from: "b2", to: "b1", rework: { maxIterations: 1 } },
    ],
  },
};

/** The seven parity fixtures of plan PR-3c-3. */
export const REWORK_PARITY_FIXTURES: readonly WorkShapeDefinition[] = [
  REWORK_1,
  REWORK_2_BOUND,
  REFUSE_TO_STOP,
  REFUSE_BOUND_NO_BUDGET_STOP,
  SHADOW_GATE,
  DEFER_ON_REFUSE_ROUTE,
  REWORK_INSIDE_BRANCH,
];
