import type {
  WorkCaseA2aStatus,
  WorkCaseActionVerb,
  WorkCaseSourceRef,
  WorkCaseState,
} from "./case-types";

export const WORK_CASE_STAGED_TRANSITION_STATUSES = [
  "proposed",
  "awaiting-approval",
  "edited",
  "approved",
  "rejected",
  "responded",
  "cancelled",
] as const;

export type WorkCaseStagedTransitionStatus =
  (typeof WORK_CASE_STAGED_TRANSITION_STATUSES)[number];

export interface WorkCaseStagedTransitionInput {
  transitionId: string;
  action: WorkCaseActionVerb;
  status: WorkCaseStagedTransitionStatus;
  decisionInteractionId?: string | null;
}

export interface WorkCaseStagedTransitionProjection {
  transitionId: string;
  action: WorkCaseActionVerb;
  status: WorkCaseStagedTransitionStatus;
  caseState: WorkCaseState;
  a2aStatus: WorkCaseA2aStatus;
  terminal: boolean;
  committable: boolean;
  sourceRef: WorkCaseSourceRef;
  reason: string;
  nextAction: string;
}

function sourceRef(input: WorkCaseStagedTransitionInput): WorkCaseSourceRef {
  if (input.decisionInteractionId?.trim()) {
    return {
      kind: "decision-interaction",
      id: input.decisionInteractionId,
      status: input.status,
    };
  }
  return {
    kind: "source",
    id: input.transitionId,
    status: input.status,
    sourceType: "work-case-staged-transition",
  };
}

export function projectWorkCaseStagedTransition(
  input: WorkCaseStagedTransitionInput,
): WorkCaseStagedTransitionProjection {
  switch (input.status) {
    case "proposed":
    case "awaiting-approval":
    case "edited":
      return {
        transitionId: input.transitionId,
        action: input.action,
        status: input.status,
        caseState: "awaiting-decision",
        a2aStatus: "input-required",
        terminal: false,
        committable: false,
        sourceRef: sourceRef(input),
        reason: `Transition ${input.action} is ${input.status} and waiting for approve/edit/reject/respond.`,
        nextAction: "Resolve staged transition",
      };
    case "approved":
      return {
        transitionId: input.transitionId,
        action: input.action,
        status: input.status,
        caseState: "active",
        a2aStatus: "working",
        terminal: true,
        committable: true,
        sourceRef: sourceRef(input),
        reason: `Transition ${input.action} is approved and ready to commit.`,
        nextAction: "Commit approved transition",
      };
    case "rejected":
      return {
        transitionId: input.transitionId,
        action: input.action,
        status: input.status,
        caseState: "waiting-on-person",
        a2aStatus: "input-required",
        terminal: true,
        committable: false,
        sourceRef: sourceRef(input),
        reason: `Transition ${input.action} was rejected before commit.`,
        nextAction: "Revise or cancel transition",
      };
    case "responded":
      return {
        transitionId: input.transitionId,
        action: input.action,
        status: input.status,
        caseState: "waiting-on-person",
        a2aStatus: "input-required",
        terminal: true,
        committable: false,
        sourceRef: sourceRef(input),
        reason: `Transition ${input.action} received a response before commit.`,
        nextAction: "Apply response or propose a new transition",
      };
    case "cancelled":
      return {
        transitionId: input.transitionId,
        action: input.action,
        status: input.status,
        caseState: "cancelled",
        a2aStatus: "canceled",
        terminal: true,
        committable: false,
        sourceRef: sourceRef(input),
        reason: `Transition ${input.action} was cancelled before commit.`,
        nextAction: "No action",
      };
  }
}
