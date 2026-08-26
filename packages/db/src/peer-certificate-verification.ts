// EP-MSP-FEDERATION — verify a discovered peer against the pinned organization
// root.
//
// `decideAutomaticPairing` will only auto-enrol a peer whose certificate chain
// was actually validated against this installation's organization root. Nothing
// produced that fact: discovery reports `tls-validation-required`, which is a
// to-do, and no peer-certificate inspection existed anywhere in the codebase.
//
// This module is the evaluation half. It is pure — the caller supplies the chain
// it observed — so the security rule is testable without a TLS server, and a
// network adapter cannot quietly change what "verified" means.

/** A certificate as observed on the wire, reduced to what the rule needs. */
export interface ObservedCertificate {
  /** SHA-256 fingerprint. Accepted colon-separated or bare, any case. */
  fingerprint256: string;
  /** True for the chain's terminal (root) certificate. */
  selfSigned: boolean;
  subject?: string;
  issuer?: string;
  validFrom?: Date;
  validTo?: Date;
}

export const PEER_VERIFICATION_FAILURES = [
  "empty-chain",
  "no-pinned-root",
  "chain-has-no-root",
  "root-fingerprint-mismatch",
  "certificate-expired",
  "certificate-not-yet-valid",
] as const;
export type PeerVerificationFailure = (typeof PEER_VERIFICATION_FAILURES)[number];

export type PeerVerification =
  | { verified: true; presentedRootFingerprint: string }
  | { verified: false; presentedRootFingerprint: string | null; failure: PeerVerificationFailure };

/**
 * Normalise a SHA-256 fingerprint for comparison.
 *
 * Node reports `AA:BB:CC:…`; a join package records 64 bare hex characters.
 * Comparing those forms directly would never match, so both collapse to lowercase
 * hex. Anything that is not exactly 64 hex characters after normalising is
 * rejected rather than compared loosely.
 */
export function normalizeFingerprint(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/:/g, "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(collapsed) ? collapsed : null;
}

function failed(
  failure: PeerVerificationFailure,
  presentedRootFingerprint: string | null = null,
): PeerVerification {
  return { verified: false, presentedRootFingerprint, failure };
}

/**
 * Decide whether an observed chain terminates at the pinned organization root.
 *
 * Pure and total. Verification requires a positive match against the pinned
 * fingerprint — there is no path where an absent, malformed, or unmatched value
 * yields `verified: true`.
 *
 * Validity windows are checked on every certificate in the chain, not only the
 * leaf: an expired intermediate breaks the chain just as surely.
 */
export function verifyPeerChainAgainstRoot(input: {
  chain: readonly ObservedCertificate[];
  pinnedRootFingerprint: string | null;
  now: Date;
}): PeerVerification {
  const pinned = normalizeFingerprint(input.pinnedRootFingerprint);
  if (!pinned) return failed("no-pinned-root");
  if (input.chain.length === 0) return failed("empty-chain");

  for (const certificate of input.chain) {
    if (certificate.validTo && certificate.validTo.getTime() <= input.now.getTime()) {
      return failed("certificate-expired");
    }
    if (certificate.validFrom && certificate.validFrom.getTime() > input.now.getTime()) {
      return failed("certificate-not-yet-valid");
    }
  }

  const root = input.chain.find((certificate) => certificate.selfSigned);
  if (!root) return failed("chain-has-no-root");

  const presented = normalizeFingerprint(root.fingerprint256);
  if (!presented) return failed("root-fingerprint-mismatch");
  if (presented !== pinned) return failed("root-fingerprint-mismatch", presented);

  return { verified: true, presentedRootFingerprint: presented };
}
