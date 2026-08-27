// EP-MSP-FEDERATION — the composed pairing verdict for one discovered candidate.
//
// `resolveCandidatePairingMode` is deliberately dependency-injected: it takes a
// trust anchor and a chain observer so its tests exercise the real decision
// rather than a mock of it. That leaves someone to supply the production
// dependencies, and the pairing action is the wrong place for it — an action
// module should ask a question, not assemble the machinery that answers it.
//
// This is that assembly, in one named place, so the action reads as a single
// call and the wiring can be changed without touching it.

import type { AutomaticPairingDecision } from "@dpf/db/automatic-pairing-decision";

import { decryptSecret } from "@/lib/govern/credential-crypto";

import { observePeerCertificateChain } from "./observe-peer-certificate";
import { resolveOrganizationTrustAnchor } from "./organization-trust-anchor";
import { createOrganizationTrustAnchorStore } from "./organization-trust-anchor-store";
import { resolveCandidatePairingMode } from "./resolve-candidate-pairing-mode";

/** What the evidence supports, reduced to what a caller has to act on. */
export interface NearbyCandidatePairingVerdict {
  mode: AutomaticPairingDecision["mode"];
  reason?: AutomaticPairingDecision["reason"];
  explanation: string;
}

/**
 * Decide how a discovered candidate must be paired, using this installation's
 * real trust anchor and a real observation of the peer's certificate chain.
 *
 * Fails closed throughout: an install with no completed organization join has no
 * anchor, an unreachable peer yields no chain, and either one lands on
 * `operator-confirmation`. Nothing here can widen trust — it can only establish
 * that trust was already earned.
 */
export async function resolveNearbyCandidatePairing(input: {
  endpoint: string;
  /** False when discovery saw plain HTTP. */
  secure: boolean;
  relationshipPreset: string;
  role: string;
  /** The estate the peer advertised, already normalised by discovery. */
  peerOrganizationRef: string | null;
  now?: Date;
}): Promise<NearbyCandidatePairingVerdict> {
  const anchor = await resolveOrganizationTrustAnchor(createOrganizationTrustAnchorStore(), {
    decrypt: decryptSecret,
  });
  const resolution = await resolveCandidatePairingMode({
    candidate: {
      endpoint: input.endpoint,
      secure: input.secure,
      relationshipPreset: input.relationshipPreset,
      role: input.role,
      peerOrganizationRef: input.peerOrganizationRef,
      // A discovery record does not carry the peer's join-package expiry. Null
      // leaves that check open; the decision still requires a chain validating
      // against the pinned root, so this cannot widen trust.
      peerJoinPackageExpiresAt: null,
    },
    trustAnchor: anchor.anchor,
    observeChain: (endpoint) => observePeerCertificateChain(endpoint),
    now: input.now ?? new Date(),
  });
  return {
    mode: resolution.decision.mode,
    ...(resolution.decision.reason ? { reason: resolution.decision.reason } : {}),
    explanation: resolution.decision.explanation,
  };
}
