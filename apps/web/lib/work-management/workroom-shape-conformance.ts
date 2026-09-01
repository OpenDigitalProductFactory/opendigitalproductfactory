/**
 * Workroom shape conformance — the Process Overseer projection (BI-3913EB49).
 *
 * Pure declared-versus-observed result. Dispatch remains default-off in this
 * slice: callers consume the projection at convene, before/after a stage,
 * review, and close. Never invents occupants, skips stages, or widens grants.
 */
import {
  selectExplicitRoomCoordinator,
  selectRoomCoordinator,
  WorkroomParticipantError,
} from "./room-coordinator";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import type { WorkShapeDefinitionContract } from "./work-shapes";

export const WORKROOM_SHAPE_CONFORMANCE_DEVIATIONS = [
  "missing_explicit_coordinator",
  "derived_coordinator_only",
  "multiple_coordinators",
  "coordinator_lacks_authority",
  "missing_required_participant",
  "out_of_order_stage",
  "missing_prerequisite_receipt",
  "budget_exhausted",
  "stop_condition_met",
  "review_due",
  "authority_widening",
  "coordinator_evaluator_overlap",
  "coordinator_approver_overlap",
  "unresolved_deviation_on_close",
] as const;

export type WorkroomShapeConformanceDeviationCode =
  (typeof WORKROOM_SHAPE_CONFORMANCE_DEVIATIONS)[number];

export type WorkroomShapeConformanceDisposition =
  | "continue"
  | "pause"
  | "escalate"
  | "stop";

export type WorkroomShapeConformanceDeviation = {
  code: WorkroomShapeConformanceDeviationCode;
  summary: string;
};

export type WorkroomShapeConformance = {
  shapeKey: string;
  shapeVersion: string;
  collaborationShape: string | null;
  processOverseerPrincipalRef: string | null;
  processOverseerSource: "explicit" | "derived" | "none";
  currentStageKey: string | null;
  nextPermittedStageKey: string | null;
  deviations: WorkroomShapeConformanceDeviation[];
  disposition: WorkroomShapeConformanceDisposition;
};

export type WorkroomShapeConformanceInput = {
  definition: WorkShapeDefinitionContract;
  collaborationShape: string | null;
  participants: readonly WorkroomParticipantView[];
  currentStageKey: string | null;
  proposedStageKey: string | null;
  receipts: readonly { stageKey: string; kind: string }[];
  budgetUsage: readonly { kind: string; used: number }[];
  stopConditionHits: readonly string[];
  reviewDue: boolean;
  proposedGrants?: readonly string[];
  coordinatorHasProcessCoordinationAuthority?: boolean;
  independentEvaluatorPrincipalRef?: string | null;
  independentApproverPrincipalRef?: string | null;
  closing?: boolean;
  unresolvedDeviationCount?: number;
  requiredRoles?: readonly WorkroomParticipantRole[];
};

function stageIndex(definition: WorkShapeDefinitionContract, key: string | null): number {
  if (!key) return -1;
  return definition.stages.findIndex((stage) => stage.key === key);
}

function uniqueRoles(participants: readonly WorkroomParticipantView[]): Set<WorkroomParticipantRole> {
  const roles = new Set<WorkroomParticipantRole>();
  for (const participant of participants) {
    for (const role of participant.roles) roles.add(role);
  }
  return roles;
}

export function evaluateWorkroomShapeConformance(
  input: WorkroomShapeConformanceInput,
): WorkroomShapeConformance {
  const deviations: WorkroomShapeConformanceDeviation[] = [];
  let processOverseerSource: "explicit" | "derived" | "none" = "none";
  let processOverseerPrincipalRef: string | null = null;

  try {
    const named = selectRoomCoordinator(input.participants);
    const explicit = selectExplicitRoomCoordinator(input.participants);
    if (explicit) {
      processOverseerPrincipalRef = explicit.principalRef;
      processOverseerSource = "explicit";
    } else if (named?.coordinatorSource === "derived") {
      processOverseerPrincipalRef = named.principalRef;
      processOverseerSource = "derived";
      deviations.push({
        code: "derived_coordinator_only",
        summary: "A derived coordinator may explain the room but does not qualify it for execution.",
      });
    } else {
      deviations.push({
        code: "missing_explicit_coordinator",
        summary: "An executable room requires exactly one explicit Process Overseer.",
      });
    }
  } catch (error) {
    if (error instanceof WorkroomParticipantError && error.reason === "multiple_active_coordinators") {
      deviations.push({
        code: "multiple_coordinators",
        summary: "A Work Room can have only one active Process Overseer.",
      });
    } else {
      throw error;
    }
  }

  if (
    processOverseerSource === "explicit" &&
    input.coordinatorHasProcessCoordinationAuthority === false
  ) {
    deviations.push({
      code: "coordinator_lacks_authority",
      summary: "The Process Overseer lacks current process-coordination authority.",
    });
  }

  if (
    processOverseerPrincipalRef &&
    input.independentEvaluatorPrincipalRef &&
    processOverseerPrincipalRef === input.independentEvaluatorPrincipalRef
  ) {
    deviations.push({
      code: "coordinator_evaluator_overlap",
      summary: "The Process Overseer cannot also be the independent evaluator.",
    });
  }

  if (
    processOverseerPrincipalRef &&
    input.independentApproverPrincipalRef &&
    processOverseerPrincipalRef === input.independentApproverPrincipalRef
  ) {
    deviations.push({
      code: "coordinator_approver_overlap",
      summary: "The Process Overseer cannot also be the independent approver.",
    });
  }

  const presentRoles = uniqueRoles(input.participants);
  for (const role of input.requiredRoles ?? []) {
    if (!presentRoles.has(role)) {
      deviations.push({
        code: "missing_required_participant",
        summary: `Required participant role ${role} is not assigned.`,
      });
    }
  }

  const currentIndex = stageIndex(input.definition, input.currentStageKey);
  const proposedIndex = stageIndex(input.definition, input.proposedStageKey);
  if (input.proposedStageKey && proposedIndex < 0) {
    deviations.push({
      code: "out_of_order_stage",
      summary: `Proposed stage ${input.proposedStageKey} is not on the declared shape.`,
    });
  } else if (
    input.proposedStageKey &&
    input.currentStageKey &&
    proposedIndex > currentIndex + 1
  ) {
    deviations.push({
      code: "out_of_order_stage",
      summary: `Stage ${input.proposedStageKey} skips ahead of ${input.currentStageKey}.`,
    });
  }

  if (proposedIndex > 0) {
    const prior = input.definition.stages[proposedIndex - 1];
    const hasReceipt = input.receipts.some((receipt) => receipt.stageKey === prior.key);
    if (!hasReceipt) {
      deviations.push({
        code: "missing_prerequisite_receipt",
        summary: `Stage ${input.proposedStageKey} lacks a receipt from ${prior.key}.`,
      });
    }
  }

  for (const budget of input.definition.budgets) {
    const used = input.budgetUsage.find((entry) => entry.kind === budget.kind)?.used ?? 0;
    if (used >= budget.limit) {
      deviations.push({
        code: "budget_exhausted",
        summary: `Budget ${budget.kind} is exhausted (${used}/${budget.limit} ${budget.unit}).`,
      });
    }
  }

  if (input.stopConditionHits.length > 0) {
    deviations.push({
      code: "stop_condition_met",
      summary: `Declared stop condition hit: ${input.stopConditionHits.join(", ")}.`,
    });
  }

  if (input.reviewDue) {
    deviations.push({
      code: "review_due",
      summary: "The shape's review point is due.",
    });
  }

  const allowed = new Set(input.definition.grants);
  for (const grant of input.proposedGrants ?? []) {
    if (!allowed.has(grant)) {
      deviations.push({
        code: "authority_widening",
        summary: `Proposed grant ${grant} is outside the declared shape grants.`,
      });
    }
  }

  if (input.closing && (input.unresolvedDeviationCount ?? deviations.length) > 0) {
    deviations.push({
      code: "unresolved_deviation_on_close",
      summary: "Closure is refused while a deviation is missing from the outcome packet.",
    });
  }

  const blocking = deviations.some((deviation) =>
    deviation.code === "stop_condition_met" ||
    deviation.code === "budget_exhausted" ||
    deviation.code === "unresolved_deviation_on_close",
  );
  const escalate = deviations.some((deviation) =>
    deviation.code === "authority_widening" ||
    deviation.code === "coordinator_lacks_authority" ||
    deviation.code === "coordinator_evaluator_overlap" ||
    deviation.code === "coordinator_approver_overlap" ||
    deviation.code === "multiple_coordinators",
  );
  const pause = deviations.length > 0;

  let nextPermittedStageKey: string | null = null;
  if (!pause && input.definition.stages.length > 0) {
    if (!input.currentStageKey) {
      nextPermittedStageKey = input.definition.stages[0]?.key ?? null;
    } else if (currentIndex >= 0 && currentIndex + 1 < input.definition.stages.length) {
      nextPermittedStageKey = input.definition.stages[currentIndex + 1]?.key ?? null;
    }
  }

  const disposition: WorkroomShapeConformanceDisposition = blocking
    ? "stop"
    : escalate
      ? "escalate"
      : pause
        ? "pause"
        : "continue";

  return {
    shapeKey: input.definition.key,
    shapeVersion: input.definition.version,
    collaborationShape: input.collaborationShape,
    processOverseerPrincipalRef,
    processOverseerSource,
    currentStageKey: input.currentStageKey,
    nextPermittedStageKey: disposition === "continue" ? (input.proposedStageKey ?? nextPermittedStageKey) : nextPermittedStageKey,
    deviations,
    disposition,
  };
}
