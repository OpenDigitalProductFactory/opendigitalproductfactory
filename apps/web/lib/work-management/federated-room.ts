/**
 * Cross-install (GAID-federated) Work Room participation — pure core
 * (EP-WORKROOM-COMMS Phase 2, BI-4CA4FCE5).
 *
 * An external agent/person from another install may join a room — GAID-identified,
 * outcome-scoped, NEVER carte-blanche — and their posts are MIRRORED in (never a
 * direct remote write). This module holds the sovereignty gate and the mirrored-
 * message shape; the server binding (federated-room.server.ts) does the DB work.
 *
 * First slice is deliberately conservative: same-org trusted links only, behind a
 * flag. Design of record:
 * docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md §5
 */

export interface FederatedRoomGateInput {
  /** DPF_FEDERATION_A2A_ENABLED — the A2A room-federation feature flag. */
  a2aEnabled: boolean;
  /** The federation link is mutually approved and not revoked/quarantined. */
  linkTrusted: boolean;
  /** The peer is the SAME organization (first slice denies cross-org). */
  sameOrg: boolean;
}

export interface FederatedRoomGateDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "a2a-federation-disabled"
    | "link-not-trusted"
    | "cross-org-denied";
}

/**
 * The sovereignty gate every federated room admission/mirror must pass. All three
 * conditions are required; the first failure is reported. Deny-by-default.
 */
export function evaluateFederatedRoomAdmission(input: FederatedRoomGateInput): FederatedRoomGateDecision {
  if (!input.a2aEnabled) return { allowed: false, reason: "a2a-federation-disabled" };
  if (!input.linkTrusted) return { allowed: false, reason: "link-not-trusted" };
  if (!input.sameOrg) return { allowed: false, reason: "cross-org-denied" };
  return { allowed: true, reason: "allowed" };
}

export interface FederatedRoomMessageMirrorInput {
  foreignGaid: string;
  federationLinkId: string;
  /** Stable idempotency key from the peer event (providerKey:providerEventId shape). */
  messageId: string;
  body: string;
}

export interface FederatedRoomMessageMirror {
  messageId: string;
  senderType: "external";
  messageType: "external-event";
  channel: "a2a";
  body: string;
  structuredPayload: { federated: true; gaid: string; federationLinkId: string };
}

/**
 * Build the mirrored WorkItemMessage for an inbound federated room post. Sender is
 * "external" (no local user/agent); the GAID and link ride in structuredPayload —
 * mirroring the human external-channel ingress pattern. No schema change.
 */
export function buildFederatedRoomMessageMirror(
  input: FederatedRoomMessageMirrorInput,
): FederatedRoomMessageMirror {
  return {
    messageId: input.messageId,
    senderType: "external",
    messageType: "external-event",
    channel: "a2a",
    body: input.body,
    structuredPayload: {
      federated: true,
      gaid: input.foreignGaid,
      federationLinkId: input.federationLinkId,
    },
  };
}
