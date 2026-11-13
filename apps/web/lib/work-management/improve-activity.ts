// The standard improve activity every work shape carries (BI-CE564FBB, epic
// EP-C00F61F4; spec docs/superpowers/specs/2026-10-28-harness-evolution-loop-design.md,
// "Continual improvement as a standing operation").
//
// Continual improvement is how a room operates, not an extra activity a room
// opts into. So the improve activity belongs to the SHAPE, and a room inherits
// it from the shape it declares. It is resolved by the registry from the
// shape's family (work-shapes.ts) rather than written into ~60 literals: the
// activity is the same core in every room (one loop, layered), it sits outside
// the binding contract so no shape version bumps and no live room rebinds, and
// a new shape carries it the day it is registered (WWMD DI-D7C2BBE33693).
//
// What it is, in ITIL 4 Continual Improvement / DMAIC terms:
// - Define/Measure: the room's misses from every executor are recorded as
//   deterministic code (harness-evolution slice 1, room-candidates.ts).
// - Analyze: the operating criteria (lib/continual-improvement/operating-criteria.ts)
//   decide whether a miss is worth working; LLM judgement runs only then.
// - Improve: the room's own Process Overseer (its `coordinator`, BI-3913EB49)
//   executes an approved edit. No second overseer is created.
// - Control: control limits per miss key and room; common cause gets no edits.
// The Continual Improvement Manager (AGT-908) owns the register and the criteria.
//
// Pure declarations and validation.

import type { DecisionScope } from "@dpf/validators/decision-scopes";

export const IMPROVE_ACTIVITY_VERSION = "1.0.0";

/** AGT-908, the cross-cutting owner of the CI register (WWMD DI-942BE30F1B00). */
export const CONTINUAL_IMPROVEMENT_MANAGER_AGENT_ID = "continual-improvement-manager";
export const CONTINUAL_IMPROVEMENT_MANAGER_REF = `agent:${CONTINUAL_IMPROVEMENT_MANAGER_AGENT_ID}`;

/** The daily typed job that runs every room's improve activity (harness-evolution-loop-config.ts). */
export const IMPROVE_ACTIVITY_AGGREGATOR_TASK_ID = "harness-evolution-loop-daily";

/** Every kind of executor a room's misses come from (BI-2C73B434). */
export const IMPROVE_ACTIVITY_EXECUTORS = ["claude", "codex", "grok", "build-studio", "coworker", "human"] as const;
export type ImproveActivityExecutor = (typeof IMPROVE_ACTIVITY_EXECUTORS)[number];

/**
 * The layer a shape's improvements belong to. Ring 0 is platform development
 * and comes first; the others sit on top of the same core and differ only in
 * the scope whose doctrine decides an edit.
 */
export type ImproveLayer =
  | "ring-0"
  | "platform-operations"
  | "assurance"
  | "orchestration"
  | "business-operations"
  | "craft";

const LAYER_DECISION_SCOPE: Record<ImproveLayer, DecisionScope> = {
  "ring-0": "wwmd",
  "platform-operations": "wwmd",
  assurance: "wwmd",
  orchestration: "wwmd",
  "business-operations": "wwwd",
  craft: "wsid",
};

export type WorkShapeImproveActivity = {
  key: "improve";
  version: string;
  layer: ImproveLayer;
  /** The scope whose doctrine decides an edit to this shape's harness. */
  decisionScope: DecisionScope;
  /** Deterministic code by default. */
  mode: "deterministic";
  /** Model judgement only for a miss the operating criteria select. */
  judgement: "criteria-gated";
  ownerPrincipalRef: string;
  /** The room participant role that executes an approved edit: its Process Overseer. */
  executorRole: "coordinator";
  executors: readonly ImproveActivityExecutor[];
  signals: readonly ("tool-failure" | "miss-activity" | "flow-bottleneck")[];
  /** Control-chart metrics, per miss key and room. */
  controlMetrics: readonly ("misses-per-run" | "human-touches-per-run" | "refusals-per-success")[];
  criteriaModule: "continual-improvement/operating-criteria";
  aggregatorTaskId: string;
};

export function improveActivityFor(layer: ImproveLayer): WorkShapeImproveActivity {
  return {
    key: "improve",
    version: IMPROVE_ACTIVITY_VERSION,
    layer,
    decisionScope: LAYER_DECISION_SCOPE[layer],
    mode: "deterministic",
    judgement: "criteria-gated",
    ownerPrincipalRef: CONTINUAL_IMPROVEMENT_MANAGER_REF,
    executorRole: "coordinator",
    executors: IMPROVE_ACTIVITY_EXECUTORS,
    signals: ["tool-failure", "miss-activity", "flow-bottleneck"],
    controlMetrics: ["misses-per-run", "human-touches-per-run", "refusals-per-success"],
    criteriaModule: "continual-improvement/operating-criteria",
    aggregatorTaskId: IMPROVE_ACTIVITY_AGGREGATOR_TASK_ID,
  };
}

/** Problems with a declaration; empty when it is the standard activity or a valid narrowing of it. */
export function validateImproveActivity(activity: WorkShapeImproveActivity): string[] {
  const issues: string[] = [];
  if (activity.key !== "improve") issues.push("key must be improve");
  if (!/^\d+\.\d+\.\d+$/.test(activity.version)) issues.push("version must be semver");
  if (!(activity.layer in LAYER_DECISION_SCOPE)) issues.push(`unknown layer ${activity.layer}`);
  if (activity.mode !== "deterministic") issues.push("improvement cannot be turned off or made model-first");
  if (activity.judgement !== "criteria-gated") issues.push("model judgement must be gated by the operating criteria");
  if (activity.ownerPrincipalRef !== CONTINUAL_IMPROVEMENT_MANAGER_REF) {
    issues.push("the CI register is owned by the Continual Improvement Manager, not a person or another coworker");
  }
  if (activity.executorRole !== "coordinator") issues.push("edits are executed by the room's own Process Overseer");
  const missing = IMPROVE_ACTIVITY_EXECUTORS.filter((executor) => !activity.executors.includes(executor));
  if (missing.length) issues.push(`misses from ${missing.join(", ")} would go unrecorded`);
  if (activity.signals.length === 0) issues.push("no signal source");
  if (activity.controlMetrics.length === 0) issues.push("no control metric");
  return issues;
}
