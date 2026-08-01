import {
  WORK_CASE_ACTION_VERBS,
  type WorkCaseA2aStatus,
  type WorkCaseActionVerb,
} from "./case-types";

export type WorkCaseCoworkerEnvelopeRequirement =
  | "never"
  | "when-supervised"
  | "always";

export interface WorkCaseActionDescriptor {
  action: WorkCaseActionVerb;
  displayLabel: string;
  a2aStatusHint?: WorkCaseA2aStatus;
  consequential: boolean;
  requiresPolicyEvaluation: boolean;
  requiresDecisionInteraction: boolean;
  requiresCoworkerEnvelope: WorkCaseCoworkerEnvelopeRequirement;
  requiresReceipt: boolean;
  sanctionedMutators: readonly string[];
}

export type WorkRoomLifecycleOperation =
  | "open-cycle"
  | "pause-cycle"
  | "verify-cycle"
  | "complete-cycle"
  | "carry-over"
  | "renew"
  | "split"
  | "archive";

export interface WorkRoomLifecycleActionDescriptor {
  operation: WorkRoomLifecycleOperation;
  displayLabel: string;
  canonicalAction: WorkCaseActionVerb;
}

export const WORK_CASE_ACTION_REGISTRY = [
  {
    action: "claim",
    displayLabel: "Claim",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["claim_capsule_scope", "update_backlog_item_status"],
  },
  {
    action: "pause",
    displayLabel: "Pause",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["update_work_capsule_status", "update_backlog_item_status"],
  },
  {
    action: "needs-input",
    displayLabel: "Needs input",
    a2aStatusHint: "input-required",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "when-supervised",
    requiresReceipt: true,
    sanctionedMutators: ["screen_propose_action", "WorkItemMessage"],
  },
  {
    action: "needs-auth",
    displayLabel: "Needs authorization",
    a2aStatusHint: "auth-required",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: true,
    requiresCoworkerEnvelope: "always",
    requiresReceipt: true,
    sanctionedMutators: ["screen_propose_action"],
  },
  {
    action: "respond",
    displayLabel: "Respond",
    a2aStatusHint: "working",
    consequential: false,
    requiresPolicyEvaluation: false,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: false,
    sanctionedMutators: ["WorkItemMessage"],
  },
  {
    action: "resume",
    displayLabel: "Resume",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["update_work_capsule_status", "update_backlog_item_status"],
  },
  {
    action: "propose",
    displayLabel: "Propose action",
    a2aStatusHint: "input-required",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "always",
    requiresReceipt: true,
    sanctionedMutators: ["screen_propose_action"],
  },
  {
    action: "delegate",
    displayLabel: "Delegate",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "when-supervised",
    requiresReceipt: true,
    sanctionedMutators: ["screen_propose_action"],
  },
  {
    action: "handoff",
    displayLabel: "Handoff",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "when-supervised",
    requiresReceipt: true,
    sanctionedMutators: ["screen_propose_action"],
  },
  {
    action: "escalate",
    displayLabel: "Escalate",
    a2aStatusHint: "input-required",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: true,
    requiresCoworkerEnvelope: "always",
    requiresReceipt: true,
    sanctionedMutators: ["record_execution_evidence", "DecisionInteraction"],
  },
  {
    action: "verify",
    displayLabel: "Verify",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["run_sandbox_tests", "run_ux_test", "record_capsule_evidence"],
  },
  {
    action: "complete",
    displayLabel: "Complete",
    a2aStatusHint: "completed",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["update_work_capsule_status", "update_backlog_item_status"],
  },
  {
    action: "cancel",
    displayLabel: "Cancel",
    a2aStatusHint: "canceled",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["update_work_capsule_status", "update_backlog_item_status"],
  },
] as const satisfies readonly WorkCaseActionDescriptor[];

const WORK_CASE_ACTIONS_BY_VERB = new Map<WorkCaseActionVerb, WorkCaseActionDescriptor>(
  WORK_CASE_ACTION_REGISTRY.map((entry) => [entry.action, entry]),
);

export const WORK_ROOM_LIFECYCLE_ACTION_REGISTRY = [
  { operation: "open-cycle", displayLabel: "Open cycle", canonicalAction: "claim" },
  { operation: "pause-cycle", displayLabel: "Pause cycle", canonicalAction: "pause" },
  { operation: "verify-cycle", displayLabel: "Verify cycle", canonicalAction: "verify" },
  { operation: "complete-cycle", displayLabel: "Complete cycle", canonicalAction: "complete" },
  { operation: "carry-over", displayLabel: "Carry over", canonicalAction: "handoff" },
  { operation: "renew", displayLabel: "Renew", canonicalAction: "resume" },
  { operation: "split", displayLabel: "Split", canonicalAction: "delegate" },
  { operation: "archive", displayLabel: "Archive", canonicalAction: "complete" },
] as const satisfies readonly WorkRoomLifecycleActionDescriptor[];

const WORK_ROOM_LIFECYCLE_ACTIONS_BY_OPERATION = new Map<
  WorkRoomLifecycleOperation,
  WorkRoomLifecycleActionDescriptor
>(WORK_ROOM_LIFECYCLE_ACTION_REGISTRY.map((entry) => [entry.operation, entry]));

export function getWorkCaseAction(
  action: string | null | undefined,
): WorkCaseActionDescriptor | null {
  const normalized = action?.trim() as WorkCaseActionVerb | undefined;
  if (!normalized || !WORK_CASE_ACTION_VERBS.includes(normalized)) return null;
  return WORK_CASE_ACTIONS_BY_VERB.get(normalized) ?? null;
}

export function getWorkRoomLifecycleAction(
  operation: string | null | undefined,
): WorkRoomLifecycleActionDescriptor | null {
  const normalized = operation?.trim() as WorkRoomLifecycleOperation | undefined;
  if (!normalized) return null;
  return WORK_ROOM_LIFECYCLE_ACTIONS_BY_OPERATION.get(normalized) ?? null;
}
