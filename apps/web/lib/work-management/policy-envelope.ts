import type { EnvelopeStatus } from "../coworker/envelope-state-machine";
import {
  validateWorkCaseAccountability,
  type WorkCaseAccountabilityContext,
  type WorkCaseAccountabilityDenialReason,
} from "./accountability";
import { getWorkCaseAction } from "./action-registry";
import { gateDenialContract, type GateDisposition } from "./gate-shaping";
import type {
  WorkCaseActionVerb,
  WorkCaseEnforcementMode,
  WorkCaseRef,
  WorkCaseState,
} from "./case-types";
import {
  getWorkCaseSourceEntry,
  type WorkCaseReceiptKind,
} from "./source-registry";
import {
  hasPassingVerificationEvidence,
  type VerificationEvidence,
} from "./hitl-join";

export type WorkCaseAutonomyMode = "autonomous" | "supervised" | "observed";

export interface WorkCasePolicyEnvelope {
  autonomyMode: WorkCaseAutonomyMode;
  accountability?: WorkCaseAccountabilityContext | null;
  receiptPolicy?: {
    required: boolean;
    kind: WorkCaseReceiptKind;
  };
  sensitivityCeiling?: "low" | "medium" | "high" | "critical";
  /**
   * EP-WORK-POSTURE (BI-13ED1BE1). True when this turn must show verification
   * evidence before a consequential action may close — set by
   * resolveWorkCaseAutonomyEnvelope from the kernel-floor risk class or the
   * room posture's verification depth.
   */
  requiresVerification?: boolean;
}

export interface WorkCaseStopCondition {
  stopId: string;
  tripped: boolean;
  reason?: string;
}

export interface WorkCasePolicyInput {
  caseRef: WorkCaseRef;
  sourceKey?: string | null;
  action: WorkCaseActionVerb | string;
  currentState: Pick<{ state: WorkCaseState; terminal: boolean }, "state" | "terminal">;
  envelope: WorkCasePolicyEnvelope;
  coworkerEnvelope?: {
    envelopeId: string;
    status: EnvelopeStatus;
  } | null;
  decisionInteractionId?: string | null;
  stopConditions?: readonly WorkCaseStopCondition[];
  observedEvent?: boolean;
  /**
   * EP-WORK-POSTURE (BI-13ED1BE1). Verification recorded on the case. Consulted
   * only when the envelope requires verification; a turn that needs it and has
   * none is DENIED by name rather than allowed to close on a promise.
   */
  verificationEvidence?: readonly VerificationEvidence[] | null;
}

export type WorkCasePolicyDenialReason =
  | "unknown_source"
  | "unknown_action"
  | "unsupported_transition"
  | "terminal_case_sealed"
  | WorkCaseAccountabilityDenialReason
  | "missing_receipt_policy"
  | "stop_condition_tripped"
  | "missing_decision_interaction"
  | "missing_coworker_envelope"
  | "coworker_envelope_not_approved"
  | "missing_verification_evidence";

export type WorkCasePolicyDecision =
  | {
      ok: true;
      enforcementMode: WorkCaseEnforcementMode;
      requiredReceiptKind: WorkCaseReceiptKind;
    }
  | {
      ok: false;
      reason: WorkCasePolicyDenialReason;
      message: string;
      /**
       * What KIND of no this is (BI-81780B4A): one the caller can shape and
       * retry, one that needs a person, or one that never yields. Without it
       * every refusal read the same, so a coworker either stopped on something
       * it could have fixed in one move or ground against a stop that was
       * never going to give.
       */
      disposition: GateDisposition;
      /** What to change before retrying. Null for escalate and hard-no. */
      shapeHint: string | null;
    };

function deny(
  reason: WorkCasePolicyDenialReason,
  message: string,
): WorkCasePolicyDecision {
  const contract = gateDenialContract(reason);
  return {
    ok: false,
    reason,
    message,
    disposition: contract.disposition,
    shapeHint: contract.shapeHint,
  };
}

function requiresApprovedCoworkerEnvelope(input: WorkCasePolicyInput): boolean {
  const action = getWorkCaseAction(input.action);
  if (!action) return false;
  if (action.requiresCoworkerEnvelope === "always") return true;
  return (
    action.requiresCoworkerEnvelope === "when-supervised" &&
    input.envelope.autonomyMode === "supervised"
  );
}

export function evaluateWorkCasePolicy(
  input: WorkCasePolicyInput,
): WorkCasePolicyDecision {
  const sourceKey = input.sourceKey ?? input.caseRef.sourceType;
  const source = getWorkCaseSourceEntry(sourceKey);
  if (!source) {
    return deny("unknown_source", `Work Case source '${sourceKey}' is not registered.`);
  }

  const action = getWorkCaseAction(input.action);
  if (!action) {
    return deny("unknown_action", `Work Case action '${input.action}' is not registered.`);
  }

  if (!source.supportedTransitions.includes(action.action)) {
    return deny(
      "unsupported_transition",
      `${source.sourceKey} does not support Work Case action '${action.action}'.`,
    );
  }

  if (action.consequential && input.currentState.terminal) {
    return deny(
      "terminal_case_sealed",
      `Work Case ${input.caseRef.caseId} is terminal and cannot accept consequential action '${action.action}'.`,
    );
  }

  if (action.consequential && input.envelope.accountability) {
    const accountability = validateWorkCaseAccountability(input.envelope.accountability);
    if (!accountability.ok) {
      return deny(accountability.reason, accountability.message);
    }
  }

  const trippedStop = input.stopConditions?.find((condition) => condition.tripped);
  if (trippedStop) {
    return deny(
      "stop_condition_tripped",
      trippedStop.reason ?? `Stop condition '${trippedStop.stopId}' is tripped.`,
    );
  }

  // The check that makes verificationDepth load-bearing. Until this existed the
  // compiler emitted a depth, the UI rendered a "Deep verification" chip, and
  // nothing stopped the action closing unverified — a promise the system did
  // not keep. Scoped to consequential actions: reading and non-consequential
  // transitions are unaffected.
  if (action.consequential && input.envelope.requiresVerification) {
    if (!hasPassingVerificationEvidence(input.verificationEvidence)) {
      return deny(
        "missing_verification_evidence",
        `Work Case action '${action.action}' requires verification evidence before it can close.`,
      );
    }
  }

  if (action.requiresDecisionInteraction && !input.decisionInteractionId?.trim()) {
    return deny(
      "missing_decision_interaction",
      `Work Case action '${action.action}' requires a DecisionInteraction reference.`,
    );
  }

  if (requiresApprovedCoworkerEnvelope(input)) {
    if (!input.coworkerEnvelope) {
      return deny(
        "missing_coworker_envelope",
        `Work Case action '${action.action}' requires an approved CoworkerActionEnvelope.`,
      );
    }
    if (input.coworkerEnvelope.status !== "approved") {
      return deny(
        "coworker_envelope_not_approved",
        `CoworkerActionEnvelope ${input.coworkerEnvelope.envelopeId} is '${input.coworkerEnvelope.status}', not approved.`,
      );
    }
  }

  if ((action.requiresReceipt || source.receiptPolicy.receiptRequiredForConsequentialTransition) && !input.envelope.receiptPolicy) {
    return deny(
      "missing_receipt_policy",
      `Work Case action '${action.action}' requires a receipt policy.`,
    );
  }

  const enforcementMode: WorkCaseEnforcementMode =
    input.observedEvent || input.envelope.autonomyMode === "observed"
      ? "observed-event"
      : "governed-action";

  return {
    ok: true,
    enforcementMode,
    requiredReceiptKind:
      input.envelope.receiptPolicy?.kind ?? source.receiptPolicy.defaultReceiptKind,
  };
}
