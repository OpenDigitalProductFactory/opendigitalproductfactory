// EP-MSP-FEDERATION — compose the evidence a pairing decision needs.
//
// The pieces exist separately: the trust anchor (§5.5), the chain observer
// (§5.7), the verification rule (§5.6), and the decision (§5.4). This gathers
// them for one discovered candidate and returns the mode plus the evidence that
// produced it, so a caller records WHY a peer was or was not eligible rather than
// just the verdict.
//
// Every dependency is injected. The composition therefore has no network or
// database of its own, and a test exercises the real decision logic rather than a
// mock of it.

import {
  decideAutomaticPairing,
  type AutomaticPairingDecision,
} from "@dpf/db/automatic-pairing-decision";
import type { OrganizationTrustAnchor } from "@dpf/db/organization-federation-enrollment";
import {
  verifyPeerChainAgainstRoot,
  type ObservedCertificate,
} from "@dpf/db/peer-certificate-verification";

/** What the caller knows about the candidate before any network work. */
export interface CandidateFacts {
  endpoint: string;
  /** `false` when discovery saw plain HTTP. */
  secure: boolean;
  relationshipPreset: string;
  role: string;
  /** The organization the peer advertises, when discovery captured one. */
  peerOrganizationRef: string | null;
  /** The peer's join-package expiry, when known. Null leaves that check open. */
  peerJoinPackageExpiresAt: Date | null;
}

export type ChainObservation =
  | { observed: true; chain: readonly ObservedCertificate[] }
  | { observed: false; reason: string };

/** The verdict plus the evidence that produced it, suitable for recording. */
export interface CandidatePairingResolution {
  decision: AutomaticPairingDecision;
  evidence: {
    chainObserved: boolean;
    chainFailureReason?: string;
    certificateVerified: boolean;
    presentedRootFingerprint: string | null;
    verificationFailure?: string;
    trustAnchorEstablished: boolean;
  };
}

/**
 * Resolve how one discovered candidate must be paired.
 *
 * The chain is observed only when discovery saw a secure transport. There is no
 * point dialling a plain-HTTP peer to inspect a certificate it does not present,
 * and the decision blocks that case regardless.
 */
export async function resolveCandidatePairingMode(input: {
  candidate: CandidateFacts;
  trustAnchor: OrganizationTrustAnchor;
  observeChain: (endpoint: string) => Promise<ChainObservation>;
  now: Date;
}): Promise<CandidatePairingResolution> {
  const { candidate, trustAnchor, now } = input;

  let chainObserved = false;
  let chainFailureReason: string | undefined;
  let certificateVerified = false;
  let presentedRootFingerprint: string | null = null;
  let verificationFailure: string | undefined;

  if (candidate.secure) {
    const observation = await input.observeChain(candidate.endpoint);
    if (observation.observed) {
      chainObserved = true;
      const verification = verifyPeerChainAgainstRoot({
        chain: observation.chain,
        pinnedRootFingerprint: trustAnchor.rootFingerprint,
        now,
      });
      certificateVerified = verification.verified;
      presentedRootFingerprint = verification.presentedRootFingerprint;
      if (!verification.verified) verificationFailure = verification.failure;
    } else {
      chainFailureReason = observation.reason;
    }
  }

  const decision = decideAutomaticPairing({
    transport: { secure: candidate.secure, chainValidated: certificateVerified },
    proposal: { relationshipPreset: candidate.relationshipPreset, role: candidate.role },
    localTrust: trustAnchor,
    peer: {
      certificateVerified,
      presentedRootFingerprint,
      organizationRef: candidate.peerOrganizationRef,
      joinPackageExpiresAt: candidate.peerJoinPackageExpiresAt,
    },
    now,
  });

  return {
    decision,
    evidence: {
      chainObserved,
      ...(chainFailureReason ? { chainFailureReason } : {}),
      certificateVerified,
      presentedRootFingerprint,
      ...(verificationFailure ? { verificationFailure } : {}),
      trustAnchorEstablished: trustAnchor.rootFingerprint !== null,
    },
  };
}
