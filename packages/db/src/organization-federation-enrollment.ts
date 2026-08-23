// EP-MSP-FEDERATION · zero-touch same-organization enrollment.
//
// DPF's federation enrollment asks a human to approve every link on both sides.
// That ritual is correct for a CROSS-organization link — an MSP and its customer
// are separate sovereigns, and each must consent to the other. It is wrong for a
// SAME-organization link: the organization CA already answered the trust
// question when it issued the join package, and re-asking it by hand makes an
// install that is created and destroyed thousands of times unusable.
//
// This module decides, from evidence alone, whether a proposed link is one whose
// trust is already established. It never widens authority: an auto-enrolled link
// gets the same scoped projection and the same revocation path as a
// hand-approved one. It only removes a human confirmation that would restate
// what the certificate chain already proves.

import {
  isFederationRelationshipPreset,
  isFederationRole,
  isRoleAllowedForRelationship,
  type FederationRelationshipPreset,
  type FederationRole,
} from "./federation-link-types";

/** Why an enrollment was or was not derived from organization trust. */
export const ENROLLMENT_DECISIONS = ["auto-enroll", "manual-approval"] as const;
export type EnrollmentDecision = (typeof ENROLLMENT_DECISIONS)[number];

/**
 * Reasons a proposed link must fall back to human approval.
 *
 * Closed set so a caller can branch on cause, and so an operator surface can
 * explain the refusal instead of silently queueing a request.
 */
export const MANUAL_APPROVAL_REASONS = [
  "relationship-is-cross-organization",
  "organization-trust-not-configured",
  "root-fingerprint-mismatch",
  "peer-certificate-not-verified",
  "join-package-expired",
  "role-not-allowed-for-relationship",
  "organization-ref-mismatch",
] as const;
export type ManualApprovalReason = (typeof MANUAL_APPROVAL_REASONS)[number];

/**
 * Evidence about the local install's organization trust anchor.
 *
 * `rootFingerprint` is the pinned organization root CA fingerprint installed by
 * the join package. Absent means this install never joined an organization, so
 * no link can derive trust from one.
 */
export interface OrganizationTrustAnchor {
  rootFingerprint: string | null;
  organizationRef: string | null;
}

/**
 * Evidence presented by the peer at enrollment time.
 *
 * `certificateVerified` must be the result of an actual chain verification
 * against the pinned root — never a claim copied out of the peer's request body.
 */
export interface PeerEnrollmentEvidence {
  certificateVerified: boolean;
  presentedRootFingerprint: string | null;
  organizationRef: string | null;
  joinPackageExpiresAt: Date | null;
}

export interface EnrollmentProposal {
  relationshipPreset: FederationRelationshipPreset | string;
  role: FederationRole | string;
}

export interface EnrollmentEvaluation {
  decision: EnrollmentDecision;
  /** Present only when the decision is `manual-approval`. */
  reason?: ManualApprovalReason;
  /** One sentence an operator surface can show verbatim. */
  explanation: string;
}

function manual(reason: ManualApprovalReason, explanation: string): EnrollmentEvaluation {
  return { decision: "manual-approval", reason, explanation };
}

/**
 * Decide whether a proposed federation link may enrol without human approval.
 *
 * Pure and total. Every path that cannot *prove* same-organization trust returns
 * `manual-approval`, so a missing or unverifiable fact can never be the reason a
 * link auto-enrols. Time is injected rather than read so the decision is
 * reproducible.
 */
export function evaluateOrganizationEnrollment(input: {
  proposal: EnrollmentProposal;
  localTrust: OrganizationTrustAnchor;
  peer: PeerEnrollmentEvidence;
  now: Date;
}): EnrollmentEvaluation {
  const { proposal, localTrust, peer, now } = input;

  if (
    !isFederationRelationshipPreset(proposal.relationshipPreset) ||
    proposal.relationshipPreset !== "same-organization"
  ) {
    return manual(
      "relationship-is-cross-organization",
      "This link crosses an organization boundary, so both sides confirm it by hand.",
    );
  }

  if (
    !isFederationRole(proposal.role) ||
    !isRoleAllowedForRelationship("same-organization", proposal.role)
  ) {
    return manual(
      "role-not-allowed-for-relationship",
      `The role ${String(proposal.role)} is not one a same-organization link may take.`,
    );
  }

  if (!localTrust.rootFingerprint) {
    return manual(
      "organization-trust-not-configured",
      "This installation has not joined an organization, so there is no trust anchor to derive from.",
    );
  }

  if (!peer.certificateVerified) {
    return manual(
      "peer-certificate-not-verified",
      "The peer's certificate did not verify against the pinned organization root.",
    );
  }

  if (
    !peer.presentedRootFingerprint ||
    peer.presentedRootFingerprint !== localTrust.rootFingerprint
  ) {
    return manual(
      "root-fingerprint-mismatch",
      "The peer chains to a different organization root, so it is not the same organization.",
    );
  }

  if (
    !localTrust.organizationRef ||
    !peer.organizationRef ||
    localTrust.organizationRef !== peer.organizationRef
  ) {
    return manual(
      "organization-ref-mismatch",
      "The peer reports a different organization, so its trust anchor does not cover this link.",
    );
  }

  if (peer.joinPackageExpiresAt && peer.joinPackageExpiresAt.getTime() <= now.getTime()) {
    return manual(
      "join-package-expired",
      "The peer's join package has expired, so its organization membership must be re-established.",
    );
  }

  return {
    decision: "auto-enroll",
    explanation:
      "Both installations chain to the same organization root, so this link inherits organization trust and needs no separate approval.",
  };
}
