import type {
  WorkCaseActorRef,
  WorkCaseBlockingActorKind,
  WorkCaseProjectionConfidence,
  WorkCaseRef,
  WorkCaseSourceRef,
  WorkCaseState,
} from "./case-types";
import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkRoomStructure } from "./room-structure";

export type WorkRoomMode = "finite" | "standing";

export type WorkRoomActivityKind =
  | "message"
  | "ask"
  | "coworker-joined"
  | "coworker-left"
  | "coworker-handoff"
  | "work-started"
  | "work-paused"
  | "work-completed"
  | "decision-proposed"
  | "decision-resolved"
  | "artifact-added"
  | "governed-action"
  | "external-event"
  | "verification"
  | "receipt"
  | "cycle-opened"
  | "cycle-closed"
  | "cycle-carried-over";

export type WorkRoomParticipantRole =
  | "accountable"
  | "coordinator"
  | "contributor"
  | "specialist"
  | "approver"
  | "reviewer"
  | "observer";

export type WorkRoomParticipantWorkState =
  | "working"
  | "waiting"
  | "idle"
  | "unknown";

export type WorkRoomOutcomePacketCategory =
  | "decisions"
  | "artifacts"
  | "actions"
  | "receipts"
  | "evidence";

export interface WorkRoomOutcomePacket {
  outcomeState:
    | "achieved"
    | "partially-achieved"
    | "not-achieved"
    | "cancelled";
  summary: string;
  decisionRefs: WorkCaseSourceRef[];
  artifactRefs: WorkCaseSourceRef[];
  actionRefs: WorkCaseSourceRef[];
  receiptRefs: WorkCaseSourceRef[];
  evidenceRefs: WorkCaseSourceRef[];
  unresolvedWork: Array<{
    summary: string;
    ownerRef: string | null;
    disposition: "carry-over" | "new-case" | "deferred" | "accepted";
  }>;
  accountablePrincipalRef: string;
  verifiedByRef: string | null;
  completedAt: string;
  nextReviewAt: string | null;
  sourceRefs: WorkCaseSourceRef[];
}

export type WorkRoomBoundaryGap =
  | "purpose"
  | "outcome"
  | "scope"
  | "participants"
  | "accountable"
  | "authority"
  | "sensitivity"
  | "context"
  | "measures"
  | "time-boundary"
  | "closure-rule";

export interface WorkRoomBoundaryView {
  purpose: string | null;
  outcome: string | null;
  scopeIncluded: string[];
  scopeExcluded: string[];
  accountablePrincipalRef: string | null;
  admittedRoleSummary: string[];
  authoritySummary: string[];
  sensitivityCeiling: string | null;
  measures: string[];
  timeBoundary: {
    dueAt: string | null;
    reviewAt: string | null;
    stopConditionSummary: string | null;
  };
  closureRuleSummary: string | null;
  gaps: WorkRoomBoundaryGap[];
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkRoomCycleView {
  cycleKey: string;
  carrierKind: "work-item" | "work-capsule" | "task-run";
  carrierId: string;
  trigger: string | null;
  objective: string | null;
  accountablePrincipalRef: string | null;
  openedAt: string | null;
  expectedReviewAt: string | null;
  stopConditions: string[];
  measureSummary: string | null;
  status: "open" | "verifying" | "closed" | "carried-over";
  outcomePacket: WorkRoomOutcomePacket | null;
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkRoomParticipantView {
  principalRef: string;
  displayName: string;
  kind: "person" | "agent" | "system" | "external";
  roles: WorkRoomParticipantRole[];
  workState: WorkRoomParticipantWorkState;
  presence: "active" | "idle" | "away" | "unknown";
  currentWorkSummary: string | null;
  enteredReason: string | null;
  sponsorPrincipalRef: string | null;
  sponsorDisplayName?: string | null;
  authoritySummary: string;
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkRoomActivityView {
  eventId: string;
  kind: WorkRoomActivityKind;
  occurredAt: string | null;
  actorRef: WorkCaseActorRef | null;
  summary: string;
  emphasis: "quiet" | "normal" | "salient";
  sourceRef: WorkCaseSourceRef;
  channel?: {
    provider: string;
    sessionRef: string | null;
  };
}

export interface WorkRoomWorkView {
  nextAction: string;
  attentionRequired: boolean;
  attentionReason: string | null;
  blockingActorKind: WorkCaseBlockingActorKind | null;
  activeCapsuleRefs: WorkCaseSourceRef[];
  activeTaskRunSummary: string | null;
  terminal: boolean;
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkRoomContextView {
  refs: WorkCaseSourceRef[];
  digest: string | null;
  sensitivityCeiling: string | null;
}

export interface WorkRoomOutcomeView {
  statement: string | null;
  packet: WorkRoomOutcomePacket | null;
  health: "on-track" | "at-risk" | "blocked" | "idle" | "unknown" | null;
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkRoomView {
  roomKey: string;
  caseRef: WorkCaseRef;
  title: string;
  purpose: string | null;
  mode: WorkRoomMode;
  state: WorkCaseState;
  outcome: WorkRoomOutcomeView;
  boundary: WorkRoomBoundaryView;
  currentCycle: WorkRoomCycleView | null;
  completedCycles: WorkRoomCycleView[];
  participants: WorkRoomParticipantView[];
  activity: WorkRoomActivityView[];
  work: WorkRoomWorkView;
  context: WorkRoomContextView;
  receipts: ReceiptEnvelope[];
  sourceRefs: WorkCaseSourceRef[];
  /**
   * The value stream + lifecycle the room's SUBJECT sits in — the structure the
   * collaboration happens within. Null when the subject has no value-stream/lifecycle
   * binding (e.g. a platform-development subject not on the customer OVSM). Resolved by
   * the loader via `resolveWorkRoomStructure` and passed pre-resolved (DB-free build).
   */
  structure: WorkRoomStructure | null;
  projection: {
    confidence: WorkCaseProjectionConfidence;
    incompleteBoundary: boolean;
    sourceHealth: "ok" | "partial" | "unavailable";
  };
}
