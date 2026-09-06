/**
 * Workroom shape conformance — the Process Overseer projection (BI-3913EB49).
 *
 * Pure declared-versus-observed result. Dispatch remains default-off in this
 * slice: callers consume the projection at convene, before/after a stage,
 * review, and close. Never invents occupants, skips stages, or widens grants.
 */
import {
  deriveRoomCoordinator,
  selectExplicitRoomCoordinator,
  selectRoomCoordinator,
  WorkroomParticipantError,
} from "./room-coordinator";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import type { WorkShapeDefinitionContract } from "./work-shapes";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";

export const WORKROOM_SHAPE_CONFORMANCE_DEVIATIONS = [
  "unresolved_work_shape",
  "work_shape_version_mismatch",
  "missing_conformance_result",
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
  "coordinator_jsi_ineligible",
  "coordinator_authority_binding_ineligible",
] as const;

export type WorkroomShapeConformanceDeviationCode =
  (typeof WORKROOM_SHAPE_CONFORMANCE_DEVIATIONS)[number];

export type WorkroomShapeConformanceDisposition =
  | "continue"
  | "pause"
  | "escalate"
  | "stop"
  | "complete"
  | "not-applicable";

export type WorkroomShapeConformanceDeviation = {
  code: WorkroomShapeConformanceDeviationCode;
  summary: string;
};

export type WorkroomShapeConformance = {
  shapeKey: string | null;
  shapeVersion: string | null;
  collaborationShape: string | null;
  processOverseerPrincipalRef: string | null;
  processOverseerSource: "explicit" | "derived" | "none";
  currentStageKey: string | null;
  nextPermittedStageKey: string | null;
  observed: WorkroomShapeObservedState;
  deviations: WorkroomShapeConformanceDeviation[];
  disposition: WorkroomShapeConformanceDisposition;
  interventionReason: string | null;
  checkedAt: string;
  reconciliationKey: string;
};

export type WorkroomShapeObservedState = {
  participantCount: number;
  receiptKinds: string[];
  proposedGrantCount: number;
  budgetUsage: Array<{ kind: string; used: number }>;
  stopConditionHits: string[];
  reviewDue: boolean;
};

export const WORKROOM_COORDINATOR_ELIGIBILITY_STATES = [
  "eligible",
  "absent",
  "stale",
  "narrowed",
  "suspended",
  "incompatible",
  // An absent qualification SCHEME is not a failed qualification (DI-FF4A015CF917,
  // margin 5.420). A precondition nothing on the platform can satisfy is a
  // permanent denial, not a safeguard; this state records that honestly and does
  // not block, while a scheme that exists and is unmet blocks exactly as before.
  "not-applicable",
  "unknown",
] as const;

export type WorkroomCoordinatorEligibilityState =
  (typeof WORKROOM_COORDINATOR_ELIGIBILITY_STATES)[number];

/** States that do NOT raise a deviation. `eligible` is a positive verdict;
 *  `not-applicable` means the platform has no scheme to verdict against, so
 *  there is nothing for this coworker to fail. Every other state — including
 *  `unknown` — still blocks. */
const SATISFIED_ELIGIBILITY: ReadonlySet<string> = new Set(["eligible", "not-applicable"]);

export type WorkroomCoordinatorEligibility = {
  jsi: WorkroomCoordinatorEligibilityState;
  authorityBinding: WorkroomCoordinatorEligibilityState;
};

export type WorkroomShapeConformanceInput = {
  roomKey?: string;
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
  coordinatorEligibility?: WorkroomCoordinatorEligibility | null;
  checkedAt?: Date | string;
};

function iso(value: Date | string | undefined): string {
  if (value === undefined) return new Date(0).toISOString();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeDeviations(
  deviations: readonly WorkroomShapeConformanceDeviation[],
): WorkroomShapeConformanceDeviation[] {
  return [...new Map(deviations.map((row) => [`${row.code}\0${row.summary}`, row])).values()]
    .sort((left, right) => left.code.localeCompare(right.code) || left.summary.localeCompare(right.summary));
}

function observedState(input: Pick<
  WorkroomShapeConformanceInput,
  "participants" | "receipts" | "proposedGrants" | "budgetUsage" | "stopConditionHits" | "reviewDue"
>): WorkroomShapeObservedState {
  return {
    participantCount: input.participants.length,
    receiptKinds: [...new Set(input.receipts.map((row) => row.kind))].sort(),
    proposedGrantCount: input.proposedGrants?.length ?? 0,
    budgetUsage: [...input.budgetUsage]
      .map((row) => ({ kind: row.kind, used: row.used }))
      .sort((left, right) => left.kind.localeCompare(right.kind)),
    stopConditionHits: [...new Set(input.stopConditionHits)].sort(),
    reviewDue: input.reviewDue,
  };
}

function reconciliationKey(input: {
  roomKey: string;
  shapeKey: string | null;
  shapeVersion: string | null;
  currentStageKey: string | null;
  proposedStageKey: string | null;
  overseerRef: string | null;
  overseerSource: string;
  disposition: WorkroomShapeConformanceDisposition;
  deviations: readonly WorkroomShapeConformanceDeviation[];
  closing?: boolean;
}): string {
  const fingerprint = [
    input.roomKey,
    `${input.shapeKey ?? "unshaped"}@${input.shapeVersion ?? "none"}`,
    input.currentStageKey ?? "unstarted",
    input.proposedStageKey ?? "none",
    input.overseerRef ?? "none",
    input.overseerSource,
    input.disposition,
    input.closing ? "closing" : "open",
    input.deviations.map((row) => row.code).join(","),
  ].join("|");
  return `work-room-conformance:${stableHash(fingerprint)}`;
}

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

  const overseerParticipant = processOverseerPrincipalRef
    ? input.participants.find((row) => row.principalRef === processOverseerPrincipalRef) ?? null
    : null;
  if (processOverseerSource === "explicit" && overseerParticipant?.kind === "agent") {
    const eligibility = input.coordinatorEligibility ?? {
      jsi: "unknown" as const,
      authorityBinding: "unknown" as const,
    };
    if (!SATISFIED_ELIGIBILITY.has(eligibility.authorityBinding)) {
      deviations.push({
        code: "coordinator_authority_binding_ineligible",
        summary: `The AI Process Overseer's TAK authority binding is ${eligibility.authorityBinding}.`,
      });
    }
    if (!SATISFIED_ELIGIBILITY.has(eligibility.jsi)) {
      deviations.push({
        code: "coordinator_jsi_ineligible",
        summary: `The AI Process Overseer's JSI qualification is ${eligibility.jsi}.`,
      });
    }
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
  } else if (input.currentStageKey && currentIndex < 0) {
    deviations.push({
      code: "out_of_order_stage",
      summary: `Current stage ${input.currentStageKey} is not on the declared shape.`,
    });
  } else if (input.proposedStageKey && !input.currentStageKey && proposedIndex !== 0) {
    deviations.push({
      code: "out_of_order_stage",
      summary:
        `An unstarted room can begin only at ${input.definition.stages[0]?.key ?? "the first declared stage"}.`,
    });
  } else if (
    input.proposedStageKey &&
    input.currentStageKey &&
    proposedIndex < currentIndex
  ) {
    deviations.push({
      code: "out_of_order_stage",
      summary: `Stage ${input.proposedStageKey} is behind ${input.currentStageKey}.`,
    });
  } else if (
    input.proposedStageKey &&
    input.currentStageKey &&
    proposedIndex === currentIndex &&
    input.receipts.some((receipt) => receipt.stageKey === input.currentStageKey)
  ) {
    deviations.push({
      code: "out_of_order_stage",
      summary: `Stage ${input.currentStageKey} already has a receipt and cannot be replayed.`,
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

  const normalizedDeviations = normalizeDeviations(deviations);
  const blocking = normalizedDeviations.some((deviation) =>
    deviation.code === "stop_condition_met" ||
    deviation.code === "budget_exhausted" ||
    deviation.code === "unresolved_deviation_on_close",
  );
  const escalate = normalizedDeviations.some((deviation) =>
    deviation.code === "authority_widening" ||
    deviation.code === "coordinator_lacks_authority" ||
    deviation.code === "coordinator_evaluator_overlap" ||
    deviation.code === "coordinator_approver_overlap" ||
    deviation.code === "multiple_coordinators" ||
    deviation.code === "coordinator_jsi_ineligible" ||
    deviation.code === "coordinator_authority_binding_ineligible",
  );
  const pause = normalizedDeviations.length > 0;

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
        : input.closing
          ? "complete"
          : "continue";

  const checkedAt = iso(input.checkedAt);
  const interventionReason = normalizedDeviations[0]?.summary ?? null;
  const roomKey = input.roomKey ?? `shape:${input.definition.key}`;

  return {
    shapeKey: input.definition.key,
    shapeVersion: input.definition.version,
    collaborationShape: input.collaborationShape,
    processOverseerPrincipalRef,
    processOverseerSource,
    currentStageKey: input.currentStageKey,
    nextPermittedStageKey: disposition === "continue"
      ? (input.proposedStageKey ?? nextPermittedStageKey)
      : disposition === "complete"
        ? null
        : nextPermittedStageKey,
    observed: observedState(input),
    deviations: normalizedDeviations,
    disposition,
    interventionReason,
    checkedAt,
    reconciliationKey: reconciliationKey({
      roomKey,
      shapeKey: input.definition.key,
      shapeVersion: input.definition.version,
      currentStageKey: input.currentStageKey,
      proposedStageKey: input.proposedStageKey,
      overseerRef: processOverseerPrincipalRef,
      overseerSource: processOverseerSource,
      disposition,
      deviations: normalizedDeviations,
      closing: input.closing,
    }),
  };
}

function explainCoordinator(participants: readonly WorkroomParticipantView[]): Pick<
  WorkroomShapeConformance,
  "processOverseerPrincipalRef" | "processOverseerSource"
> {
  try {
    const coordinator = selectRoomCoordinator(deriveRoomCoordinator(participants));
    return coordinator
      ? {
          processOverseerPrincipalRef: coordinator.principalRef,
          processOverseerSource: coordinator.coordinatorSource === "explicit" ? "explicit" : "derived",
        }
      : { processOverseerPrincipalRef: null, processOverseerSource: "none" };
  } catch {
    return { processOverseerPrincipalRef: null, processOverseerSource: "none" };
  }
}

export function projectUnshapedWorkroomConformance(input: {
  roomKey: string;
  collaborationShape: string | null;
  participants: readonly WorkroomParticipantView[];
  checkedAt?: Date | string;
}): WorkroomShapeConformance {
  const overseer = explainCoordinator(input.participants);
  const disposition = "not-applicable" as const;
  const deviations: WorkroomShapeConformanceDeviation[] = [];
  return {
    shapeKey: null,
    shapeVersion: null,
    collaborationShape: input.collaborationShape,
    ...overseer,
    currentStageKey: null,
    nextPermittedStageKey: null,
    observed: {
      participantCount: input.participants.length,
      receiptKinds: [],
      proposedGrantCount: 0,
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
    },
    deviations,
    disposition,
    interventionReason: "No executable work shape is declared.",
    checkedAt: iso(input.checkedAt),
    reconciliationKey: reconciliationKey({
      roomKey: input.roomKey,
      shapeKey: null,
      shapeVersion: null,
      currentStageKey: null,
      proposedStageKey: null,
      overseerRef: overseer.processOverseerPrincipalRef,
      overseerSource: overseer.processOverseerSource,
      disposition,
      deviations,
    }),
  };
}

export function projectUnresolvedWorkroomShapeConformance(input: {
  roomKey: string;
  collaborationShape: string | null;
  participants: readonly WorkroomParticipantView[];
  shapeKey: string;
  shapeVersion: string;
  registeredVersion?: string | null;
  checkedAt?: Date | string;
}): WorkroomShapeConformance {
  const overseer = explainCoordinator(input.participants);
  const code: WorkroomShapeConformanceDeviationCode = input.registeredVersion
    ? "work_shape_version_mismatch"
    : "unresolved_work_shape";
  const deviations: WorkroomShapeConformanceDeviation[] = [{
    code,
    summary: input.registeredVersion
      ? `Declared work shape ${input.shapeKey}@${input.shapeVersion} does not match registered version ${input.registeredVersion}.`
      : `Declared work shape ${input.shapeKey}@${input.shapeVersion} is not registered.`,
  }];
  return {
    shapeKey: input.shapeKey,
    shapeVersion: input.shapeVersion,
    collaborationShape: input.collaborationShape,
    ...overseer,
    currentStageKey: null,
    nextPermittedStageKey: null,
    observed: { participantCount: input.participants.length, receiptKinds: [], proposedGrantCount: 0, budgetUsage: [], stopConditionHits: [], reviewDue: false },
    deviations,
    disposition: "pause",
    interventionReason: deviations[0]!.summary,
    checkedAt: iso(input.checkedAt),
    reconciliationKey: reconciliationKey({
      roomKey: input.roomKey,
      shapeKey: input.shapeKey,
      shapeVersion: input.shapeVersion,
      currentStageKey: null,
      proposedStageKey: null,
      overseerRef: overseer.processOverseerPrincipalRef,
      overseerSource: overseer.processOverseerSource,
      disposition: "pause",
      deviations,
    }),
  };
}

export type WorkroomConformanceReceipt = {
  kind: "work-room-conformance-receipt";
  version: 1;
  operation: string;
  status: "allowed" | "refused";
  disposition: WorkroomShapeConformanceDisposition;
  reconciliationKey: string;
  deviationCodes: WorkroomShapeConformanceDeviationCode[];
  interventionReason: string | null;
  checkedAt: string;
};

export type WorkroomLifecycleConformanceDecision =
  | (ActionSuccess & {
      allowed: true;
      disposition: WorkroomShapeConformanceDisposition;
      receipt: WorkroomConformanceReceipt;
    })
  | {
      ok: false;
      allowed: false;
      reason: "shape_conformance_denied";
      message: string;
      disposition: Exclude<WorkroomShapeConformanceDisposition, "continue" | "complete" | "not-applicable">;
      deviationCodes: WorkroomShapeConformanceDeviationCode[];
      interventionReason: string;
      reconciliationKey: string;
      receipt: WorkroomConformanceReceipt;
    };

export function evaluateWorkroomLifecycleConformance(input: {
  operation: string;
  hasDeclaredWorkShape: boolean;
  conformance: WorkroomShapeConformance | null;
}): WorkroomLifecycleConformanceDecision {
  const conformance = input.conformance;
  const missing = conformance === null;
  const deviationCodes: WorkroomShapeConformanceDeviationCode[] = missing
    ? ["missing_conformance_result"]
    : conformance.deviations.map((row) => row.code);
  const disposition = missing ? "pause" as const : conformance.disposition;
  const interventionReason = missing
    ? "A declared work shape requires a current conformance projection before lifecycle work can advance."
    : conformance.interventionReason;
  const key = missing
    ? `work-room-conformance:${stableHash(`${input.operation}|missing`)}`
    : conformance.reconciliationKey;
  const checkedAt = missing ? new Date(0).toISOString() : conformance.checkedAt;
  const allowed = !input.hasDeclaredWorkShape
    ? true
    : disposition === "continue"
      || (disposition === "complete" && ["complete-cycle", "close"].includes(input.operation));
  const receipt: WorkroomConformanceReceipt = {
    kind: "work-room-conformance-receipt",
    version: 1,
    operation: input.operation,
    status: allowed ? "allowed" : "refused",
    disposition,
    reconciliationKey: key,
    deviationCodes,
    interventionReason,
    checkedAt,
  };
  if (allowed) return Object.assign(ok(), { allowed: true as const, disposition, receipt });
  return {
    ok: false,
    allowed: false,
    reason: "shape_conformance_denied",
    message: interventionReason ?? `Work Room lifecycle operation ${input.operation} is refused by shape conformance.`,
    disposition: disposition === "stop" || disposition === "escalate" ? disposition : "pause",
    deviationCodes,
    interventionReason: interventionReason ?? "Work Room shape conformance refused the lifecycle operation.",
    reconciliationKey: key,
    receipt,
  };
}
