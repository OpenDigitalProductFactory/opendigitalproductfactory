// EP-MSP-FEDERATION / EP-1FABA22D — resolve which installation this one is
// paired with, from the federation links that actually exist.
//
// `pairedProductionInstallationRef` on the operating intent is free text an
// operator types. That made it a second, weaker copy of a fact `FederationLink`
// already owns: it drifts the moment a link is created or revoked without the
// operator retyping it, and a reseeded install silently loses its pairing while
// the links themselves are untouched.
//
// This module makes the established link the source of truth and demotes the
// typed value to what it always was — an operator's stated intent, useful only
// when no link exists yet to confirm it.

import type { FederationRelationshipPreset } from "./federation-link-types";
import type { TrustState } from "./trust-link-lifecycle";

/**
 * Link states that represent a peer this installation may actually work with.
 *
 * `trusted` is the only usable state by design: `pending` means the dual
 * approval the handshake exists to obtain has not completed, and `quarantined` /
 * `revoked` are explicit operator withdrawals. Typed as `Set<TrustState>` so a
 * member outside the closed vocabulary is a compile error — the previous set
 * held `active` / `approved`, which `resolveLinkTrust` never produces, so no
 * link could ever count and work sync reported "nowhere to mirror" while
 * mirroring succeeded (BI-D92A50F4).
 */
const USABLE_LINK_STATES: ReadonlySet<string> = new Set<TrustState>(["trusted"]);

/** Where the resolved pairing came from. Never inferred beyond these. */
export const PAIRING_SOURCES = ["federation-link", "declared-intent", "none"] as const;
export type PairingSource = (typeof PAIRING_SOURCES)[number];

/** A federation link as this resolver needs to see it. */
export interface PairingLink {
  linkId: string;
  linkState: string;
  relationshipPreset: FederationRelationshipPreset | string;
  /** Operator-facing name of the peer, when the link records one. */
  peerLabel?: string | null;
  revokedAt?: Date | null;
  quarantinedAt?: Date | null;
}

export interface ResolvedPairing {
  /** The peer to show and mirror work to, or null when there is none. */
  ref: string | null;
  source: PairingSource;
  /** Set when the pairing came from a link, so callers can navigate to it. */
  linkId?: string;
  /**
   * True when an operator declared a pairing that no live link corroborates.
   * The stance stays cautious in that case: a typed name is a statement of
   * intent, not evidence that a peer is reachable and trusted.
   */
  declaredButUnconfirmed: boolean;
}

function isUsable(link: PairingLink): boolean {
  if (link.revokedAt) return false;
  if (link.quarantinedAt) return false;
  return USABLE_LINK_STATES.has(link.linkState);
}

/**
 * Resolve the installation this one is paired with.
 *
 * A live same-organization link wins over the declared value, because the link
 * is evidence and the declaration is an assertion. When links disagree with the
 * declaration, the link is reported and `declaredButUnconfirmed` records that the
 * operator's typed value did not match — surfaced rather than silently ignored.
 *
 * Pure and total: no database access, no clock.
 */
export function resolveInstallationPairing(input: {
  declaredRef?: string | null;
  links: readonly PairingLink[];
}): ResolvedPairing {
  const declared = input.declaredRef?.trim() || null;

  const sameOrgLinks = input.links
    .filter((link) => link.relationshipPreset === "same-organization")
    .filter(isUsable);

  // Deterministic pick: linkId ordering, so equal input gives equal output and
  // a multi-peer organization does not flap between renders.
  const chosen = [...sameOrgLinks].sort((a, b) => a.linkId.localeCompare(b.linkId))[0];

  if (chosen) {
    const ref = chosen.peerLabel?.trim() || chosen.linkId;
    return {
      ref,
      source: "federation-link",
      linkId: chosen.linkId,
      declaredButUnconfirmed: declared !== null && declared !== ref,
    };
  }

  if (declared) {
    return { ref: declared, source: "declared-intent", declaredButUnconfirmed: true };
  }

  return { ref: null, source: "none", declaredButUnconfirmed: false };
}

/**
 * Whether work may be mirrored to the resolved peer.
 *
 * Mirroring needs a real link: a typed name gives nothing to send work to. This
 * is what keeps the `workSync` stance honest on an installation whose operator
 * declared a peer that was never established.
 */
export function pairingSupportsWorkSync(pairing: ResolvedPairing): boolean {
  return pairing.source === "federation-link";
}
