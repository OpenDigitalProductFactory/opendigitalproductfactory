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
import type { InstallationEnvironmentClass } from "./installation-operating-intent";
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
  /**
   * The peer's class as the organization CA certified it (BI-0716C8A8); null
   * when unattested.
   */
  peerEnvironmentClass?: InstallationEnvironmentClass | null;
  /** The peer installation itself, e.g. `Windows DEV (did_ab12…9f0c)`. Display only. */
  peerInstallationLabel?: string | null;
  /** The peer's installation DID: what a paired reference should name (BI-B50BE189). */
  peerDeviceId?: string | null;
  /** The peer's pseudonymous installation id, also accepted as a declaration. */
  peerInstallationId?: string | null;
  revokedAt?: Date | null;
  quarantinedAt?: Date | null;
}

/** Why a declared paired reference no longer points at a live connection. */
export type StalePairedRefReason = "revoked" | "quarantined" | "not-trusted";

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
  /** The linked peer's attested class; null for a declared-only or unattested pairing. */
  peerEnvironmentClass: InstallationEnvironmentClass | null;
  /** The linked peer installation's display label; null when no link names it. */
  peerInstallationLabel: string | null;
  /**
   * Set when the operator's declaration names a link that is no longer live
   * (BI-B50BE189). The fallback to a live link still happens; this keeps the
   * dead reference visible instead of hiding it behind the live one.
   */
  staleDeclaredRef: { ref: string; reason: StalePairedRefReason } | null;
  /**
   * The installation DID the declaration should name instead, when it is stale
   * or names a link id. Null when the declaration is already right or there is
   * no live peer to point at.
   */
  repairRef: string | null;
}

/** A declaration names a link by its peer label, link id, installation DID or installation id. */
function namesLink(declared: string, link: PairingLink): boolean {
  return [link.peerLabel, link.linkId, link.peerDeviceId, link.peerInstallationId]
    .some((value) => value?.trim() === declared);
}

/** The declaration names a link that is no longer live. */
function staleReference(declared: string, links: readonly PairingLink[]): ResolvedPairing["staleDeclaredRef"] {
  const named = links.find((link) => link.linkId === declared);
  if (!named || isUsable(named)) return null;
  const reason: StalePairedRefReason = named.revokedAt ? "revoked" : named.quarantinedAt ? "quarantined" : "not-trusted";
  return { ref: declared, reason };
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
    .filter(isUsable)
    // Deterministic order: linkId, so equal input gives equal output and a
    // multi-peer organization does not flap between renders.
    .sort((a, b) => a.linkId.localeCompare(b.linkId));

  // A declaration naming one of the live peers picks that peer; otherwise the first.
  const chosen = (declared ? sameOrgLinks.find((link) => namesLink(declared, link)) : undefined) ?? sameOrgLinks[0];
  const staleDeclaredRef = declared ? staleReference(declared, input.links) : null;

  if (chosen) {
    const ref = chosen.peerLabel?.trim() || chosen.linkId;
    const did = chosen.peerDeviceId?.trim() || null;
    // A link id is not an installation: point the declaration at the peer's DID.
    const repairRef = did && declared !== did && (staleDeclaredRef || declared === chosen.linkId) ? did : null;
    return {
      ref,
      source: "federation-link",
      linkId: chosen.linkId,
      declaredButUnconfirmed: declared !== null && !namesLink(declared, chosen),
      peerEnvironmentClass: chosen.peerEnvironmentClass ?? null,
      peerInstallationLabel: chosen.peerInstallationLabel?.trim() || null,
      staleDeclaredRef,
      repairRef,
    };
  }

  if (declared) {
    return {
      ref: declared, source: "declared-intent", declaredButUnconfirmed: true,
      peerEnvironmentClass: null, peerInstallationLabel: null, staleDeclaredRef, repairRef: null,
    };
  }

  return {
    ref: null, source: "none", declaredButUnconfirmed: false,
    peerEnvironmentClass: null, peerInstallationLabel: null, staleDeclaredRef: null, repairRef: null,
  };
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
