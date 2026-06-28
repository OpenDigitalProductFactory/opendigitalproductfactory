import { getWorkCaseAction } from "@/lib/work-management/action-registry";
import type { WorkCaseActionDescriptor } from "@/lib/work-management/action-registry";
import { type ReceiptEnvelope } from "@/lib/work-management/receipt-envelope";
import { assertWorkCaseReceiptCoverage } from "@/lib/work-management/receipt-coverage";
import {
  projectWorkCaseStagedTransition,
  type WorkCaseStagedTransitionProjection,
  type WorkCaseStagedTransitionStatus,
} from "@/lib/work-management/staged-transition";
import {
  isRecord,
  parseWorkCaseStagedTransitionProjection,
  stringArray,
  stringField,
} from "./work-pattern-case-json";
import type { WorkPatternCaseStagingState } from "./work-pattern-case-staging";
import type { WorkPatternCaseReceiptCoverage } from "./work-pattern-case-staging";

export const WORK_PATTERN_CASE_RESOLUTION_ACTIONS = [
  "approve",
  "defer",
  "reject",
] as const;
export type WorkPatternCaseResolutionAction =
  (typeof WORK_PATTERN_CASE_RESOLUTION_ACTIONS)[number];

export const WORK_PATTERN_CASE_RESOLUTION_STATUSES = [
  "approved-awaiting-receipt",
  "approved-ready-for-governed-commit",
  "deferred",
  "rejected",
  "blocked",
] as const;
export type WorkPatternCaseResolutionStatus =
  (typeof WORK_PATTERN_CASE_RESOLUTION_STATUSES)[number];

export type WorkPatternCaseResolutionState = {
  status: WorkPatternCaseResolutionStatus;
  action: WorkPatternCaseResolutionAction;
  activationAllowed: false;
  liveMutationAllowed: false;
  commitAllowed: boolean;
  decisionInteractionId: string;
  resolverUserId: string;
  resolvedAt: string;
  note: string | null;
  stagedTransition?: WorkCaseStagedTransitionProjection;
  receiptCoverage: WorkPatternCaseReceiptCoverage;
  receiptId: string | null;
  blockers: string[];
};

function compactUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function normalizedNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

function blocked(input: {
  action: WorkPatternCaseResolutionAction;
  decisionInteractionId: string;
  resolverUserId: string;
  resolvedAt: Date;
  note?: string | null;
  blockers: readonly string[];
  stagedTransition?: WorkCaseStagedTransitionProjection;
}): WorkPatternCaseResolutionState {
  return {
    status: "blocked",
    action: input.action,
    activationAllowed: false,
    liveMutationAllowed: false,
    commitAllowed: false,
    decisionInteractionId: input.decisionInteractionId,
    resolverUserId: input.resolverUserId,
    resolvedAt: input.resolvedAt.toISOString(),
    note: normalizedNote(input.note),
    stagedTransition: input.stagedTransition,
    receiptCoverage: "blocked",
    receiptId: null,
    blockers: compactUnique(input.blockers),
  };
}

function resolveTransitionStatus(
  action: WorkPatternCaseResolutionAction,
): WorkCaseStagedTransitionStatus {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  return "responded";
}

function transitionFor(input: {
  staging: WorkPatternCaseStagingState;
  action: WorkPatternCaseResolutionAction;
  decisionInteractionId: string;
}): WorkCaseStagedTransitionProjection | undefined {
  if (!input.staging.transitionId || !input.staging.action) return undefined;
  return projectWorkCaseStagedTransition({
    transitionId: input.staging.transitionId,
    action: input.staging.action,
    status: resolveTransitionStatus(input.action),
    decisionInteractionId: input.decisionInteractionId,
  });
}

function missingStageableBlockers(staging: WorkPatternCaseStagingState): string[] {
  const blockers = ["case-proposal-not-stageable", ...staging.blockers];
  if (!staging.action) blockers.push("missing-work-case-action");
  if (!staging.transitionId) blockers.push("missing-staged-transition");
  return compactUnique(blockers);
}

function receiptCoverageFor(input: {
  staging: WorkPatternCaseStagingState;
  action: WorkCaseActionDescriptor;
  receipt?: ReceiptEnvelope | null;
}): {
  status: WorkPatternCaseResolutionStatus;
  commitAllowed: boolean;
  receiptCoverage: WorkPatternCaseReceiptCoverage;
  receiptId: string | null;
  blockers: string[];
} {
  if (!input.staging.enforcementMode || !input.staging.requiredReceiptKind) {
    return {
      status: "blocked",
      commitAllowed: false,
      receiptCoverage: "blocked",
      receiptId: null,
      blockers: ["missing-policy-preview"],
    };
  }

  const receiptCoverage = assertWorkCaseReceiptCoverage({
    action: input.action,
    policyDecision: {
      ok: true,
      enforcementMode: input.staging.enforcementMode,
      requiredReceiptKind: input.staging.requiredReceiptKind,
    },
    projectedState: {
      state: input.staging.stagedTransition?.caseState ?? "awaiting-decision",
      terminal: false,
    },
    receipt: input.receipt ?? null,
  });

  if (!receiptCoverage.ok) {
    if (receiptCoverage.reason === "missing_receipt") {
      return {
        status: "approved-awaiting-receipt",
        commitAllowed: false,
        receiptCoverage: "required-before-commit",
        receiptId: null,
        blockers: ["receipt-required-before-commit"],
      };
    }
    return {
      status: "blocked",
      commitAllowed: false,
      receiptCoverage: "blocked",
      receiptId: null,
      blockers: [`receipt-${receiptCoverage.reason}`],
    };
  }

  return {
    status: "approved-ready-for-governed-commit",
    commitAllowed: true,
    receiptCoverage: input.action.requiresReceipt ? "covered" : "not-required",
    receiptId: receiptCoverage.receiptId ?? input.receipt?.receiptId ?? null,
    blockers: [],
  };
}

export function buildWorkPatternCaseResolution(input: {
  staging: WorkPatternCaseStagingState;
  action: WorkPatternCaseResolutionAction;
  decisionInteractionId: string;
  resolverUserId: string;
  resolvedAt: Date;
  note?: string | null;
  receipt?: ReceiptEnvelope | null;
}): WorkPatternCaseResolutionState {
  const stagedTransition = transitionFor({
    staging: input.staging,
    action: input.action,
    decisionInteractionId: input.decisionInteractionId,
  });

  if (input.staging.status !== "stageable") {
    return blocked({
      action: input.action,
      decisionInteractionId: input.decisionInteractionId,
      resolverUserId: input.resolverUserId,
      resolvedAt: input.resolvedAt,
      note: input.note,
      blockers: missingStageableBlockers(input.staging),
      stagedTransition,
    });
  }

  if (input.action === "reject" || input.action === "defer") {
    return {
      status: input.action === "reject" ? "rejected" : "deferred",
      action: input.action,
      activationAllowed: false,
      liveMutationAllowed: false,
      commitAllowed: false,
      decisionInteractionId: input.decisionInteractionId,
      resolverUserId: input.resolverUserId,
      resolvedAt: input.resolvedAt.toISOString(),
      note: normalizedNote(input.note),
      stagedTransition,
      receiptCoverage: "not-required",
      receiptId: null,
      blockers: [],
    };
  }

  const action = getWorkCaseAction(input.staging.action);
  if (!action) {
    return blocked({
      action: input.action,
      decisionInteractionId: input.decisionInteractionId,
      resolverUserId: input.resolverUserId,
      resolvedAt: input.resolvedAt,
      note: input.note,
      blockers: ["unknown-work-case-action"],
      stagedTransition,
    });
  }

  const coverage = receiptCoverageFor({
    staging: input.staging,
    action,
    receipt: input.receipt,
  });
  if (coverage.status === "blocked") {
    return blocked({
      action: input.action,
      decisionInteractionId: input.decisionInteractionId,
      resolverUserId: input.resolverUserId,
      resolvedAt: input.resolvedAt,
      note: input.note,
      blockers: coverage.blockers,
      stagedTransition,
    });
  }

  return {
    status: coverage.status,
    action: input.action,
    activationAllowed: false,
    liveMutationAllowed: false,
    commitAllowed: coverage.commitAllowed,
    decisionInteractionId: input.decisionInteractionId,
    resolverUserId: input.resolverUserId,
    resolvedAt: input.resolvedAt.toISOString(),
    note: normalizedNote(input.note),
    stagedTransition,
    receiptCoverage: coverage.receiptCoverage,
    receiptId: coverage.receiptId,
    blockers: coverage.blockers,
  };
}

function parseAction(value: unknown): WorkPatternCaseResolutionAction | null {
  return value === "approve" || value === "defer" || value === "reject" ? value : null;
}

function parseStatus(value: unknown): WorkPatternCaseResolutionStatus | null {
  return value === "approved-awaiting-receipt" ||
    value === "approved-ready-for-governed-commit" ||
    value === "deferred" ||
    value === "rejected" ||
    value === "blocked"
    ? value
    : null;
}

function parseReceiptCoverage(value: unknown): WorkPatternCaseReceiptCoverage | null {
  return value === "not-required" ||
    value === "required-before-commit" ||
    value === "covered" ||
    value === "blocked"
    ? value
    : null;
}

export function parseWorkPatternCaseResolutionState(
  value: unknown,
): WorkPatternCaseResolutionState | null {
  if (!isRecord(value)) return null;
  const status = parseStatus(value.status);
  const action = parseAction(value.action);
  const decisionInteractionId = stringField(value, "decisionInteractionId");
  const resolverUserId = stringField(value, "resolverUserId");
  const resolvedAt = stringField(value, "resolvedAt");
  const receiptCoverage = parseReceiptCoverage(value.receiptCoverage);
  if (
    !status ||
    !action ||
    !decisionInteractionId ||
    !resolverUserId ||
    !resolvedAt ||
    !receiptCoverage ||
    value.activationAllowed !== false ||
    value.liveMutationAllowed !== false ||
    typeof value.commitAllowed !== "boolean"
  ) {
    return null;
  }

  return {
    status,
    action,
    activationAllowed: false,
    liveMutationAllowed: false,
    commitAllowed: value.commitAllowed,
    decisionInteractionId,
    resolverUserId,
    resolvedAt,
    note: typeof value.note === "string" ? value.note : null,
    stagedTransition: parseWorkCaseStagedTransitionProjection(value.stagedTransition) ?? undefined,
    receiptCoverage,
    receiptId: typeof value.receiptId === "string" && value.receiptId.trim() ? value.receiptId : null,
    blockers: stringArray(value.blockers),
  };
}
