import type {
  WorkCaseBlockingActorKind,
  WorkCaseDetail,
  WorkCaseSourceRef,
} from "./case-types";
import type { ReceiptEnvelope } from "./receipt-envelope";
import {
  normalizeWorkRoomActivities,
  type WorkRoomActivityInput,
} from "./room-activity";
import {
  buildWorkRoomBoundary,
  type WorkRoomBoundaryInput,
} from "./room-boundary";
import {
  dedupeRoomSourceRefs,
  roomText,
} from "./room-projection-utils";
import {
  getWorkCaseSourceEntry,
  type WorkCaseSourceRegistryEntry,
} from "./source-registry";
import type {
  WorkRoomBoundaryGap,
  WorkRoomContextView,
  WorkRoomCycleView,
  WorkRoomOutcomePacket,
  WorkRoomOutcomeView,
  WorkRoomParticipantView,
  WorkRoomView,
} from "./room-types";

export type { WorkRoomActivityInput } from "./room-activity";
export type { WorkRoomBoundaryInput } from "./room-boundary";

export interface BuildWorkRoomViewInput {
  caseKey: string;
  detail: WorkCaseDetail;
  boundary?: Partial<WorkRoomBoundaryInput>;
  currentCycle?: WorkRoomCycleView | null;
  completedCycles?: readonly WorkRoomCycleView[];
  participants?: readonly WorkRoomParticipantView[];
  activities?: readonly WorkRoomActivityInput[];
  context?: Partial<WorkRoomContextView>;
  outcomePacket?: WorkRoomOutcomePacket | null;
  outcomeHealth?: WorkRoomOutcomeView["health"];
  receipts?: readonly ReceiptEnvelope[];
  sourceHealth?: WorkRoomView["projection"]["sourceHealth"];
}

function primarySourceRef(detail: WorkCaseDetail): WorkCaseSourceRef {
  return detail.summary.sourceRefs.find((ref) => ref.kind === "source")
    ?? detail.summary.sourceRefs[0]
    ?? { kind: "source", id: detail.summary.caseId };
}

function caseRefForDetail(detail: WorkCaseDetail): WorkRoomView["caseRef"] {
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
  input: BuildWorkRoomViewInput,
  source: WorkCaseSourceRegistryEntry | null,
): WorkRoomView["projection"]["sourceHealth"] {
  if (input.sourceHealth) return input.sourceHealth;
  return source ? "ok" : "partial";
}

function projectionConfidence(
  source: WorkCaseSourceRegistryEntry | null,
  health: WorkRoomView["projection"]["sourceHealth"],
  gaps: readonly WorkRoomBoundaryGap[],
): WorkRoomView["projection"]["confidence"] {
  if (!source || health === "unavailable") return "low";
  if (health === "partial" || gaps.length > 0) return "medium";
  return "high";
}

export function buildWorkRoomView(
  input: BuildWorkRoomViewInput,
): WorkRoomView {
  const expectedCaseKey = encodeURIComponent(input.detail.summary.caseId);
  if (input.caseKey !== expectedCaseKey) {
    throw new Error(
      `Work Room key '${input.caseKey}' must equal Work Case key '${expectedCaseKey}'.`,
    );
  }

  const source = sourceEntryForDetail(input.detail);
  const participants = [...(input.participants ?? [])];
  const context: WorkRoomContextView = {
    refs: dedupeRoomSourceRefs(input.context?.refs ?? []),
    digest: roomText(input.context?.digest),
    sensitivityCeiling: roomText(input.context?.sensitivityCeiling),
  };
  const boundary = buildWorkRoomBoundary({
    detail: input.detail,
    boundary: input.boundary,
    participants,
    context,
    contextProvided: Boolean(input.context),
  });
  const mode = source?.roomProjection.mode ?? "finite";
  const health = sourceHealth(input, source);
  const standingIdle = mode === "standing" && !input.currentCycle;
  const sourceRefs = dedupeRoomSourceRefs(input.detail.summary.sourceRefs);
  const activeCapsuleRefs = dedupeRoomSourceRefs(
    input.detail.timeline
      .map((event) => event.sourceRef)
      .filter((ref) => ref.kind === "work-capsule"),
  );

  return {
    roomKey: input.caseKey,
    caseRef: caseRefForDetail(input.detail),
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
    currentCycle: input.currentCycle ?? null,
    completedCycles: [...(input.completedCycles ?? [])],
    participants,
    activity: normalizeWorkRoomActivities(input.activities ?? []),
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
    receipts: [...(input.receipts ?? [])],
    sourceRefs,
    projection: {
      confidence: projectionConfidence(source, health, boundary.gaps),
      incompleteBoundary: boundary.gaps.length > 0,
      sourceHealth: health,
    },
  };
}
