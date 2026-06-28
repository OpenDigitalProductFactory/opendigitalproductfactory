import type { AutonomyLevel, RiskClass } from "@/lib/autonomy/trust-graduation";

import {
  evaluateWorkCaseActorCapability,
  type WorkCaseAgentCapabilityDescriptor,
} from "./agent-capability";
import type { WorkCaseActionVerb } from "./case-types";

export interface FederatedWorkCaseParticipationInput {
  descriptor: WorkCaseAgentCapabilityDescriptor;
  sourceKey: string;
  action: WorkCaseActionVerb;
  caseType?: string;
  risk: RiskClass;
  receiptSupported: boolean;
  stopConditionsSupported: boolean;
}

export type FederatedWorkCaseParticipationDenialReason =
  | "missing_authenticated_inbound_authority"
  | "missing_federation_link"
  | "untrusted_federation_link"
  | "missing_control_tower_visibility"
  | "missing_receipt_support"
  | "missing_stop_condition_support"
  | "unsupported_capability";

export type FederatedWorkCaseParticipationDecision =
  | {
      ok: true;
      participationMode: "delegate" | "propose";
      maxAutonomyLevel: AutonomyLevel;
      requiredControls: string[];
    }
  | {
      ok: false;
      reason: FederatedWorkCaseParticipationDenialReason;
      message: string;
    };

function deny(
  reason: FederatedWorkCaseParticipationDenialReason,
  message: string,
): FederatedWorkCaseParticipationDecision {
  return { ok: false, reason, message };
}

export function evaluateFederatedWorkCaseParticipation(
  input: FederatedWorkCaseParticipationInput,
): FederatedWorkCaseParticipationDecision {
  const { descriptor } = input;

  if (
    descriptor.authorityMode !== "authenticated-inbound" ||
    !descriptor.authenticatedInboundPrincipalId?.trim()
  ) {
    return deny(
      "missing_authenticated_inbound_authority",
      "Federated Work Case actors must use authenticated-inbound authority.",
    );
  }

  if (!descriptor.federation?.linkId) {
    return deny(
      "missing_federation_link",
      "Federated Work Case actors must carry a federation link reference.",
    );
  }

  if (descriptor.federation.trustState !== "trusted") {
    return deny(
      "untrusted_federation_link",
      `Federation link ${descriptor.federation.linkId} is ${descriptor.federation.trustState}.`,
    );
  }

  if (!descriptor.federation.controlTowerVisible) {
    return deny(
      "missing_control_tower_visibility",
      "Federated Work Case actors must be visible in a governance/control-tower surface.",
    );
  }

  if (!input.receiptSupported) {
    return deny(
      "missing_receipt_support",
      "Federated Work Case participation requires a receipt stream.",
    );
  }

  if (!input.stopConditionsSupported) {
    return deny(
      "missing_stop_condition_support",
      "Federated Work Case participation requires stop-condition support.",
    );
  }

  const capability = evaluateWorkCaseActorCapability(descriptor, {
    sourceKey: input.sourceKey,
    action: input.action,
    caseType: input.caseType,
  });
  if (!capability.ok) {
    return deny("unsupported_capability", capability.message);
  }

  const floorRisk = input.risk === "outbound-or-floor";

  return {
    ok: true,
    participationMode: floorRisk ? "propose" : "delegate",
    maxAutonomyLevel: floorRisk ? "propose" : "autopilot",
    requiredControls: [
      "authenticated-inbound-principal",
      "federation-link",
      "receipt-stream",
      "stop-conditions",
      "control-tower-visibility",
    ],
  };
}
