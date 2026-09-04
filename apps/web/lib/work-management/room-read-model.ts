import type {
  WorkCaseBlockingActorKind,
  WorkCaseDetail,
  WorkCaseSourceRef,
} from "./case-types";
import type { ReceiptEnvelope } from "./receipt-envelope";
import {
  normalizeWorkroomActivities,
  type WorkroomActivityInput,
} from "./room-activity";
import {
  buildWorkroomBoundary,
  type WorkroomBoundaryInput,
} from "./room-boundary";
import {
  dedupeRoomSourceRefs,
  roomText,
} from "./room-projection-utils";
import {
  resolveWorkroomPosture,
  type WorkroomPostureContext,
} from "./room-posture";
import { readWorkroomPostureClaim } from "./workroom-posture-claim";
import { getWorkShape, readWorkShapeDefinitionContract } from "./work-shapes";
import { readWorkShapeClaim, resolveWorkShapeClaim } from "./workroom-shape-claim";
import {
  evaluateWorkroomShapeConformance,
  projectUnresolvedWorkroomShapeConformance,
  projectUnshapedWorkroomConformance,
  type WorkroomCoordinatorEligibility,
} from "./workroom-shape-conformance";
import {
  getWorkCaseSourceEntry,
  getWorkroomDefinitionIdentity,
  type WorkCaseSourceRegistryEntry,
} from "./source-registry";
import type {
  WorkroomBoundaryGap,
  WorkroomContextView,
  WorkroomCycleView,
  WorkroomOutcomePacket,
  WorkroomOutcomeView,
  WorkroomParticipantView,
  WorkroomView,
} from "./room-types";

export type { WorkroomActivityInput } from "./room-activity";
export type { WorkroomBoundaryInput } from "./room-boundary";

export interface BuildWorkroomViewInput {
  caseKey: string;
  detail: WorkCaseDetail;
  boundary?: Partial<WorkroomBoundaryInput>;
  currentCycle?: WorkroomCycleView | null;
  completedCycles?: readonly WorkroomCycleView[];
  participants?: readonly WorkroomParticipantView[];
  activities?: readonly WorkroomActivityInput[];
  context?: Partial<WorkroomContextView>;
  outcomePacket?: WorkroomOutcomePacket | null;
  outcomeHealth?: WorkroomOutcomeView["health"];
  receipts?: readonly ReceiptEnvelope[];
  sourceHealth?: WorkroomView["projection"]["sourceHealth"];
  /**
   * The subject's value-stream + lifecycle structure, pre-resolved by the loader via
   * `resolveWorkroomStructure` (kept out of this pure build, like `sourceHealth`).
   */
  structure?: WorkroomView["structure"];
  /**
   * EP-WORK-POSTURE Slice D (BI-4F468192). The asynchronous half of the posture
   * — the org's operating clock, the archetype's value stream, the inherited
   * coworker posture — pre-resolved by the loader so this build stays DB-free,
   * exactly like `structure`. Absent means the room has no posture (inert).
   */
  postureContext?: WorkroomPostureContext | null;
  /** The room's declared collaboration shape, read from the capsule's scopeClaims. */
  shapeKey?: string | null;
  /** The room's activityKind, from the anchored Workroom. */
  activityKind?: string | null;
  /** Raw scopeClaims of the anchored Workroom, for the declared-posture claim. */
  scopeClaims?: unknown;
  /** The instant the view is built. Passed in so the build stays deterministic. */
  now?: Date;
  /** Optional observed execution state supplied by a lifecycle/drive loader. */
  processOverseerObservation?: {
    currentStageKey?: string | null;
    proposedStageKey?: string | null;
    receipts?: readonly { stageKey: string; kind: string }[];
    budgetUsage?: readonly { kind: string; used: number }[];
    stopConditionHits?: readonly string[];
    reviewDue?: boolean;
    proposedGrants?: readonly string[];
    coordinatorHasProcessCoordinationAuthority?: boolean;
    independentEvaluatorPrincipalRef?: string | null;
    independentApproverPrincipalRef?: string | null;
    closing?: boolean;
    unresolvedDeviationCount?: number;
    coordinatorEligibility?: WorkroomCoordinatorEligibility | null;
  };
}

function primarySourceRef(detail: WorkCaseDetail): WorkCaseSourceRef {
  return detail.summary.sourceRefs.find((ref) => ref.kind === "source")
    ?? detail.summary.sourceRefs[0]
    ?? { kind: "source", id: detail.summary.caseId };
}

function caseRefForDetail(detail: WorkCaseDetail): WorkroomView["caseRef"] {
  const source = primarySourceRef(detail);
  const separator = detail.summary.caseId.indexOf(":");
  return {
    caseId: detail.summary.caseId,
    sourceType:
      source.sourceType
      ?? (separator > 0 ? detail.summary.caseId.slice(0, separator) : "unknown"),
    sourceId:
      source.id
      || (separator > 0 ? detail.summary.caseId.slice(separator + 1) : detail.summary.caseId),
  };
}

function sourceEntryForDetail(
  detail: WorkCaseDetail,
): WorkCaseSourceRegistryEntry | null {
  return getWorkCaseSourceEntry(caseRefForDetail(detail).sourceType);
}

function blockingActorKindForState(
  state: WorkCaseDetail["summary"]["state"],
): WorkCaseBlockingActorKind | null {
  if (state === "waiting-on-person") return "person";
  if (state === "waiting-on-system") return "system";
  if (state === "awaiting-decision") return "decision";
  return null;
}

function sourceHealth(
  input: BuildWorkroomViewInput,
  source: WorkCaseSourceRegistryEntry | null,
): WorkroomView["projection"]["sourceHealth"] {
  if (input.sourceHealth) return input.sourceHealth;
  return source ? "ok" : "partial";
}

function projectionConfidence(
  source: WorkCaseSourceRegistryEntry | null,
  health: WorkroomView["projection"]["sourceHealth"],
  gaps: readonly WorkroomBoundaryGap[],
): WorkroomView["projection"]["confidence"] {
  if (!source || health === "unavailable") return "low";
  if (health === "partial" || gaps.length > 0) return "medium";
  return "high";
}

function cycleRef(cycle: WorkroomCycleView | null): WorkCaseSourceRef | null {
  if (!cycle) return null;
  return {
    kind: cycle.carrierKind,
    id: cycle.carrierId,
    status: cycle.status,
  };
}

export function buildWorkroomView(
  input: BuildWorkroomViewInput,
): WorkroomView {
  const expectedCaseKey = encodeURIComponent(input.detail.summary.caseId);
  if (input.caseKey !== expectedCaseKey) {
    throw new Error(
      `Work Room key '${input.caseKey}' must equal Work Case key '${expectedCaseKey}'.`,
    );
  }

  const source = sourceEntryForDetail(input.detail);
  const participants = [...(input.participants ?? [])];
  const context: WorkroomContextView = {
    refs: dedupeRoomSourceRefs(input.context?.refs ?? []),
    digest: roomText(input.context?.digest),
    sensitivityCeiling: roomText(input.context?.sensitivityCeiling),
  };
  const boundary = buildWorkroomBoundary({
    detail: input.detail,
    boundary: input.boundary,
    participants,
    context,
    contextProvided: Boolean(input.context),
  });
  const mode = source?.roomProjection.mode ?? "finite";
  const health = sourceHealth(input, source);
  const standingIdle = mode === "standing" && !input.currentCycle;
  const posture = resolveWorkroomPosture(
    {
      shapeKey: input.shapeKey ?? null,
      activityKind: input.activityKind ?? null,
      mode,
      cycleActive: Boolean(input.currentCycle),
      dueAt: boundary.timeBoundary.dueAt,
      declaration: readWorkroomPostureClaim(input.scopeClaims),
    },
    input.postureContext ?? null,
    input.now ?? new Date(),
  );
  const sourceRefs = dedupeRoomSourceRefs(input.detail.summary.sourceRefs);
  const activeCapsuleRefs = dedupeRoomSourceRefs(
    input.detail.timeline
      .map((event) => event.sourceRef)
      .filter((ref) => ref.kind === "work-capsule"),
  );
  const currentCycle = input.currentCycle ?? null;
  const currentCycleRef = cycleRef(currentCycle);
  const executionRefs = dedupeRoomSourceRefs([
    ...activeCapsuleRefs,
    ...(currentCycle?.sourceRefs ?? []).filter(
      (ref) =>
        ref.kind === "work-item"
        || ref.kind === "work-capsule"
        || ref.kind === "task-run",
    ),
  ]);
  const caseRef = caseRefForDetail(input.detail);
  const now = input.now ?? new Date(0);
  const declaredShape = readWorkShapeClaim(input.scopeClaims);
  const resolvedShape = resolveWorkShapeClaim(input.scopeClaims);
  const observation = input.processOverseerObservation;
  const processOverseer = !declaredShape
    ? projectUnshapedWorkroomConformance({
        roomKey: caseRef.caseId,
        collaborationShape: input.shapeKey ?? null,
        participants,
        checkedAt: now,
      })
    : !resolvedShape
      ? projectUnresolvedWorkroomShapeConformance({
          roomKey: caseRef.caseId,
          collaborationShape: input.shapeKey ?? null,
          participants,
          shapeKey: declaredShape.key,
          shapeVersion: declaredShape.version,
          registeredVersion: getWorkShape(declaredShape.key)?.version ?? null,
          checkedAt: now,
        })
      : evaluateWorkroomShapeConformance({
          roomKey: caseRef.caseId,
          definition: readWorkShapeDefinitionContract(resolvedShape),
          collaborationShape: input.shapeKey ?? resolvedShape.collaborationShape,
          participants,
          currentStageKey: observation?.currentStageKey ?? null,
          proposedStageKey: observation?.proposedStageKey
            ?? resolvedShape.stages[0]?.key
            ?? null,
          receipts: observation?.receipts ?? [],
          budgetUsage: observation?.budgetUsage ?? [],
          stopConditionHits: observation?.stopConditionHits ?? [],
          reviewDue: observation?.reviewDue ?? false,
          proposedGrants: observation?.proposedGrants,
          coordinatorHasProcessCoordinationAuthority:
            observation?.coordinatorHasProcessCoordinationAuthority ?? true,
          independentEvaluatorPrincipalRef: observation?.independentEvaluatorPrincipalRef,
          independentApproverPrincipalRef: observation?.independentApproverPrincipalRef,
          closing: observation?.closing,
          unresolvedDeviationCount: observation?.unresolvedDeviationCount,
          coordinatorEligibility: observation?.coordinatorEligibility,
          checkedAt: now,
        });

  return {
    roomKey: input.caseKey,
    caseRef,
    identity: {
      definition: getWorkroomDefinitionIdentity(caseRef.sourceType),
      instance: {
        instanceId: `workroom-instance:${caseRef.caseId}`,
        occurrenceTrace: {
          caseRef,
          sourceRef: primarySourceRef(input.detail),
          cycleRef: currentCycleRef,
          executionRefs,
        },
      },
    },
    title: input.detail.summary.title,
    purpose: boundary.purpose,
    mode,
    state: input.detail.summary.state,
    outcome: {
      statement: boundary.outcome,
      packet: input.outcomePacket ?? null,
      health: input.outcomeHealth ?? (standingIdle ? "idle" : null),
      sourceRefs: boundary.sourceRefs,
    },
    boundary,
    currentCycle,
    completedCycles: [...(input.completedCycles ?? [])],
    participants,
    activity: normalizeWorkroomActivities(input.activities ?? []),
    work: {
      nextAction: standingIdle
        ? "Open next cycle"
        : input.detail.summary.nextAction,
      attentionRequired: input.detail.summary.attention.required,
      attentionReason: input.detail.summary.attention.reason,
      blockingActorKind: blockingActorKindForState(input.detail.summary.state),
      activeCapsuleRefs,
      activeTaskRunSummary: null,
      terminal: input.detail.summary.terminal,
      sourceRefs,
    },
    context,
    posture,
    processOverseer,
    receipts: [...(input.receipts ?? [])],
    sourceRefs,
    structure: input.structure ?? null,
    projection: {
      confidence: projectionConfidence(source, health, boundary.gaps),
      incompleteBoundary: boundary.gaps.length > 0,
      sourceHealth: health,
    },
  };
}
