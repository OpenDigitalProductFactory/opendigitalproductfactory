import {
  WORK_CASE_ACTION_VERBS,
  type WorkCaseA2aStatus,
  type WorkCaseActionVerb,
} from "./case-types";

export type WorkCaseCoworkerEnvelopeRequirement =
  | "never"
  | "when-supervised"
  | "always";

/**
 * How much reshaping this action's gate allows before the middle path
 * (BI-81780B4A). Omit to take the platform default; an action may NARROW the
 * budget and never widen it past the ceiling — an action that could grant
 * itself unlimited attempts is an action that can loop forever by declaration.
 */
export interface WorkCaseActionShaping {
  maxAttempts?: number;
  maxOptions?: number;
}

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
  /** Optional narrowing of the default shaping budget. See gate-shaping.ts. */
  shaping?: WorkCaseActionShaping;
}

export type WorkroomLifecycleOperation =
  | "open-cycle"
  | "pause-cycle"
  | "verify-cycle"
  | "complete-cycle"
  | "carry-over"
  | "renew"
  | "split"
  | "archive";

export interface WorkroomLifecycleActionDescriptor {
  operation: WorkroomLifecycleOperation;
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
    sanctionedMutators: ["claim_workroom_scope", "update_backlog_item_status"],
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
    sanctionedMutators: ["update_workroom_status", "update_backlog_item_status"],
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
    sanctionedMutators: ["update_workroom_status", "update_backlog_item_status"],
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
    sanctionedMutators: ["run_sandbox_tests", "run_ux_test", "record_workroom_evidence"],
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
    sanctionedMutators: ["update_workroom_status", "update_backlog_item_status"],
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
    sanctionedMutators: ["update_workroom_status", "update_backlog_item_status"],
  },
  {
    action: "open-cycle",
    displayLabel: "Open cycle",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["WorkItem", "WorkItemMessage"],
  },
  {
    action: "pause-cycle",
    displayLabel: "Pause cycle",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["WorkItem", "WorkItemMessage"],
  },
  {
    action: "verify-cycle",
    displayLabel: "Verify cycle",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["RuntimeVerification", "WorkItemMessage"],
  },
  {
    action: "complete-cycle",
    displayLabel: "Complete cycle",
    a2aStatusHint: "completed",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["WorkItem", "WorkItemMessage"],
  },
  {
    action: "carry-over",
    displayLabel: "Carry over",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["WorkItem", "WorkItemMessage"],
  },
  {
    action: "renew",
    displayLabel: "Renew",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["WorkItem", "WorkItemMessage"],
  },
  {
    action: "split",
    displayLabel: "Split",
    a2aStatusHint: "working",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["WorkItem", "WorkItemMessage"],
  },
  {
    action: "archive",
    displayLabel: "Archive",
    a2aStatusHint: "completed",
    consequential: true,
    requiresPolicyEvaluation: true,
    requiresDecisionInteraction: false,
    requiresCoworkerEnvelope: "never",
    requiresReceipt: true,
    sanctionedMutators: ["WorkItem", "WorkItemMessage"],
  },
] as const satisfies readonly WorkCaseActionDescriptor[];

const WORK_CASE_ACTIONS_BY_VERB = new Map<WorkCaseActionVerb, WorkCaseActionDescriptor>(
  WORK_CASE_ACTION_REGISTRY.map((entry) => [entry.action, entry]),
);

export const WORKROOM_LIFECYCLE_ACTION_REGISTRY = [
  { operation: "open-cycle", displayLabel: "Open cycle", canonicalAction: "open-cycle" },
  { operation: "pause-cycle", displayLabel: "Pause cycle", canonicalAction: "pause-cycle" },
  { operation: "verify-cycle", displayLabel: "Verify cycle", canonicalAction: "verify-cycle" },
  { operation: "complete-cycle", displayLabel: "Complete cycle", canonicalAction: "complete-cycle" },
  { operation: "carry-over", displayLabel: "Carry over", canonicalAction: "carry-over" },
  { operation: "renew", displayLabel: "Renew", canonicalAction: "renew" },
  { operation: "split", displayLabel: "Split", canonicalAction: "split" },
  { operation: "archive", displayLabel: "Archive", canonicalAction: "archive" },
] as const satisfies readonly WorkroomLifecycleActionDescriptor[];

const WORKROOM_LIFECYCLE_ACTIONS_BY_OPERATION = new Map<
  WorkroomLifecycleOperation,
  WorkroomLifecycleActionDescriptor
>(WORKROOM_LIFECYCLE_ACTION_REGISTRY.map((entry) => [entry.operation, entry]));

export function getWorkCaseAction(
  action: string | null | undefined,
): WorkCaseActionDescriptor | null {
  const normalized = action?.trim() as WorkCaseActionVerb | undefined;
  if (!normalized || !WORK_CASE_ACTION_VERBS.includes(normalized)) return null;
  return WORK_CASE_ACTIONS_BY_VERB.get(normalized) ?? null;
}

export function getWorkroomLifecycleAction(
  operation: string | null | undefined,
): WorkroomLifecycleActionDescriptor | null {
  const normalized = operation?.trim() as WorkroomLifecycleOperation | undefined;
  if (!normalized) return null;
  return WORKROOM_LIFECYCLE_ACTIONS_BY_OPERATION.get(normalized) ?? null;
}
