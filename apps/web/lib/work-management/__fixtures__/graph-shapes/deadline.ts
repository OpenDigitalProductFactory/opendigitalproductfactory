// Stage-deadline fixtures for the GPP Phase 3c drive tests (BI-8875C9DF,
// PR-3c-4). Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §6.3, §8; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-4, Tests).
//
// None of these is registered (plan constraint 7). Each passes checkSoundness
// with zero findings: a deadline is non-interrupting, so it adds no way out
// of a stage (drive-parity-deadline.test.ts asserts it).
//
// Every deadline is two days (afterDays 2). Until BI-086DC167 these were six
// hours, because the drive discarded a graph marking at every UTC midnight so
// only a deadline inside the day could come due. A marking is now one run that
// crosses calendar boundaries, so the fixtures use a multi-day deadline.

import type { WorkShapeDefinition, WorkShapeStage } from "../../work-shapes";
import { SEQUENTIAL_TWIN } from "../graph-shape-fixtures";
import { PARALLEL_PARITY_FIXTURES } from "./parallel";

export const TWO_DAYS: NonNullable<WorkShapeStage["deadline"]> = { afterDays: 2, description: "Two days." };

/** The fixture with the same deadline on every stage, under its own key. */
export function withDeadlines(shape: WorkShapeDefinition): WorkShapeDefinition {
  return { ...shape, key: `${shape.key}-deadlines`, stages: shape.stages.map((stage) => ({ ...stage, deadline: TWO_DAYS })) };
}

function agentStage(key: string): WorkShapeStage {
  return {
    key,
    title: `Stage ${key}`,
    accountablePrincipalRef: "agent:graph-worker",
    advance: { kind: "status-change", condition: `${key} done` },
    evidence: ["assurance-run"],
  };
}

/** a → b → c → success, sequential, with one deadline on b: it runs on the graph path because it declares one. */
export const DEADLINE_SEQ: WorkShapeDefinition = {
  ...SEQUENTIAL_TWIN,
  key: "graph-fixture-deadline-seq",
  stages: [agentStage("a"), { ...agentStage("b"), deadline: TWO_DAYS }, agentStage("c")],
};

/** The deadline parity fixtures: the PR-3c-2 parallel fixtures with deadlines on every stage, and deadline-seq. */
export const DEADLINE_PARITY_FIXTURES: readonly WorkShapeDefinition[] = [...PARALLEL_PARITY_FIXTURES.map(withDeadlines), DEADLINE_SEQ];
