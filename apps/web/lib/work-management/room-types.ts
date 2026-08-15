import type {
  WorkCaseActorRef,
  WorkCaseBlockingActorKind,
  WorkCaseProjectionConfidence,
  WorkCaseRef,
  WorkCaseSourceRef,
  WorkCaseState,
} from "./case-types";
import type { ReceiptEnvelope } from "./receipt-envelope";
import type { WorkroomStructure } from "./room-structure";

export type WorkroomMode = "finite" | "standing";

export type WorkroomActivityKind =
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

export type WorkroomParticipantRole =
  | "accountable"
  | "coordinator"
  | "contributor"
  | "specialist"
  | "approver"
  | "reviewer"
  | "observer";

export type WorkroomParticipantWorkState =
  | "working"
  | "waiting"
  | "idle"
  | "unknown";

export type WorkroomOutcomePacketCategory =
  | "decisions"
  | "artifacts"
  | "actions"
  | "receipts"
  | "evidence";

export interface WorkroomOutcomePacket {
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

export type WorkroomBoundaryGap =
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

export interface WorkroomBoundaryView {
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
  gaps: WorkroomBoundaryGap[];
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkroomCycleView {
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
  outcomePacket: WorkroomOutcomePacket | null;
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkroomParticipantView {
  principalRef: string;
  displayName: string;
  kind: "person" | "agent" | "system" | "external";
  roles: WorkroomParticipantRole[];
  workState: WorkroomParticipantWorkState;
  presence: "active" | "idle" | "away" | "unknown";
  currentWorkSummary: string | null;
  enteredReason: string | null;
  sponsorPrincipalRef: string | null;
  sponsorDisplayName?: string | null;
  authoritySummary: string;
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkroomActivityView {
  eventId: string;
  kind: WorkroomActivityKind;
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

export interface WorkroomWorkView {
  nextAction: string;
  attentionRequired: boolean;
  attentionReason: string | null;
  blockingActorKind: WorkCaseBlockingActorKind | null;
  activeCapsuleRefs: WorkCaseSourceRef[];
  activeTaskRunSummary: string | null;
  terminal: boolean;
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkroomContextView {
  refs: WorkCaseSourceRef[];
  digest: string | null;
  sensitivityCeiling: string | null;
}

export interface WorkroomOutcomeView {
  statement: string | null;
  packet: WorkroomOutcomePacket | null;
  health: "on-track" | "at-risk" | "blocked" | "idle" | "unknown" | null;
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkroomView {
  roomKey: string;
  caseRef: WorkCaseRef;
  title: string;
  purpose: string | null;
  mode: WorkroomMode;
  state: WorkCaseState;
  outcome: WorkroomOutcomeView;
  boundary: WorkroomBoundaryView;
  currentCycle: WorkroomCycleView | null;
  completedCycles: WorkroomCycleView[];
  participants: WorkroomParticipantView[];
  activity: WorkroomActivityView[];
  work: WorkroomWorkView;
  context: WorkroomContextView;
  receipts: ReceiptEnvelope[];
  sourceRefs: WorkCaseSourceRef[];
  /**
   * The value stream + lifecycle the room's SUBJECT sits in — the structure the
   * collaboration happens within. Null when the subject has no value-stream/lifecycle
   * binding (e.g. a platform-development subject not on the customer OVSM). Resolved by
   * the loader via `resolveWorkroomStructure` and passed pre-resolved (DB-free build).
   */
  structure: WorkroomStructure | null;
  projection: {
    confidence: WorkCaseProjectionConfidence;
    incompleteBoundary: boolean;
    sourceHealth: "ok" | "partial" | "unavailable";
  };
}
