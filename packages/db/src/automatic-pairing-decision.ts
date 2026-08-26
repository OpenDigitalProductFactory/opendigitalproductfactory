// EP-MSP-FEDERATION — decide whether a discovered LAN peer may pair without a
// human confirming it.
//
// Discovery already exists (`nearby-candidates`), enrolment already exists
// (`enrollment`), and `evaluateOrganizationEnrollment` already decides whether
// organization trust makes approval redundant. What was missing is the step that
// composes them: today every discovered peer routes through a SAS session where
// a person compares a short code, which is correct between strangers and
// unusable for an installation created and destroyed thousands of times.
//
// This module is that step. It never relaxes the SAS path — it decides which
// peers are entitled to skip it, and says why when they are not.

import {
  evaluateOrganizationEnrollment,
  type EnrollmentProposal,
  type ManualApprovalReason,
  type OrganizationTrustAnchor,
  type PeerEnrollmentEvidence,
} from "./organization-federation-enrollment";

/** How a discovered peer must be paired. */
export const PAIRING_MODES = ["auto-enroll", "operator-confirmation", "blocked"] as const;
export type PairingMode = (typeof PAIRING_MODES)[number];

/**
 * Why a peer cannot pair automatically.
 *
 * Transport reasons come first because they are absolute: an insecure candidate
 * is not merely unproven, it cannot carry a verifiable identity at all.
 */
export const PAIRING_BLOCK_REASONS = [
  "insecure-transport",
  "transport-not-validated",
] as const;
export type PairingBlockReason = (typeof PAIRING_BLOCK_REASONS)[number];

export type PairingDecisionReason = PairingBlockReason | ManualApprovalReason;

/**
 * What discovery observed about the candidate.
 *
 * Mirrors `AutomaticPairingReadiness` from `nearby-candidates` without importing
 * it, so this decision core stays free of the discovery module's runtime.
 */
export interface CandidateTransport {
  /** `false` when the candidate was advertised over plain HTTP. */
  secure: boolean;
  /**
   * True only when this installation actually validated the peer's certificate
   * chain against its pinned organization root. A candidate discovered over
   * HTTPS is not yet validated — `tls-validation-required` is a to-do, not a
   * result.
   */
  chainValidated: boolean;
}

export interface AutomaticPairingDecision {
  mode: PairingMode;
  reason?: PairingDecisionReason;
  /** One sentence an operator surface can show verbatim. */
  explanation: string;
}

/**
 * Decide how a discovered peer must be paired.
 *
 * Pure and total. Anything that cannot be proven routes to
 * `operator-confirmation`, which is the behaviour that exists today — so a gap in
 * evidence costs a human confirmation, never an unearned trust decision.
 */
export function decideAutomaticPairing(input: {
  transport: CandidateTransport;
  proposal: EnrollmentProposal;
  localTrust: OrganizationTrustAnchor;
  peer: PeerEnrollmentEvidence;
  now: Date;
}): AutomaticPairingDecision {
  if (!input.transport.secure) {
    return {
      mode: "blocked",
      reason: "insecure-transport",
      explanation:
        "This peer was advertised over plain HTTP, so its identity cannot be verified at all. Pair it through a manual invitation instead.",
    };
  }

  if (!input.transport.chainValidated) {
    return {
      mode: "operator-confirmation",
      reason: "transport-not-validated",
      explanation:
        "This peer's certificate has not been validated against the organization root yet, so confirm the pairing code with the other installation.",
    };
  }

  const enrollment = evaluateOrganizationEnrollment({
    proposal: input.proposal,
    localTrust: input.localTrust,
    peer: input.peer,
    now: input.now,
  });

  if (enrollment.decision === "auto-enroll") {
    return {
      mode: "auto-enroll",
      explanation: enrollment.explanation,
    };
  }

  return {
    mode: "operator-confirmation",
    reason: enrollment.reason,
    explanation: enrollment.explanation,
  };
}

/**
 * Whether a decision permits skipping the pairing code.
 *
 * Written as its own predicate so a caller cannot skip SAS by testing for the
 * absence of `blocked` and accidentally treating `operator-confirmation` as a
 * pass.
 */
export function mayPairWithoutOperator(decision: AutomaticPairingDecision): boolean {
  return decision.mode === "auto-enroll";
}
