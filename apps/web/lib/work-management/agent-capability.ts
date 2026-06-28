import type { WorkCaseActionVerb, WorkCaseActorRef } from "./case-types";
import {
  validateWorkCaseAccountability,
  type WorkCaseAuthorityMode,
} from "./accountability";

export type WorkCaseCapabilityValue = string | "*";
export type WorkCaseAgentIoMode = "text" | "data" | "file" | "artifact";

export interface WorkCaseFederationDescriptor {
  linkId: string;
  peerOrganizationId: string;
  trustState: "untrusted" | "pending" | "trusted";
  controlTowerVisible: boolean;
}

export interface WorkCaseAgentCapabilityDescriptor {
  actor: WorkCaseActorRef;
  displayName: string;
  description?: string;
  authorityMode: WorkCaseAuthorityMode;
  sponsorPrincipalId?: string | null;
  delegatingPrincipalId?: string | null;
  authenticatedInboundPrincipalId?: string | null;
  accountablePrincipalId?: string | null;
  supportedSourceKeys: readonly WorkCaseCapabilityValue[];
  supportedActions: readonly (WorkCaseActionVerb | "*")[];
  caseTypes?: readonly WorkCaseCapabilityValue[];
  inputModes: readonly WorkCaseAgentIoMode[];
  outputModes: readonly WorkCaseAgentIoMode[];
  securitySchemes: readonly string[];
  supportsStreaming?: boolean;
  supportsLongRunning?: boolean;
  federation?: WorkCaseFederationDescriptor;
}

export interface WorkCaseCapabilityRequest {
  sourceKey: string;
  action: WorkCaseActionVerb;
  caseType?: string;
}

export type WorkCaseCapabilityDenialReason =
  | "missing_agent_sponsor"
  | "missing_delegating_principal"
  | "missing_authenticated_inbound_principal"
  | "unsupported_source"
  | "unsupported_action"
  | "unsupported_case_type";

export type WorkCaseCapabilityDecision =
  | {
      ok: true;
      score: number;
      descriptor: WorkCaseAgentCapabilityDescriptor;
    }
  | {
      ok: false;
      reason: WorkCaseCapabilityDenialReason;
      message: string;
    };

export interface WorkCaseAgentCardProjection {
  name: string;
  description: string;
  capabilities: {
    streaming: boolean;
    longRunning: boolean;
  };
  skills: Array<{
    id: string;
    name: string;
    tags: string[];
  }>;
  securitySchemes: readonly string[];
  dpfWorkCase: {
    actorId?: string;
    actorKind: WorkCaseActorRef["actorKind"];
    authorityMode: WorkCaseAuthorityMode;
    sponsorPrincipalId?: string | null;
    supportedSourceKeys: readonly WorkCaseCapabilityValue[];
    supportedActions: readonly (WorkCaseActionVerb | "*")[];
  };
}

function hasCapability(
  values: readonly WorkCaseCapabilityValue[],
  requested: string | undefined,
): boolean {
  if (values.includes("*")) return true;
  if (!requested) return false;
  return values.includes(requested);
}

function scoreMatch(
  descriptor: WorkCaseAgentCapabilityDescriptor,
  request: WorkCaseCapabilityRequest,
): number {
  let score = 0;
  score += descriptor.supportedSourceKeys.includes(request.sourceKey) ? 40 : 5;
  score += descriptor.supportedActions.includes(request.action) ? 30 : 5;
  const caseTypes = descriptor.caseTypes ?? ["*"];
  score += request.caseType && caseTypes.includes(request.caseType) ? 20 : 5;
  if (descriptor.supportsLongRunning) score += 3;
  if (descriptor.supportsStreaming) score += 2;
  return score;
}

function deny(
  reason: WorkCaseCapabilityDenialReason,
  message: string,
): WorkCaseCapabilityDecision {
  return { ok: false, reason, message };
}

export function evaluateWorkCaseActorCapability(
  descriptor: WorkCaseAgentCapabilityDescriptor,
  request: WorkCaseCapabilityRequest,
): WorkCaseCapabilityDecision {
  const accountability = validateWorkCaseAccountability({
    actor: descriptor.actor,
    authorityMode: descriptor.authorityMode,
    sponsorPrincipalId: descriptor.sponsorPrincipalId,
    delegatingPrincipalId: descriptor.delegatingPrincipalId,
    authenticatedInboundPrincipalId: descriptor.authenticatedInboundPrincipalId,
    accountablePrincipalId: descriptor.accountablePrincipalId,
  });
  if (!accountability.ok) {
    return deny(accountability.reason, accountability.message);
  }

  if (!hasCapability(descriptor.supportedSourceKeys, request.sourceKey)) {
    return deny(
      "unsupported_source",
      `${descriptor.displayName} does not advertise source '${request.sourceKey}'.`,
    );
  }

  if (!descriptor.supportedActions.includes("*") && !descriptor.supportedActions.includes(request.action)) {
    return deny(
      "unsupported_action",
      `${descriptor.displayName} does not advertise Work Case action '${request.action}'.`,
    );
  }

  if (request.caseType && !hasCapability(descriptor.caseTypes ?? ["*"], request.caseType)) {
    return deny(
      "unsupported_case_type",
      `${descriptor.displayName} does not advertise case type '${request.caseType}'.`,
    );
  }

  return {
    ok: true,
    score: scoreMatch(descriptor, request),
    descriptor,
  };
}

export function rankWorkCaseActors(
  descriptors: readonly WorkCaseAgentCapabilityDescriptor[],
  request: WorkCaseCapabilityRequest,
): Array<{ descriptor: WorkCaseAgentCapabilityDescriptor; score: number }> {
  return descriptors
    .map((descriptor) => evaluateWorkCaseActorCapability(descriptor, request))
    .filter((decision): decision is Extract<WorkCaseCapabilityDecision, { ok: true }> => decision.ok)
    .map((decision) => ({ descriptor: decision.descriptor, score: decision.score }))
    .sort((a, b) => b.score - a.score || a.descriptor.displayName.localeCompare(b.descriptor.displayName));
}

export function toWorkCaseAgentCard(
  descriptor: WorkCaseAgentCapabilityDescriptor,
): WorkCaseAgentCardProjection {
  const caseTypes = descriptor.caseTypes?.length ? descriptor.caseTypes : ["general"];

  return {
    name: descriptor.displayName,
    description: descriptor.description ?? `${descriptor.displayName} can participate in Work Cases.`,
    capabilities: {
      streaming: descriptor.supportsStreaming ?? false,
      longRunning: descriptor.supportsLongRunning ?? false,
    },
    skills: caseTypes.map((caseType) => ({
      id: `work-case:${caseType}`,
      name: caseType === "*" ? "Work Case" : caseType,
      tags: ["work-case", caseType],
    })),
    securitySchemes: descriptor.securitySchemes,
    dpfWorkCase: {
      actorId: descriptor.actor.actorId,
      actorKind: descriptor.actor.actorKind,
      authorityMode: descriptor.authorityMode,
      sponsorPrincipalId: descriptor.sponsorPrincipalId,
      supportedSourceKeys: descriptor.supportedSourceKeys,
      supportedActions: descriptor.supportedActions,
    },
  };
}
