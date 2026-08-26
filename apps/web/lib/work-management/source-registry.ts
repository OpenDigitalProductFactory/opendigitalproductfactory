import {
  WORK_CASE_ACTION_VERBS,
  type WorkCaseActionVerb,
} from "./case-types";
import type {
  WorkroomCycleView,
  WorkroomDefinitionIdentity,
  WorkroomMode,
  WorkroomOutcomePacketCategory,
} from "./room-types";

export const WORK_CASE_WORK_ITEM_SOURCE_TYPES = [
  "task-node",
  "backlog-item",
  "work-capsule",
  "approval",
  "manual-task",
  "scheduled",
  "field-service-job",
  "data-control-operation",
  "bookkeeping-period",
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

export interface WorkCaseRoomProjectionPolicy {
  mode: WorkroomMode;
  cycleCarrierPrecedence: readonly WorkroomCycleView["carrierKind"][];
  outcomePacket: {
    requiredCategories: readonly WorkroomOutcomePacketCategory[];
  };
}

export interface WorkCaseSourceRegistryEntry {
  sourceKey: string;
  definitionVersion: number;
  displayLabel: string;
  owningArea: string;
  domainCategory: string;
  defaultDecisionScope: WorkCaseDecisionScope;
  accountResolverKey: WorkCaseAccountResolverKey | null;
  titleProjection: string;
  summaryProjection: string;
  supportedTransitions: readonly WorkCaseSupportedTransition[];
  receiptPolicy: WorkCaseReceiptPolicy;
  roomProjection: WorkCaseRoomProjectionPolicy;
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
  "open-cycle",
  "pause-cycle",
  "verify-cycle",
  "complete-cycle",
  "carry-over",
  "renew",
  "split",
  "archive",
] as const satisfies readonly WorkCaseSupportedTransition[];

const GOVERNED_RECEIPT_POLICY = {
  defaultReceiptKind: "governed-action",
  receiptRequiredForConsequentialTransition: true,
} as const satisfies WorkCaseReceiptPolicy;

const OBSERVED_RECEIPT_POLICY = {
  defaultReceiptKind: "observed-event",
  receiptRequiredForConsequentialTransition: true,
} as const satisfies WorkCaseReceiptPolicy;

const FINITE_ROOM_PROJECTION = {
  mode: "finite",
  cycleCarrierPrecedence: [],
  outcomePacket: {
    requiredCategories: ["evidence"],
  },
} as const satisfies WorkCaseRoomProjectionPolicy;

const APPROVAL_ROOM_PROJECTION = {
  mode: "finite",
  cycleCarrierPrecedence: [],
  outcomePacket: {
    requiredCategories: ["decisions", "receipts", "evidence"],
  },
} as const satisfies WorkCaseRoomProjectionPolicy;

const STANDING_ROOM_PROJECTION = {
  mode: "standing",
  cycleCarrierPrecedence: ["work-item", "work-capsule", "task-run"],
  outcomePacket: {
    requiredCategories: ["receipts", "evidence"],
  },
} as const satisfies WorkCaseRoomProjectionPolicy;

// The Bookkeeping Work Room (BI-F8B6CF81, S-ROOM). A standing room — the books loop recurs each
// period (monthly close). Its Outcome Packet must carry reconciliation `evidence`, the
// `receipts` for every governed banking write, and the `decisions` the owner signed off — the
// three things that make "period books reconciled" auditable rather than asserted.
const BOOKKEEPING_ROOM_PROJECTION = {
  mode: "standing",
  cycleCarrierPrecedence: ["work-item", "work-capsule", "task-run"],
  outcomePacket: {
    requiredCategories: ["evidence", "receipts", "decisions"],
  },
} as const satisfies WorkCaseRoomProjectionPolicy;

export const WORK_CASE_SOURCE_REGISTRY = [
  {
    sourceKey: "task-node",
    definitionVersion: 1,
    displayLabel: "Task node",
    owningArea: "workflow-orchestration",
    domainCategory: "workflow",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the task node title.",
    summaryProjection: "Use the task node description and current assignee.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
  },
  {
    sourceKey: "backlog-item",
    definitionVersion: 1,
    displayLabel: "Backlog item",
    owningArea: "platform-backlog",
    domainCategory: "platform-development",
    defaultDecisionScope: "wwmd",
    accountResolverKey: null,
    titleProjection: "Use the backlog item title.",
    summaryProjection: "Use the backlog body, triage outcome, and linked epic.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
  },
  {
    sourceKey: "work-capsule",
    definitionVersion: 1,
    displayLabel: "Work capsule",
    owningArea: "work-convergence",
    domainCategory: "platform-development",
    defaultDecisionScope: "wwmd",
    accountResolverKey: null,
    titleProjection: "Use the capsule title.",
    summaryProjection: "Use the capsule objective, current state, and evidence.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
  },
  {
    sourceKey: "approval",
    definitionVersion: 1,
    displayLabel: "Approval request",
    owningArea: "decision-ledger",
    domainCategory: "approval",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the approval question.",
    summaryProjection: "Use the requested action, options, and evidence bundle.",
    supportedTransitions: APPROVAL_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: APPROVAL_ROOM_PROJECTION,
  },
  {
    sourceKey: "data-control-operation",
    definitionVersion: 1,
    displayLabel: "Data control operation",
    owningArea: "data-governance",
    domainCategory: "data-control",
    defaultDecisionScope: "wwmd",
    accountResolverKey: null,
    titleProjection: "Use the data-control action and affected asset scope.",
    summaryProjection: "Use reconciliation state, failed targets, and verification evidence.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: APPROVAL_ROOM_PROJECTION,
  },
  {
    sourceKey: "manual-task",
    definitionVersion: 1,
    displayLabel: "Manual task",
    owningArea: "workspace",
    domainCategory: "human-work",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the manually entered task title.",
    summaryProjection: "Use the manual task description and assignee context.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
  },
  {
    sourceKey: "scheduled",
    definitionVersion: 1,
    displayLabel: "Scheduled work",
    owningArea: "scheduler",
    domainCategory: "scheduled-work",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the schedule title and next run window.",
    summaryProjection: "Use schedule cadence, owner, and due window.",
    supportedTransitions: SCHEDULED_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
    roomProjection: STANDING_ROOM_PROJECTION,
  },
  {
    // Bookkeeping Work Room (BI-F8B6CF81, S-ROOM). A standing, cyclic room — the day-to-day books
    // loop recurs each period. Governed receipts because its writes (statement import, account
    // create, rule mutation) are consequential; decision scope is the customer's own books (WWWD).
    sourceKey: "bookkeeping-period",
    definitionVersion: 1,
    displayLabel: "Bookkeeping period",
    owningArea: "finance",
    domainCategory: "bookkeeping",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the period label (e.g. the month being closed) and the accounts in scope.",
    summaryProjection: "Use the reconciliation state, open exceptions, and the decisions awaiting the owner.",
    supportedTransitions: SCHEDULED_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: BOOKKEEPING_ROOM_PROJECTION,
  },
  {
    sourceKey: "engagement",
    definitionVersion: 1,
    displayLabel: "Engagement",
    owningArea: "crm",
    domainCategory: "customer-engagement",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "engagement",
    titleProjection: "Use the engagement title.",
    summaryProjection: "Use engagement account, scope, and current stage.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
  },
  {
    sourceKey: "opportunity",
    definitionVersion: 1,
    displayLabel: "Opportunity",
    owningArea: "crm",
    domainCategory: "sales",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "opportunity",
    titleProjection: "Use the opportunity title.",
    summaryProjection: "Use opportunity account, value, and stage.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
  },
  {
    sourceKey: "booking",
    definitionVersion: 1,
    displayLabel: "Storefront booking",
    owningArea: "storefront",
    domainCategory: "customer-service",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "booking",
    titleProjection: "Use the booking reference and service request.",
    summaryProjection: "Use booking contact, account, requested service, and window.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
  },
  {
    sourceKey: "storefront-booking",
    definitionVersion: 1,
    displayLabel: "Storefront booking",
    owningArea: "storefront",
    domainCategory: "customer-service",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "booking",
    titleProjection: "Use the booking reference and service request.",
    summaryProjection: "Backward-compatible alias for the booking source projection.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
  },
  {
    sourceKey: "activity",
    definitionVersion: 1,
    displayLabel: "Activity",
    owningArea: "crm",
    domainCategory: "customer-activity",
    defaultDecisionScope: "wwwd",
    accountResolverKey: "activity",
    titleProjection: "Use the activity subject.",
    summaryProjection: "Use activity account, owner, and due context.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
  },
  {
    // A field-service job dispatched to a provider from a confirmed booking.
    // Account resolution flows through the originating booking, so this source
    // is not itself an account-resolver key.
    sourceKey: "field-service-job",
    definitionVersion: 1,
    displayLabel: "Field service job",
    owningArea: "storefront",
    domainCategory: "field-dispatch",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the booking reference, service, and scheduled window.",
    summaryProjection: "Use the assigned provider, customer, service, and scheduled time.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: OBSERVED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
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

export function getWorkroomDefinitionIdentity(
  sourceKey: string | null | undefined,
): WorkroomDefinitionIdentity | null {
  const entry = getWorkCaseSourceEntry(sourceKey);
  if (!entry) return null;

  return {
    definitionId: `workroom-definition:${entry.sourceKey}`,
    version: entry.definitionVersion,
    sourceKey: entry.sourceKey,
    label: entry.displayLabel,
    mode: entry.roomProjection.mode,
    decisionScope: entry.defaultDecisionScope,
  };
}

export function getWorkCaseAccountResolverKey(
  sourceKey: string | null | undefined,
): WorkCaseAccountResolverKey | null {
  return getWorkCaseSourceEntry(sourceKey)?.accountResolverKey ?? null;
}
