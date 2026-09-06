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
import type {
  WorkCaseRoomMeasure,
  WorkCaseRoomToolGrant,
  WorkCaseRoomTrigger,
} from "./room-definition-contract";

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

export * from "./room-definition-contract";

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
  /** How the room starts itself. Null where the opener is genuinely imperative. */
  trigger: WorkCaseRoomTrigger | null;
  /** Ceiling on tool authority inside the room; intersected, never additive. */
  toolGrant: WorkCaseRoomToolGrant;
  /** What the room reports about itself. */
  measures: readonly WorkCaseRoomMeasure[];
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
    definitionVersion: 2,
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
    trigger: {
      kind: "event",
      signal: "task-node-ready",
      description: "The orchestrator marks a node ready when its predecessors close.",
    },
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
        "thread_write",
      ],
    },
    measures: [
      { key: "node-cycle-time", label: "Node cycle time", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "backlog-item",
    definitionVersion: 2,
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
    trigger: null,
    toolGrant: {
      grantKeys: [
        "backlog_read",
        "backlog_write",
        "work_room_read",
      ],
    },
    measures: [
      { key: "throughput", label: "Items closed per week", bindingKey: "backlog-throughput" },
    ],
  },
  {
    sourceKey: "work-capsule",
    definitionVersion: 2,
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
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_capsule_read",
        "work_capsule_write",
        "work_capsule_adopt",
      ],
    },
    measures: [
      { key: "capsule-age", label: "Time since last evidence", bindingKey: "backlog-throughput" },
    ],
  },
  {
    sourceKey: "approval",
    definitionVersion: 2,
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
    trigger: {
      kind: "event",
      signal: "approval-requested",
      description: "A governed action needs a decision before it can proceed.",
    },
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "decision_record_create",
      ],
    },
    measures: [
      { key: "decision-age", label: "Time a decision has waited", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "data-control-operation",
    definitionVersion: 2,
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
    trigger: {
      kind: "event",
      signal: "data-control-operation-requested",
      description: "A retention, export, or erasure action enters the queue.",
    },
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "data_governance_validate",
        "retention_record_write",
      ],
    },
    measures: [
      { key: "reconciliation-state", label: "Targets still unreconciled", bindingKey: "obligations-status" },
    ],
  },
  {
    sourceKey: "manual-task",
    definitionVersion: 2,
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
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
      ],
    },
    measures: [
      { key: "task-age", label: "Time since the task was entered", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "scheduled",
    definitionVersion: 2,
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
    trigger: {
      kind: "cadence",
      rrule: "FREQ=DAILY",
      description: "The schedule's own recurrence opens each occurrence.",
    },
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
        "schedule_write",
      ],
    },
    measures: [
      { key: "occurrences-due", label: "Occurrences past their window", bindingKey: "obligations-status" },
    ],
  },
  {
    // Bookkeeping Work Room (BI-F8B6CF81, S-ROOM). A standing, cyclic room — the day-to-day books
    // loop recurs each period. Governed receipts because its writes (statement import, account
    // create, rule mutation) are consequential; decision scope is the customer's own books (WWWD).
    sourceKey: "bookkeeping-period",
    definitionVersion: 2,
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
    trigger: {
      kind: "cadence",
      rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
      description: "Each period close opens the next books cycle.",
    },
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
        "banking_read",
        "banking_write",
        "financial_read",
      ],
    },
    measures: [
      { key: "open-exceptions", label: "Unreconciled items in the period", bindingKey: "obligations-status" },
      { key: "period-close-age", label: "Days the period has stayed open", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "engagement",
    definitionVersion: 2,
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
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "crm_read",
        "crm_write",
        "work_engagement_read",
      ],
    },
    measures: [
      { key: "engagement-stage-age", label: "Time in the current stage", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "opportunity",
    definitionVersion: 2,
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
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "crm_read",
        "crm_write",
      ],
    },
    measures: [
      { key: "stage-age", label: "Time in the current stage", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "booking",
    definitionVersion: 2,
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
    trigger: {
      kind: "event",
      signal: "storefront-booking-confirmed",
      description: "A customer confirms a booking on the storefront.",
    },
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "crm_read",
        "resource_reservation_read",
        "resource_reservation_write",
      ],
    },
    measures: [
      { key: "no-show-rate", label: "Confirmed bookings not attended", bindingKey: "no-show-rate" },
    ],
  },
  {
    sourceKey: "storefront-booking",
    definitionVersion: 2,
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
    trigger: {
      kind: "event",
      signal: "storefront-booking-confirmed",
      description: "Alias of the booking trigger; kept for older callers.",
    },
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "crm_read",
        "resource_reservation_read",
        "resource_reservation_write",
      ],
    },
    measures: [
      { key: "no-show-rate", label: "Confirmed bookings not attended", bindingKey: "no-show-rate" },
    ],
  },
  {
    sourceKey: "activity",
    definitionVersion: 2,
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
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "crm_read",
        "crm_write",
      ],
    },
    measures: [
      { key: "activity-age", label: "Time since the activity fell due", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "coworker-engagement",
    definitionVersion: 1,
    displayLabel: "Coworker engagement",
    owningArea: "ai-workforce",
    domainCategory: "coworker-service",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the requested outcome for the coworker service engagement.",
    summaryProjection: "Use the coworker service, provider, approval context, and engagement status.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
    // An engagement is requested by a person, never scheduled or thresholded.
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
      ],
    },
    measures: [
      { key: "engagement-age", label: "Time since the engagement was requested", bindingKey: "lead-time" },
    ],
  },
  // ─── Employment lifecycle (EP-862820FD, BI-28EFA338) ────────────────────────
  //
  // The employment lifecycle is registry entries, not a workflow engine.
  // `docs/architecture/workroom-vocabulary-boundary.md` states that a Workroom
  // definition already declares outcome, trigger classes, authority, review,
  // escalation, completion rules and event-triggered spawn rules, and that later
  // work must deepen THIS registry rather than create a parallel template
  // subsystem. Building an engine beside it would be exactly the parallel-surface
  // defect that document exists to prevent.
  //
  // All five are `wwwd`: they coordinate a customer's decisions about their own
  // workforce, not platform-development decisions. AGENTS.md §11 forbids settling
  // those through `principle_decide`.
  //
  // Authority resolves through `apps/web/lib/workforce/approval-routing.ts` — the
  // existing accountable-approver chain walk, with its fail-loud unresolved
  // posture and transient on-leave `onBehalfOf` handling carried over unchanged.
  // No second approver model.
  {
    sourceKey: "worker-onboarding",
    definitionVersion: 1,
    displayLabel: "Worker onboarding",
    owningArea: "workforce",
    domainCategory: "employment-lifecycle",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the worker display name and the position being started.",
    summaryProjection:
      "Use the onboarding curriculum for the occupation, the accountable manager, and the provisioning steps still outstanding.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
    // Opened by a governed employment event, never by schedule or threshold.
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
      ],
    },
    measures: [
      { key: "worker-onboarding-age", label: "Time since the room opened", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "worker-change",
    definitionVersion: 1,
    displayLabel: "Worker change",
    owningArea: "workforce",
    domainCategory: "employment-lifecycle",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    titleProjection: "Use the worker display name and what changed.",
    summaryProjection:
      "Use the prior and new manager, department or position, the effective date, and the access changes that follow from it.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
    // Opened by a governed employment event, never by schedule or threshold.
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
      ],
    },
    measures: [
      { key: "worker-change-age", label: "Time since the room opened", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "worker-offboarding",
    definitionVersion: 1,
    displayLabel: "Worker offboarding",
    owningArea: "workforce",
    domainCategory: "employment-lifecycle",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    // Governed receipts, not observed events: a revocation that did not happen
    // must be visible as an outstanding obligation rather than an absent log line.
    // An offboarding room that closes while access remains live is the failure
    // mode this definition most needs to prevent.
    titleProjection: "Use the worker display name and the last working day.",
    summaryProjection:
      "Use the termination record, the dated revocations still outstanding, and the accountable manager.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
    // Opened by a governed employment event, never by schedule or threshold.
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
      ],
    },
    measures: [
      { key: "worker-offboarding-age", label: "Time since the room opened", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "worker-classification-review",
    definitionVersion: 1,
    displayLabel: "Worker classification review",
    owningArea: "workforce",
    domainCategory: "employment-lifecycle",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    // STANDING, unlike the other four. Classification is not a fact recorded once
    // at hire: engagements drift, and duration, increased direction and emerging
    // exclusivity are exactly the factors that change the answer. This room exists
    // to surface a determination for re-confirmation when those signals appear.
    // The platform never decides the classification — it makes the human's
    // recorded determination explicit, evidenced and consequential.
    titleProjection: "Use the worker display name and the classification under review.",
    summaryProjection:
      "Use the current determination, its author and evidence, the engagement-term drift that triggered the review, and the governing jurisdiction.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: STANDING_ROOM_PROJECTION,
    // Opened by a governed employment event, never by schedule or threshold.
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
      ],
    },
    measures: [
      { key: "worker-classification-review-age", label: "Time since the room opened", bindingKey: "lead-time" },
    ],
  },
  {
    sourceKey: "referral-intake",
    definitionVersion: 1,
    displayLabel: "Referral intake",
    owningArea: "workforce",
    domainCategory: "employment-lifecycle",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
    // Stays open to its vesting milestone: a referral bonus is a tenure-gated
    // payroll consequence, not an ad-hoc payment, and the room is what holds that
    // obligation until it matures. It emits a pay component line and never moves
    // money — the standing payroll boundary is unchanged.
    titleProjection: "Use the referred candidate and the referring worker.",
    summaryProjection:
      "Use the referrer, the application stage, the vesting milestone, and whether the referrer is excluded from the approval chain.",
    supportedTransitions: STANDARD_TRANSITIONS,
    receiptPolicy: GOVERNED_RECEIPT_POLICY,
    roomProjection: FINITE_ROOM_PROJECTION,
    // Opened by a governed employment event, never by schedule or threshold.
    trigger: null,
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "work_room_write",
      ],
    },
    measures: [
      { key: "referral-intake-age", label: "Time since the room opened", bindingKey: "lead-time" },
    ],
  },
  {
    // A field-service job dispatched to a provider from a confirmed booking.
    // Account resolution flows through the originating booking, so this source
    // is not itself an account-resolver key.
    sourceKey: "field-service-job",
    definitionVersion: 2,
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
    trigger: {
      kind: "event",
      signal: "field-service-job-dispatched",
      description: "A confirmed booking dispatches a job to a provider.",
    },
    toolGrant: {
      grantKeys: [
        "work_room_read",
        "crm_read",
        "resource_reservation_read",
        "schedule_write",
      ],
    },
    measures: [
      { key: "jobs-open", label: "Dispatched jobs not yet closed", bindingKey: "fulfilment" },
    ],
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
