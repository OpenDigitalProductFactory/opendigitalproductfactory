/**
 * Readiness review gates as room drive review stages (BI-2C8750FC, EP-4614F35E).
 *
 * Design: docs/superpowers/specs/2026-09-02-proactive-review-drive-design.md
 * ("Design — connect the gate to the drive", step 1).
 *
 * The initiative-readiness gate already knows when an independent review is
 * owed (CANONICAL_DESIGN_REQUIRED, SPEC_APPROVAL_REQUIRED, PLAN_REVIEW_REQUIRED)
 * and the reviewer recovery already names the eligible NON-AUTHOR reviewer. A
 * delivery shape already declares the stage that review belongs to: the stage
 * that leaves a `spec-approval-receipt` or a `plan-review-receipt`. This module
 * is the wire between them. It rebinds that stage's accountable principal to
 * the reviewer, and the drive's own principal split does the rest:
 *
 * - a person authored the work → the reviewer is the eligible agent the
 *   recovery selected → an agent stage → `dispatch_agent` (only at full
 *   proactivity, `preauthorized`; planStage checks that boundary too);
 * - an agent authored the work → the reviewer is the human role that owns the
 *   gate → a role stage → `attention`.
 *
 * Separation of duties is not relaxed: the bound principal is never the author.
 * An agent reviewer equal to the authoring agent, an unknown author, a route
 * the recovery did not mark independent, or no route at all binds nothing, and
 * the stage keeps its declared principal. Escalation stays a gate: an
 * agent-authored review always goes to a human, whatever the room's trust.
 *
 * Pure. The registry shape is never mutated; the drive receives a rebound copy.
 */
import type { ProactivityActionBoundary } from "@/lib/proactivity/proactivity-types";

import type { WorkShapeEvidenceKind } from "./work-shape-evidence-kinds";
import type { WorkShapeDefinitionContract, WorkShapeStage } from "./work-shapes";

/** The readiness codes this seam turns into drive review stages, and their review gate. */
export const READINESS_REVIEW_GATE_BY_CODE = Object.freeze({
  CANONICAL_DESIGN_REQUIRED: "design-spec",
  SPEC_APPROVAL_REQUIRED: "spec-approval",
  PLAN_REVIEW_REQUIRED: "plan-review",
} as const);

export type ReadinessReviewGate =
  (typeof READINESS_REVIEW_GATE_BY_CODE)[keyof typeof READINESS_REVIEW_GATE_BY_CODE];

/** Stage order: design-spec, then spec-approval (mints the baseline), then plan-review. */
export const READINESS_REVIEW_GATE_ORDER: readonly ReadinessReviewGate[] = ["design-spec", "spec-approval", "plan-review"];

/**
 * The stage evidence kind each initiative gate's receipt corresponds to in the
 * versioned delivery definitions. Evidence requirements, not permissions to
 * advance a stage. The one home for this map: the room's initiative-evidence
 * readout (workroom-initiative-evidence.ts) reads it too.
 */
export const INITIATIVE_GATE_STAGE_EVIDENCE_KIND: Readonly<Record<string, WorkShapeEvidenceKind>> = Object.freeze({
  research: "research-receipt",
  "spec-approval": "spec-approval-receipt",
  "architecture-review": "architecture-review-receipt",
  "plan-review": "plan-review-receipt",
  "post-implementation-review": "pir-receipt",
});

/**
 * The stage evidence that marks a shape stage as the home of a review gate.
 * Read off the declared shape, so no shape carries a second, parallel list of
 * its review stages. The design-spec review has no receipt kind of its own: the
 * same design-checklist reviewer records it at the spec-approval stage.
 */
export const REVIEW_STAGE_EVIDENCE_BY_GATE: Readonly<Record<ReadinessReviewGate, WorkShapeEvidenceKind>> = Object.freeze({
  "design-spec": INITIATIVE_GATE_STAGE_EVIDENCE_KIND["spec-approval"]!,
  "spec-approval": INITIATIVE_GATE_STAGE_EVIDENCE_KIND["spec-approval"]!,
  "plan-review": INITIATIVE_GATE_STAGE_EVIDENCE_KIND["plan-review"]!,
});

/** One independent reviewer route the readiness recovery issued, reduced to what the drive reads. */
export type ReadinessReviewRoute = {
  gate: string;
  accountableRole: string;
  targetAgentId: string;
  independent: boolean;
  requestCoworker: Record<string, unknown>;
};

/** Who authored the work under review. `unknown` binds nothing. */
export type ReviewArtifactAuthor =
  | { kind: "person"; userId: string }
  | { kind: "agent"; agentId: string }
  | { kind: "unknown" };

export type ReviewStageBinding = {
  stageKey: string;
  gate: ReadinessReviewGate;
  /** `agent:<reviewer>` (person-authored, preauthorized) or `role:<gate role>`. */
  accountablePrincipalRef: string;
  /** Fed to the drive's conformance check: the Process Overseer may not also be this reviewer. */
  independentEvaluatorPrincipalRef: string;
  /** The exact server-issued reviewer packet. Present only on the agent branch. */
  requestCoworker: Record<string, unknown> | null;
};

export function readinessReviewGatesForStage(stage: WorkShapeStage | null | undefined): ReadinessReviewGate[] {
  if (!stage) return [];
  return READINESS_REVIEW_GATE_ORDER.filter((gate) => stage.evidence.includes(REVIEW_STAGE_EVIDENCE_BY_GATE[gate]));
}

export function isReadinessReviewStage(
  definition: WorkShapeDefinitionContract | null | undefined,
  stageKey: string | null | undefined,
): boolean {
  if (!definition || !stageKey) return false;
  return readinessReviewGatesForStage(definition.stages.find((stage) => stage.key === stageKey)).length > 0;
}

function isReviewGate(value: string): value is ReadinessReviewGate {
  return (READINESS_REVIEW_GATE_ORDER as readonly string[]).includes(value);
}

/**
 * The non-author principal a review stage is bound to, or null when nothing
 * may be bound (the stage then keeps its declared principal).
 */
export function resolveReviewStageBinding(input: {
  definition: WorkShapeDefinitionContract;
  stageKey: string;
  routes: readonly ReadinessReviewRoute[];
  author: ReviewArtifactAuthor;
  actionBoundary: ProactivityActionBoundary | null;
}): ReviewStageBinding | null {
  const stage = input.definition.stages.find((entry) => entry.key === input.stageKey);
  const gates = readinessReviewGatesForStage(stage);
  if (!stage || gates.length === 0 || input.author.kind === "unknown") return null;
  // The earliest owed gate first: design-spec before spec-approval, so the
  // baseline is minted in order (design step 3).
  const route = gates
    .map((gate) => input.routes.find((entry) =>
      entry.gate === gate && entry.independent && entry.targetAgentId && entry.accountableRole))
    .find((entry): entry is ReadinessReviewRoute => Boolean(entry));
  if (!route || !isReviewGate(route.gate)) return null;

  const author = input.author;
  // Independence: the reviewing agent is never the authoring agent.
  if (author.kind === "agent" && route.targetAgentId === author.agentId) return null;

  if (author.kind === "person" && input.actionBoundary === "preauthorized") {
    const principal = `agent:${route.targetAgentId}`;
    return {
      stageKey: stage.key,
      gate: route.gate,
      accountablePrincipalRef: principal,
      independentEvaluatorPrincipalRef: principal,
      requestCoworker: route.requestCoworker,
    };
  }
  // An agent authored it (a human reviews), or the room is below full
  // proactivity (the review is teed up for the reviewer, never the author).
  const role = `role:${route.accountableRole}`;
  return {
    stageKey: stage.key,
    gate: route.gate,
    accountablePrincipalRef: role,
    independentEvaluatorPrincipalRef: role,
    requestCoworker: null,
  };
}

/** A copy of the definition with the bound review stage's principal replaced. */
export function bindReviewStage(
  definition: WorkShapeDefinitionContract,
  binding: Pick<ReviewStageBinding, "stageKey" | "accountablePrincipalRef">,
): WorkShapeDefinitionContract {
  return {
    ...definition,
    stages: definition.stages.map((stage) =>
      stage.key === binding.stageKey ? { ...stage, accountablePrincipalRef: binding.accountablePrincipalRef } : stage),
  };
}
