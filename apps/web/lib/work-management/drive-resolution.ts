/**
 * Standing-room drive resolution (BI-FCD639D9).
 *
 * Pure: declared shape + posture + Process Overseer conformance → a dispatch
 * plan. The Inngest job executes the plan. Never invents occupants, skips
 * stages, widens grants, or runs `role:` / `person:` stages. A governed-decision
 * stage also routes to a human (attention) — EXCEPT (EP-4614F35E) when its
 * accountable principal is an AGENT and the room is at full proactivity
 * (`actionBoundary === "preauthorized"`): then the room DRIVES its own governed
 * review, dispatching the non-author agent reviewer who records the receipt.
 */
import type { ProactivityActionBoundary, ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import type {
  ProjectedWorkShapeCycle,
  WorkShapeDefinitionContract,
  WorkShapeTriggerClass,
} from "./work-shapes";
import {
  evaluateWorkroomShapeConformance,
  type WorkroomCoordinatorEligibility,
  type WorkroomShapeConformance,
  type WorkroomShapeConformanceDeviation,
} from "./workroom-shape-conformance";
import type { DriveReason, DriveReasonsByAction } from "./drive-conclusion";
import type { DriveMarking, DriveTokenPlan } from "./drive-marking";
import { usesGraphConstructs } from "./drive-marking";
import { cycleCompleted, emptyPlan, ledgerFrom, planStage, projectDriveCycle } from "./drive-plan-stage";
import { resolveGraphDrivePlan } from "./drive-resolution-graph";
import {
  isCompletingWorkroomDriveReceipt,
  type PriorWorkroomDrive,
} from "./workroom-drive-receipts";

export {
  EXECUTOR_WRITEBACK_UNAVAILABLE_REASON,
  WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
  isCompletingWorkroomDriveReceipt,
} from "./workroom-drive-receipts";
export type { PriorWorkroomDrive } from "./workroom-drive-receipts";

export type DriveAction =
  | "do_not_wake"
  | "stop"
  | "pause"
  | "escalate"
  | "dispatch_agent"
  | "attention";

// The reason vocabulary is keyed by exactly these actions (BI-3ACFD254).
type ExactKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const DRIVE_ACTIONS_MATCH_REASON_VOCABULARY: ExactKeys<DriveAction, keyof DriveReasonsByAction> = true;
void DRIVE_ACTIONS_MATCH_REASON_VOCABULARY;

export type AccountablePrincipalKind = "agent" | "role" | "person" | "unknown";

export type DriveResolutionInput = {
  roomId: string;
  definition: WorkShapeDefinitionContract | null;
  collaborationShape: string | null;
  postureLevel: ProactivityLevel | null;
  participants: readonly WorkroomParticipantView[];
  currentStageKey: string | null;
  receipts: readonly { stageKey: string; kind: string }[];
  budgetUsage: readonly { kind: string; used: number }[];
  stopConditionHits: readonly string[];
  reviewDue: boolean;
  /** The room's resolved action boundary. `preauthorized` (full proactivity) is
   *  what lets an AGENT-principal governed-decision review stage dispatch itself
   *  instead of raising attention. Absent/null preserves the conservative
   *  attention behavior (EP-4614F35E). */
  actionBoundary?: ProactivityActionBoundary | null;
  substrateReachable: boolean;
  substrateEmpty: boolean;
  proposedGrants?: readonly string[];
  coordinatorHasProcessCoordinationAuthority?: boolean;
  independentEvaluatorPrincipalRef?: string | null;
  independentApproverPrincipalRef?: string | null;
  requiredRoles?: readonly WorkroomParticipantRole[];
  coordinatorEligibility?: WorkroomCoordinatorEligibility | null;
  now?: Date;
  trigger?: WorkShapeTriggerClass;
  /** Test/override only. Production callers omit this and the next permitted stage is derived. */
  proposedStageKey?: string | null;
  /** Last persisted drive tick. Used to fail closed when a dispatch produced no writeback. */
  priorDrive?: PriorWorkroomDrive | null;
  /**
   * The room's stored `workspaceState`. Read only by the graph path (GPP Phase
   * 3c), which keeps its marking there; the sequential path never reads it.
   */
  workspaceState?: unknown;
};

export type DrivePlan = {
  action: DriveAction;
  reason: DriveReason;
  roomId: string;
  shapeKey: string | null;
  shapeVersion: string | null;
  /** The shape being driven, so the dispatcher can brief the coworker from it
   *  rather than sending a bare stage key (BI-4A394B21). */
  definition: WorkShapeDefinitionContract | null;
  stageKey: string | null;
  accountablePrincipalRef: string | null;
  agentId: string | null;
  attentionPrincipalRef: string | null;
  taskId: string | null;
  conformance: WorkroomShapeConformance | null;
  cycle: ProjectedWorkShapeCycle | null;
  deviations: WorkroomShapeConformanceDeviation[];
  ledger: string[];
  /**
   * Graph shapes only (GPP Phase 3c, BI-8875C9DF): one plan per marked stage,
   * in document order. Absent on every sequential plan.
   */
  tokens?: DriveTokenPlan[];
  /**
   * Graph shapes only: the marking to persist, or `{ raw }` (a stored marking
   * that could not be read, kept verbatim). Absent means "carry the stored
   * marking forward unchanged" (applyDrivePlan). Absent on every sequential plan.
   */
  marking?: DriveMarking | { raw: unknown };
};

export { parseAccountablePrincipalRef, workroomDriveBranchTaskId, workroomDriveTaskId } from "./drive-plan-stage";

export function nextStageKey(
  definition: WorkShapeDefinitionContract,
  currentStageKey: string | null,
  receipts: readonly { stageKey: string; kind: string }[],
): string | null {
  if (definition.stages.length === 0) return null;
  if (!currentStageKey) return definition.stages[0]?.key ?? null;
  const currentHasReceipt = receipts.some((receipt) =>
    isCompletingWorkroomDriveReceipt(receipt, currentStageKey),
  );
  if (!currentHasReceipt) return currentStageKey;
  const index = definition.stages.findIndex((stage) => stage.key === currentStageKey);
  if (index < 0 || index + 1 >= definition.stages.length) return null;
  return definition.stages[index + 1]?.key ?? null;
}

export function resolveDrivePlan(input: DriveResolutionInput): DrivePlan {
  if (!input.definition) {
    return emptyPlan(input, "do_not_wake", "missing_shape");
  }

  if (input.postureLevel === "quiet") {
    return emptyPlan(input, "do_not_wake", "quiet");
  }

  if (input.postureLevel == null) {
    return emptyPlan(input, "do_not_wake", "no_posture");
  }

  if (!input.substrateReachable) {
    return emptyPlan(input, "stop", "unreachable_substrate", {
      ledger: ["Substrate unreachable; drive stopped and raised nothing."],
    });
  }

  if (input.substrateEmpty) {
    return emptyPlan(input, "stop", "empty_read", {
      ledger: ["Substrate empty; drive stopped and raised nothing."],
    });
  }

  // GPP Phase 3c (BI-8875C9DF): a structural branch, not a flag. A shape that
  // declares a flow, a deadline, a sub-shape or a refuse route runs on the
  // graph path; every other shape continues below, unchanged.
  if (usesGraphConstructs(input.definition)) {
    return resolveGraphDrivePlan({ ...input, definition: input.definition });
  }

  const proposedStageKey = input.proposedStageKey !== undefined
    ? input.proposedStageKey
    : nextStageKey(
      input.definition,
      input.currentStageKey,
      input.receipts,
    );
  const conformance = evaluateWorkroomShapeConformance({
    roomKey: input.roomId,
    definition: input.definition,
    collaborationShape: input.collaborationShape,
    participants: input.participants,
    currentStageKey: input.currentStageKey,
    proposedStageKey,
    receipts: input.receipts,
    budgetUsage: input.budgetUsage,
    stopConditionHits: input.stopConditionHits,
    reviewDue: input.reviewDue,
    proposedGrants: input.proposedGrants,
    coordinatorHasProcessCoordinationAuthority: input.coordinatorHasProcessCoordinationAuthority,
    independentEvaluatorPrincipalRef: input.independentEvaluatorPrincipalRef,
    independentApproverPrincipalRef: input.independentApproverPrincipalRef,
    requiredRoles: input.requiredRoles,
    coordinatorEligibility: input.coordinatorEligibility,
    checkedAt: input.now,
  });

  const cycle = projectDriveCycle(input, input.definition);

  // BI-D10BB58B: a cycle runs once. Success persists no stage, so without this
  // the next tick restarted at stage 1 and re-earned the same cycle's governed
  // decision: WC-A69BCABB looped seven times on 2026-10-02. The room sleeps
  // until the cycle key changes.
  if (cycleCompleted(input.priorDrive ?? null, cycle.cycleKey)) {
    return emptyPlan(input, "do_not_wake", "cycle_complete", {
      conformance,
      cycle,
      ledger: [`Cycle ${cycle.cycleKey} is complete; the room wakes in the next cycle.`],
    });
  }

  if (conformance.disposition === "stop") {
    return emptyPlan(input, "stop", "conformance_stop", {
      conformance,
      cycle,
      deviations: conformance.deviations,
      ledger: ledgerFrom(conformance, []),
    });
  }
  if (conformance.disposition === "escalate") {
    return emptyPlan(input, "escalate", "conformance_escalate", {
      conformance,
      cycle,
      deviations: conformance.deviations,
      ledger: ledgerFrom(conformance, []),
    });
  }
  if (conformance.disposition === "pause") {
    return emptyPlan(input, "pause", "conformance_pause", {
      conformance,
      cycle,
      deviations: conformance.deviations,
      ledger: ledgerFrom(conformance, []),
    });
  }

  const stage = proposedStageKey
    ? input.definition.stages.find((entry) => entry.key === proposedStageKey) ?? null
    : null;
  if (!stage) {
    return emptyPlan(input, "stop", "success", {
      conformance,
      cycle,
      ledger: ["No further permitted stage; cycle complete."],
    });
  }

  return planStage({ input, definition: input.definition, stage, conformance, cycle, prior: input.priorDrive ?? null });
}
