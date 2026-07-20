import { createHash } from "node:crypto";

import {
  computeDemandPayloadDigest,
  type DemandAttribution,
  type DemandAudience,
  type DemandEnvelopeV1,
} from "./federated-demand-contract";
import type { FederationRole } from "./federation-link-types";

export const CHANNEL_POLICY_MODES = ["explicit"] as const;
export type ChannelPolicyMode = (typeof CHANNEL_POLICY_MODES)[number];

export const PARTNER_ACCOUNT_KINDS = [
  "reseller",
  "distributor",
  "service-provider",
  "technology-partner",
] as const;
export type PartnerAccountKind = (typeof PARTNER_ACCOUNT_KINDS)[number];

export const PARTNER_STANDINGS = ["pending", "active", "at-risk", "suspended", "terminated"] as const;
export type PartnerStanding = (typeof PARTNER_STANDINGS)[number];

export const PARTNER_TIERS = ["registered", "authorized", "silver", "gold", "platinum"] as const;
export type PartnerTier = (typeof PARTNER_TIERS)[number];

export const PARTNER_AGREEMENT_STATUSES = ["draft", "active", "expired", "terminated"] as const;
export type PartnerAgreementStatus = (typeof PARTNER_AGREEMENT_STATUSES)[number];

export const PARTNER_ENTITLEMENT_STATUSES = ["pending", "active", "suspended", "expired", "revoked"] as const;
export type PartnerEntitlementStatus = (typeof PARTNER_ENTITLEMENT_STATUSES)[number];

export function isPartnerStanding(value: string): value is PartnerStanding {
  return (PARTNER_STANDINGS as readonly string[]).includes(value);
}

/** Local-only, per-link selection policy. The record refs never leave the
 * source installation; the demand envelope carries only opaque network refs. */
export interface ChannelDemandPolicy {
  mode: ChannelPolicyMode;
  selectedRecordRefs: string[];
  attribution: DemandAttribution;
  allowTransitiveForwarding: boolean;
  forwardingAudiences: DemandAudience[];
  forwardingExpiresAt?: string;
}

export function channelPolicySelectsRecord(
  policy: ChannelDemandPolicy,
  localRecordRef: string,
): boolean {
  return policy.mode === "explicit" && policy.selectedRecordRefs.includes(localRecordRef);
}

export function audienceForOutboundRole(role: FederationRole): DemandAudience {
  if (role === "same-org-peer") return "internal";
  if (role === "channel-downstream") return "founder";
  if (role === "community-peer") return "community";
  return "partner";
}

export function forwardingGrantFromPolicy(
  policy: ChannelDemandPolicy,
): DemandEnvelopeV1["forwarding"] | undefined {
  if (!policy.allowTransitiveForwarding) return undefined;
  return {
    permitted: true,
    audiences: [...new Set(policy.forwardingAudiences)],
    ...(policy.forwardingExpiresAt ? { expiresAt: policy.forwardingExpiresAt } : {}),
  };
}

export interface ChannelForwardingInput {
  envelope: DemandEnvelopeV1;
  targetAudience: DemandAudience;
  forwardingInstallationId: string;
  receivingInstallationId: string;
  now?: Date;
}

/** Enforce the source's transitive-consent boundary before an intermediary
 * constructs any new route attestation. */
export function validateChannelForwarding(input: ChannelForwardingInput): string[] {
  const violations: string[] = [];
  const grant = input.envelope.forwarding;
  if (!grant?.permitted) violations.push("forwarding:not-permitted");
  if (!grant?.audiences.includes(input.targetAudience)) {
    violations.push("forwarding:audience-not-consented");
  }
  if (grant?.expiresAt && Date.parse(grant.expiresAt) < (input.now ?? new Date()).getTime()) {
    violations.push("forwarding:consent-expired");
  }
  if (input.forwardingInstallationId === input.receivingInstallationId) {
    violations.push("forwarding:self-target");
  }
  if (input.envelope.originInstallationId === input.forwardingInstallationId) {
    violations.push("forwarding:origin-cannot-intermediate");
  }
  if (input.envelope.route.some((hop) => hop.installationId === input.forwardingInstallationId)) {
    violations.push("forwarding:intermediary-already-in-route");
  }
  if (
    input.envelope.originInstallationId === input.receivingInstallationId
    || input.envelope.route.some((hop) => hop.installationId === input.receivingInstallationId)
  ) {
    violations.push("forwarding:receiver-already-in-route");
  }
  if (input.envelope.route.length >= 8) violations.push("forwarding:hop-limit");
  return violations;
}

export function forwardDemandEnvelope(input: ChannelForwardingInput & {
  relationshipKind: string;
  linkId: string;
}): DemandEnvelopeV1 {
  const violations = validateChannelForwarding(input);
  if (violations.length > 0) {
    throw new Error(`Demand forwarding refused: ${violations.join(", ")}`);
  }
  const receivedAt = (input.now ?? new Date()).toISOString();
  const attestationDigest = `sha256:${createHash("sha256")
    .update([
      input.linkId,
      input.envelope.originInstallationId,
      input.envelope.originRecordRef,
      String(input.envelope.originVersion),
      input.forwardingInstallationId,
      input.receivingInstallationId,
      input.targetAudience,
      receivedAt,
    ].join("\u0000"))
    .digest("hex")}`;
  const forwarded: DemandEnvelopeV1 = {
    ...input.envelope,
    audience: input.targetAudience,
    route: [...input.envelope.route, {
      installationId: input.forwardingInstallationId,
      relationshipKind: input.relationshipKind,
      receivedAt,
      attestationDigest,
    }],
    updatedAt: receivedAt,
    payloadDigest: "sha256:pending",
  };
  forwarded.payloadDigest = computeDemandPayloadDigest(forwarded);
  return forwarded;
}
