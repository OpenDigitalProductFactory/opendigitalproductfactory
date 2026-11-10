export const WORK_CASE_STATES = [
  "intake",
  "triage",
  "active",
  "waiting-on-person",
  "waiting-on-system",
  "awaiting-decision",
  "verifying",
  "resolved",
  "closed",
  "cancelled",
] as const;

export type WorkCaseState = (typeof WORK_CASE_STATES)[number];

export type WorkCaseA2aStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "auth-required"
  | "completed"
  | "canceled"
  | "failed"
  | "rejected";

export const WORK_CASE_ACTION_VERBS = [
  "claim",
  "pause",
  "needs-input",
  "needs-auth",
  "respond",
  "resume",
  "propose",
  "delegate",
  "handoff",
  "escalate",
  "verify",
  "complete",
  "cancel",
  "open-cycle",
  "pause-cycle",
  "verify-cycle",
  "complete-cycle",
  "carry-over",
  "renew",
  "split",
  "archive",
] as const;

export type WorkCaseActionVerb = (typeof WORK_CASE_ACTION_VERBS)[number];

export type WorkCaseEnforcementMode = "governed-action" | "observed-event";

export interface WorkCaseRef {
  caseId: string;
  sourceType: string;
  sourceId: string;
}

export type WorkCaseActorKind = "person" | "agent" | "system" | "external";

export interface WorkCaseActorRef {
  actorKind: WorkCaseActorKind;
  actorId?: string;
  displayName?: string;
}

export type WorkCaseBlockingActorKind =
  | "person"
  | "system"
  | "decision"
  | "runtime"
  | "source";

export type WorkCaseProjectionConfidence = "high" | "medium" | "low";

export type WorkCaseSourceRefKind =
  | "source"
  | "work-item"
  | "work-capsule"
  | "coworker-engagement"
  | "task-run"
  | "task-artifact"
  | "decision-interaction"
  | "runtime-verification"
  | "receipt"
  | "evidence";

export interface WorkCaseSourceRef {
  kind: WorkCaseSourceRefKind;
  id: string;
  status?: string;
  sourceType?: string;
}

export interface WorkCaseStateProjection {
  state: WorkCaseState;
  reason: string;
  sourceRef: WorkCaseSourceRef;
  a2aStatus: WorkCaseA2aStatus;
  terminal: boolean;
  confidence: WorkCaseProjectionConfidence;
  blockingActorKind?: WorkCaseBlockingActorKind;
}

export interface WorkCaseSummary {
  caseId: string;
  title: string;
  sourceLabel: string;
  state: WorkCaseState;
  stateReason: string;
  a2aStatus: WorkCaseA2aStatus;
  terminal: boolean;
  nextAction: string;
  urgency?: string;
  dueAt?: string | null;
  assignedToUserId?: string | null;
  attention: {
    required: boolean;
    reason: string | null;
  };
  sourceRefs: WorkCaseSourceRef[];
}

export interface WorkCaseTimelineEvent {
  eventId: string;
  label: string;
  sourceRef: WorkCaseSourceRef;
}

export interface WorkCaseDetail {
  summary: WorkCaseSummary;
  capsules: readonly unknown[];
  decisions: readonly unknown[];
  evidence: readonly unknown[];
  timeline: WorkCaseTimelineEvent[];
}
