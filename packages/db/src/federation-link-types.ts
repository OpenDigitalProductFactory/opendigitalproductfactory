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

/** This deployment's role relative to the peer across a link. */
export const FEDERATION_ROLES = ["manages", "managed-by"] as const;
export type FederationRole = (typeof FEDERATION_ROLES)[number];

/** The peer holds the inverse role: if we manage them, they are managed-by us. */
export function inverseRole(role: FederationRole): FederationRole {
  return role === "manages" ? "managed-by" : "manages";
}

export function isFederationRole(value: string): value is FederationRole {
  return (FEDERATION_ROLES as readonly string[]).includes(value);
}

// Principal convergence (AGENTS.md §11): peers/operators are aliases on a
// Principal, never a parallel identity table.
export const FEDERATION_PEER_PRINCIPAL_KIND = "federated-peer";
export const FEDERATION_OPERATOR_PRINCIPAL_KIND = "federated-operator";
export const FEDERATION_PEER_ALIAS_TYPE = "federated-peer";
export const FEDERATION_OPERATOR_ALIAS_TYPE = "federated-operator";

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
