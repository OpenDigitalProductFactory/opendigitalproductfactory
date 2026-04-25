import type { FingerprintPolicyInput, FingerprintPolicyResult } from "./discovery-fingerprint-types";

const THRESHOLDS = {
  low: { identity: 0.95, taxonomy: 0.85, margin: 0.1, rolloutCap: 25 },
  medium: { identity: 0.97, taxonomy: 0.9, margin: 0.15, rolloutCap: 10 },
  high: { identity: 0.99, taxonomy: 0.95, margin: 0.2, rolloutCap: 3 },
  "customer-critical": null,
} as const;

export function evaluateFingerprintPolicy(input: FingerprintPolicyInput): FingerprintPolicyResult {
  const reasons: string[] = [];
  const threshold = THRESHOLDS[input.blastRadiusTier];

  if (!threshold) {
    reasons.push("customer_critical_blast_radius");
  } else {
    if (input.identityConfidence < threshold.identity) {
      reasons.push("identity_confidence_below_threshold");
    }
    if (input.taxonomyConfidence < threshold.taxonomy) {
      reasons.push("taxonomy_confidence_below_threshold");
    }
    if (input.candidateMargin < threshold.margin) {
      reasons.push("candidate_margin_below_threshold");
    }
    if (input.affectedEntityCount > threshold.rolloutCap) {
      reasons.push("rollout_cap_exceeded");
    }
  }

  if (input.evidenceFamilies.length < 2) {
    reasons.push("insufficient_evidence_families");
  }
  if (input.redactionStatus === "blocked_sensitive") {
    reasons.push("blocked_sensitive_evidence");
  }
  if (input.redactionStatus === "needs_review") {
    reasons.push("redaction_needs_review");
  }
  if (input.hasManualConflict) {
    reasons.push("manual_conflict");
  }
  if (input.hasEstateAmbiguity) {
    reasons.push("estate_ambiguity");
  }
  if (input.hasDeprecatedTaxonomyCandidate) {
    reasons.push("deprecated_taxonomy_candidate");
  }

  return {
    decision: reasons.length === 0 ? "auto_accept" : "human_review",
    reasons,
  };
}
