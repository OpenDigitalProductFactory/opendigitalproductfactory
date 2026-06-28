import { getWorkCaseAction } from "@/lib/work-management/action-registry";
import type {
  WorkCaseActionVerb,
  WorkCaseEnforcementMode,
  WorkCaseRef,
} from "@/lib/work-management/case-types";
import { evaluateWorkCasePolicy } from "@/lib/work-management/policy-envelope";
import { assertWorkCaseReceiptCoverage } from "@/lib/work-management/receipt-coverage";
import type { WorkCaseReceiptKind } from "@/lib/work-management/source-registry";
import {
  projectWorkCaseStagedTransition,
  type WorkCaseStagedTransitionProjection,
} from "@/lib/work-management/staged-transition";
import {
  isRecord,
  parseWorkCaseStagedTransitionProjection,
  stringArray,
  stringField,
} from "./work-pattern-case-json";
import {
  parseWorkPatternCaseResolutionState,
  type WorkPatternCaseResolutionState,
} from "./work-pattern-case-resolution";
import type { WorkPatternReviewState } from "./work-pattern-review";
import type { WorkPatternMetadata } from "./work-pattern-types";

export const WORK_PATTERN_CASE_STAGING_STATUSES = [
  "not-case-bound",
  "blocked",
  "stageable",
] as const;
export type WorkPatternCaseStagingStatus =
  (typeof WORK_PATTERN_CASE_STAGING_STATUSES)[number];

export const WORK_PATTERN_CASE_RECEIPT_COVERAGE = [
  "not-required",
  "required-before-commit",
  "covered",
  "blocked",
] as const;
export type WorkPatternCaseReceiptCoverage =
  (typeof WORK_PATTERN_CASE_RECEIPT_COVERAGE)[number];

export type WorkPatternCaseProposalRail = {
  kind: "coworker-action-envelope-preview";
  envelopeStatus: "proposed";
  manifestActionId: string;
  argsJson: Record<string, unknown>;
  rationale: string;
};

export type WorkPatternCaseStagingState = {
  status: WorkPatternCaseStagingStatus;
  activationAllowed: false;
  liveMutationAllowed: false;
  caseRef?: WorkCaseRef;
  action?: WorkCaseActionVerb;
  transitionId?: string;
  stagedTransition?: WorkCaseStagedTransitionProjection;
  enforcementMode?: WorkCaseEnforcementMode;
  requiredReceiptKind?: WorkCaseReceiptKind;
  receiptCoverage: WorkPatternCaseReceiptCoverage;
  blockers: string[];
  proposalRail?: WorkPatternCaseProposalRail;
  resolution?: WorkPatternCaseResolutionState | null;
};

function notCaseBound(): WorkPatternCaseStagingState {
  return {
    status: "not-case-bound",
    activationAllowed: false,
    liveMutationAllowed: false,
    receiptCoverage: "not-required",
    blockers: [],
  };
}

function blocked(
  blockers: string[],
  partial: Partial<WorkPatternCaseStagingState> = {},
): WorkPatternCaseStagingState {
  return {
    status: "blocked",
    activationAllowed: false,
    liveMutationAllowed: false,
    receiptCoverage: "blocked",
    blockers: [...new Set(blockers)],
    ...partial,
  };
}

function isCaseBound(metadata: WorkPatternMetadata): boolean {
  return (
    metadata.scope === "case-type" ||
    metadata.scope === "case-transition" ||
    Boolean(metadata.workCaseBinding)
  );
}

function firstWorkCaseRef(metadata: WorkPatternMetadata): string | null {
  return metadata.evidence?.find((ref) => ref.workCaseRef?.trim())?.workCaseRef?.trim() ?? null;
}

function parseCaseRef(metadata: WorkPatternMetadata): WorkCaseRef | null {
  const raw = firstWorkCaseRef(metadata);
  if (!raw) return null;
  const separator = raw.indexOf(":");
  if (separator > 0 && separator < raw.length - 1) {
    const sourceType = raw.slice(0, separator).trim();
    const sourceId = raw.slice(separator + 1).trim();
    if (sourceType && sourceId) {
      return { caseId: raw, sourceType, sourceId };
    }
  }

  const sourceType = metadata.workCaseBinding?.caseType?.trim();
  if (!sourceType) return null;
  return {
    caseId: `${sourceType}:${raw}`,
    sourceType,
    sourceId: raw,
  };
}

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function transitionIdFor(input: {
  review: WorkPatternReviewState;
  caseRef: WorkCaseRef;
  action: WorkCaseActionVerb;
}): string {
  return `work-pattern:${input.caseRef.caseId}:${input.action}:${input.review.decisionInteractionId}`;
}

function needsCoworkerEnvelope(action: ReturnType<typeof getWorkCaseAction>): boolean {
  if (!action) return false;
  return action.requiresCoworkerEnvelope !== "never";
}

export function buildWorkPatternCaseStaging(input: {
  review: WorkPatternReviewState;
  metadata?: WorkPatternMetadata | null;
}): WorkPatternCaseStagingState {
  const { review, metadata } = input;
  if (
    !metadata ||
    !isCaseBound(metadata) ||
    review.action !== "approve" ||
    review.status !== "approved-candidate" ||
    !review.activationCandidate
  ) {
    return notCaseBound();
  }

  const binding = metadata.workCaseBinding;
  const caseRef = parseCaseRef(metadata);
  const blockers: string[] = [];
  if (!binding) blockers.push("missing-work-case-binding");
  if (!caseRef) blockers.push("missing-case-source-reference");
  if (!binding?.governedActionKey) blockers.push("missing-governed-action-key");
  if (!binding?.receiptPolicy) blockers.push("missing-receipt-policy");
  if (!binding?.authorityMode) blockers.push("missing-authority-mode");
  if (
    (binding?.authorityMode === "autonomous" || binding?.authorityMode === "on-behalf-of") &&
    !present(binding.sponsorPrincipalId)
  ) {
    blockers.push("missing-sponsor-principal");
  }
  if (
    binding?.authorityMode === "authenticated-inbound" &&
    !present(binding.sponsorPrincipalId)
  ) {
    blockers.push("missing-authenticated-inbound-principal");
  }

  const action = getWorkCaseAction(binding?.governedActionKey);
  if (binding?.governedActionKey && !action) blockers.push("unknown-governed-action-key");
  if (blockers.length > 0 || !binding || !caseRef || !action || !binding.receiptPolicy || !binding.authorityMode) {
    return blocked(blockers, {
      caseRef: caseRef ?? undefined,
      action: action?.action,
    });
  }

  const transitionId = transitionIdFor({ review, caseRef, action: action.action });
  const stagedTransition = projectWorkCaseStagedTransition({
    transitionId,
    action: action.action,
    status: "proposed",
    decisionInteractionId: review.decisionInteractionId,
  });
  const sponsorPrincipalId = binding.sponsorPrincipalId?.trim() ?? null;
  const policyDecision = evaluateWorkCasePolicy({
    caseRef,
    sourceKey: caseRef.sourceType,
    action: action.action,
    currentState: { state: "active", terminal: false },
    envelope: {
      autonomyMode: "supervised",
      accountability: {
        actor: { actorKind: "agent", actorId: review.agentId },
        authorityMode: binding.authorityMode,
        sponsorPrincipalId,
        delegatingPrincipalId:
          binding.authorityMode === "on-behalf-of" ? sponsorPrincipalId : null,
        authenticatedInboundPrincipalId:
          binding.authorityMode === "authenticated-inbound" ? sponsorPrincipalId : null,
        accountablePrincipalId: sponsorPrincipalId,
      },
      receiptPolicy: {
        required: true,
        kind: binding.receiptPolicy,
      },
    },
    // This is a static policy preview for the future commit path. The visible
    // proposal rail below remains proposed; no envelope row is written here.
    coworkerEnvelope: needsCoworkerEnvelope(action)
      ? { envelopeId: `preview:${transitionId}`, status: "approved" }
      : null,
    decisionInteractionId: review.decisionInteractionId,
  });

  if (!policyDecision.ok) {
    return blocked([`policy-${policyDecision.reason}`], {
      caseRef,
      action: action.action,
      transitionId,
      stagedTransition,
    });
  }

  const receiptCoverage = assertWorkCaseReceiptCoverage({
    action,
    policyDecision,
    projectedState: {
      state: stagedTransition.caseState,
      terminal: stagedTransition.terminal,
    },
    receipt: null,
  });
  if (!receiptCoverage.ok && receiptCoverage.reason !== "missing_receipt") {
    return blocked([`receipt-${receiptCoverage.reason}`], {
      caseRef,
      action: action.action,
      transitionId,
      stagedTransition,
      enforcementMode: policyDecision.enforcementMode,
      requiredReceiptKind: policyDecision.requiredReceiptKind,
    });
  }

  const receiptStatus: WorkPatternCaseReceiptCoverage = receiptCoverage.ok
    ? action.requiresReceipt
      ? "covered"
      : "not-required"
    : "required-before-commit";
  const receiptBlockers =
    receiptStatus === "required-before-commit"
      ? ["receipt-required-before-commit"]
      : [];

  return {
    status: "stageable",
    activationAllowed: false,
    liveMutationAllowed: false,
    caseRef,
    action: action.action,
    transitionId,
    stagedTransition,
    enforcementMode: policyDecision.enforcementMode,
    requiredReceiptKind: policyDecision.requiredReceiptKind,
    receiptCoverage: receiptStatus,
    blockers: receiptBlockers,
    proposalRail: {
      kind: "coworker-action-envelope-preview",
      envelopeStatus: "proposed",
      manifestActionId: `work-case.${action.action}`,
      argsJson: {
        caseRef: caseRef.caseId,
        sourceType: caseRef.sourceType,
        sourceId: caseRef.sourceId,
        action: action.action,
        transitionId,
        patternKey: review.patternKey,
        decisionInteractionId: review.decisionInteractionId,
        receiptPolicy: binding.receiptPolicy,
      },
      rationale: "Stage Work Case proposal from approved Living Playbook candidate.",
    },
  };
}

function parseCaseRefState(value: unknown): WorkCaseRef | null {
  if (!isRecord(value)) return null;
  const caseId = stringField(value, "caseId");
  const sourceType = stringField(value, "sourceType");
  const sourceId = stringField(value, "sourceId");
  return caseId && sourceType && sourceId ? { caseId, sourceType, sourceId } : null;
}

function parseProposalRail(value: unknown): WorkPatternCaseProposalRail | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.kind !== "coworker-action-envelope-preview" ||
    value.envelopeStatus !== "proposed"
  ) {
    return undefined;
  }
  const manifestActionId = stringField(value, "manifestActionId");
  const rationale = stringField(value, "rationale");
  if (!manifestActionId || !rationale) return undefined;
  return {
    kind: "coworker-action-envelope-preview",
    envelopeStatus: "proposed",
    manifestActionId,
    argsJson: isRecord(value.argsJson) ? value.argsJson : {},
    rationale,
  };
}

export function parseWorkPatternCaseStagingState(
  value: unknown,
): WorkPatternCaseStagingState | null {
  if (!isRecord(value)) return null;
  const status = stringField(value, "status");
  const blockers = stringArray(value.blockers);
  if (
    status !== "not-case-bound" &&
    status !== "blocked" &&
    status !== "stageable"
  ) {
    return null;
  }
  if (value.activationAllowed !== false || value.liveMutationAllowed !== false) {
    return null;
  }
  const receiptCoverage = stringField(value, "receiptCoverage");
  if (
    receiptCoverage !== "not-required" &&
    receiptCoverage !== "required-before-commit" &&
    receiptCoverage !== "covered" &&
    receiptCoverage !== "blocked"
  ) {
    return null;
  }

  if (status === "not-case-bound") {
    return {
      status,
      activationAllowed: false,
      liveMutationAllowed: false,
      receiptCoverage,
      blockers,
    };
  }

  const caseRef = parseCaseRefState(value.caseRef);
  const action = getWorkCaseAction(stringField(value, "action"))?.action;
  if (status === "stageable") {
    const transitionId = stringField(value, "transitionId");
    const stagedTransition = parseWorkCaseStagedTransitionProjection(value.stagedTransition);
    const enforcementMode = stringField(value, "enforcementMode");
    const requiredReceiptKind = stringField(value, "requiredReceiptKind");
    if (
      !caseRef ||
      !action ||
      !transitionId ||
      !stagedTransition ||
      (enforcementMode !== "governed-action" && enforcementMode !== "observed-event") ||
      (requiredReceiptKind !== "governed-action" &&
        requiredReceiptKind !== "observed-event" &&
        requiredReceiptKind !== "operator-note")
    ) {
      return null;
    }
    return {
      status,
      activationAllowed: false,
      liveMutationAllowed: false,
      caseRef,
      action,
      transitionId,
      stagedTransition,
      enforcementMode,
      requiredReceiptKind,
      receiptCoverage,
      blockers,
      proposalRail: parseProposalRail(value.proposalRail),
      resolution: parseWorkPatternCaseResolutionState(value.resolution),
    };
  }

  return {
    status,
    activationAllowed: false,
    liveMutationAllowed: false,
    caseRef: caseRef ?? undefined,
    action,
    transitionId: stringField(value, "transitionId") ?? undefined,
    stagedTransition: parseWorkCaseStagedTransitionProjection(value.stagedTransition) ?? undefined,
    enforcementMode:
      value.enforcementMode === "governed-action" || value.enforcementMode === "observed-event"
        ? value.enforcementMode
        : undefined,
    requiredReceiptKind:
      value.requiredReceiptKind === "governed-action" ||
      value.requiredReceiptKind === "observed-event" ||
      value.requiredReceiptKind === "operator-note"
        ? value.requiredReceiptKind
        : undefined,
    receiptCoverage,
    blockers,
    proposalRail: parseProposalRail(value.proposalRail),
    resolution: parseWorkPatternCaseResolutionState(value.resolution),
  };
}
