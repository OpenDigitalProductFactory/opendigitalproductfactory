import {
  WORK_CASE_ACTION_VERBS,
  type WorkCaseActionVerb,
} from "./case-types";

export const WORK_CASE_WORK_ITEM_SOURCE_TYPES = [
  "task-node",
  "backlog-item",
  "approval",
  "manual-task",
  "scheduled",
] as const;

export type WorkCaseWorkItemSourceType =
  (typeof WORK_CASE_WORK_ITEM_SOURCE_TYPES)[number];

export type WorkCaseDecisionScope = "wwmd" | "wwwd" | "wsid";

export type WorkCaseReceiptKind =
  | "governed-action"
  | "observed-event"
  | "operator-note";

export type WorkCaseAccountResolverKey =
  | "engagement"
  | "opportunity"
  | "booking"
  | "activity";

export type WorkCaseSupportedTransition = WorkCaseActionVerb;

export interface WorkCaseReceiptPolicy {
  defaultReceiptKind: WorkCaseReceiptKind;
  receiptRequiredForConsequentialTransition: boolean;
}

export interface WorkCaseSourceRegistryEntry {
  sourceKey: string;
  displayLabel: string;
  owningArea: string;
  domainCategory: string;
  defaultDecisionScope: WorkCaseDecisionScope;
  accountResolverKey: WorkCaseAccountResolverKey | null;
  titleProjection: string;
  summaryProjection: string;
  supportedTransitions: readonly WorkCaseSupportedTransition[];
  receiptPolicy: WorkCaseReceiptPolicy;
}

const STANDARD_TRANSITIONS =
  WORK_CASE_ACTION_VERBS satisfies readonly WorkCaseSupportedTransition[];

const APPROVAL_TRANSITIONS = [
  "needs-input",
  "respond",
  "propose",
  "escalate",
  "complete",
  "cancel",
] as const satisfies readonly WorkCaseSupportedTransition[];

const SCHEDULED_TRANSITIONS = [
  "claim",
  "pause",
  "needs-input",
  "resume",
  "verify",
  "complete",
  "cancel",
] as const satisfies readonly WorkCaseSupportedTransition[];

const GOVERNED_RECEIPT_POLICY = {
  defaultReceiptKind: "governed-action",
  receiptRequiredForConsequentialTransition: true,
} as const satisfies WorkCaseReceiptPolicy;

const OBSERVED_RECEIPT_POLICY = {
  defaultReceiptKind: "observed-event",
  receiptRequiredForConsequentialTransition: true,
} as const satisfies WorkCaseReceiptPolicy;

export const WORK_CASE_SOURCE_REGISTRY = [
  {
    sourceKey: "task-node",
    displayLabel: "Task node",
    owningArea: "workflow-orchestration",
    domainCategory: "workflow",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the task node title.",
    summaryProjection: "Use the task node description and current assignee.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
  },
  {
    sourceKey: "backlog-item",
    displayLabel: "Backlog item",
    owningArea: "platform-backlog",
    domainCategory: "platform-development",
    defaultDecisionScope: "wwmd",
    accountResolverKey: null,
    titleProjection: "Use the backlog item title.",
    summaryProjection: "Use the backlog body, triage outcome, and linked epic.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
  },
  {
    sourceKey: "approval",
    displayLabel: "Approval request",
    owningArea: "decision-ledger",
    domainCategory: "approval",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the approval question.",
    summaryProjection: "Use the requested action, options, and evidence bundle.",
    supportedTransitions: APPROVAL_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
  },
  {
    sourceKey: "manual-task",
    displayLabel: "Manual task",
    owningArea: "workspace",
    domainCategory: "human-work",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the manually entered task title.",
    summaryProjection: "Use the manual task description and assignee context.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
  },
  {
    sourceKey: "scheduled",
    displayLabel: "Scheduled work",
    owningArea: "scheduler",
    domainCategory: "scheduled-work",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the schedule title and next run window.",
    summaryProjection: "Use schedule cadence, owner, and due window.",
    supportedTransitions: SCHEDULED_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
  },
  {
    sourceKey: "engagement",
    displayLabel: "Engagement",
    owningArea: "crm",
    domainCategory: "customer-engagement",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "engagement",
    titleProjection: "Use the engagement title.",
    summaryProjection: "Use engagement account, scope, and current stage.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
  },
  {
    sourceKey: "opportunity",
    displayLabel: "Opportunity",
    owningArea: "crm",
    domainCategory: "sales",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "opportunity",
    titleProjection: "Use the opportunity title.",
    summaryProjection: "Use opportunity account, value, and stage.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
  },
  {
    sourceKey: "booking",
    displayLabel: "Storefront booking",
    owningArea: "storefront",
    domainCategory: "customer-service",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "booking",
    titleProjection: "Use the booking reference and service request.",
    summaryProjection: "Use booking contact, account, requested service, and window.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
  },
  {
    sourceKey: "storefront-booking",
    displayLabel: "Storefront booking",
    owningArea: "storefront",
    domainCategory: "customer-service",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "booking",
    titleProjection: "Use the booking reference and service request.",
    summaryProjection: "Backward-compatible alias for the booking source projection.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
  },
  {
    sourceKey: "activity",
    displayLabel: "Activity",
    owningArea: "crm",
    domainCategory: "customer-activity",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "activity",
    titleProjection: "Use the activity subject.",
    summaryProjection: "Use activity account, owner, and due context.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
  },
] as const satisfies readonly WorkCaseSourceRegistryEntry[];

const SOURCE_REGISTRY_BY_KEY = new Map<string, WorkCaseSourceRegistryEntry>(
  WORK_CASE_SOURCE_REGISTRY.map((entry) => [entry.sourceKey, entry]),
);

export const WORK_CASE_ACCOUNT_RESOLVER_SOURCE_KEYS =
  WORK_CASE_SOURCE_REGISTRY
    .filter((entry) => entry.accountResolverKey !== null)
    .map((entry) => entry.sourceKey);

export function getWorkCaseSourceEntry(
  sourceKey: string | null | undefined,
): WorkCaseSourceRegistryEntry | null {
  const normalized = sourceKey?.trim();
  if (!normalized) return null;
  return SOURCE_REGISTRY_BY_KEY.get(normalized) ?? null;
}

export function getWorkCaseAccountResolverKey(
  sourceKey: string | null | undefined,
): WorkCaseAccountResolverKey | null {
  return getWorkCaseSourceEntry(sourceKey)?.accountResolverKey ?? null;
}
