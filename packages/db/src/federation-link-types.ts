// EP-MSP-FEDERATION · B1 — federation-link domain types + pure helpers
// (BI-130107D6). Keeps the role vocabulary, the Principal-convergence constants,
// and the trust derivation in one place so the enroll route, the approval
// actions, and the projection layer agree. Token generation (randomness, hashing)
// lives in the route/lib; this module stays pure.

import {
  resolveLinkTrust,
  TOKEN_PREFIXES,
  type LinkTrustInput,
  type TrustState,
} from "./trust-link-lifecycle";

/** The approved business relationship that supplies a link's initial policy. */
export const FEDERATION_RELATIONSHIP_PRESETS = [
  "same-organization",
  "service-provider",
  "channel",
  "community-peer",
] as const;
export type FederationRelationshipPreset = (typeof FEDERATION_RELATIONSHIP_PRESETS)[number];

/** This deployment's directional role relative to the peer across a link. */
export const FEDERATION_ROLES = [
  "manages",
  "managed-by",
  "channel-upstream",
  "channel-downstream",
  "same-org-peer",
  "community-peer",
] as const;
export type FederationRole = (typeof FEDERATION_ROLES)[number];

export const FEDERATION_RELATIONSHIP_ROLE_PAIRS: Record<
  FederationRelationshipPreset,
  readonly [FederationRole, FederationRole]
> = {
  "same-organization": ["same-org-peer", "same-org-peer"],
  "service-provider": ["manages", "managed-by"],
  channel: ["channel-upstream", "channel-downstream"],
  "community-peer": ["community-peer", "community-peer"],
};

const INVERSE_FEDERATION_ROLE: Record<FederationRole, FederationRole> = {
  manages: "managed-by",
  "managed-by": "manages",
  "channel-upstream": "channel-downstream",
  "channel-downstream": "channel-upstream",
  "same-org-peer": "same-org-peer",
  "community-peer": "community-peer",
};

/** The peer holds the inverse directional role; peer roles invert to themselves. */
export function inverseRole(role: FederationRole): FederationRole {
  return INVERSE_FEDERATION_ROLE[role];
}

export function isFederationRole(value: string): value is FederationRole {
  return (FEDERATION_ROLES as readonly string[]).includes(value);
}

export function isFederationRelationshipPreset(value: string): value is FederationRelationshipPreset {
  return (FEDERATION_RELATIONSHIP_PRESETS as readonly string[]).includes(value);
}

export function isRoleAllowedForRelationship(
  preset: FederationRelationshipPreset,
  role: FederationRole,
): boolean {
  return FEDERATION_RELATIONSHIP_ROLE_PAIRS[preset].includes(role);
}

// Principal convergence (AGENTS.md §11): peers/operators are aliases on a
// Principal, never a parallel identity table.
export const FEDERATION_PEER_PRINCIPAL_KIND = "federated-peer";
export const FEDERATION_OPERATOR_PRINCIPAL_KIND = "federated-operator";
export const FEDERATION_PEER_ALIAS_TYPE = "federated-peer";
export const FEDERATION_OPERATOR_ALIAS_TYPE = "federated-operator";

/** The canonical principalId of the federated-peer Principal a link enrols for
 *  its peer. One convention, two callers: enrolment mints it, work-sync reads it
 *  as the accountable owner of a mirrored deferral (BI-9DA5F179). */
export function federationPeerPrincipalId(linkId: string): string {
  return `principal_${linkId}`;
}

export const FEDERATION_LINK_TOKEN_PREFIX = TOKEN_PREFIXES.federationLink;
export const FEDERATION_BOOTSTRAP_TOKEN_PREFIX = TOKEN_PREFIXES.federationBootstrap;

// Token lifetimes (mirror the edge bootstrap/node TTLs).
export const FEDERATION_BOOTSTRAP_DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 min
export const FEDERATION_BOOTSTRAP_MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const FEDERATION_LINK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h rotation

/** The columns resolveLinkTrust needs, as carried on a FederationLink row. */
export interface FederationLinkTrustRow extends LinkTrustInput {
  linkState?: string;
}

/** Derive the authoritative trust state for a link row (dual-approval aware). */
export function linkStateFromRow(row: FederationLinkTrustRow): TrustState {
  return resolveLinkTrust({
    approvedAtLocal: row.approvedAtLocal,
    approvedAtPeer: row.approvedAtPeer,
    revokedAt: row.revokedAt,
    quarantinedAt: row.quarantinedAt,
  });
}

/** A link may exchange projections/proposals only when fully trusted. */
export function canExchangeOverLink(row: FederationLinkTrustRow): boolean {
  return linkStateFromRow(row) === "trusted";
}
