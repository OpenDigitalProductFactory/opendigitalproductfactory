import { describe, expect, it } from "vitest";
import { evaluateFingerprintPolicy } from "./discovery-fingerprint-policy";

describe("evaluateFingerprintPolicy", () => {
  it("auto-accepts low blast-radius observations with strong evidence", () => {
    const result = evaluateFingerprintPolicy({
      identityConfidence: 0.96,
      taxonomyConfidence: 0.88,
      candidateMargin: 0.12,
      evidenceFamilies: ["container_image", "process_name"],
      redactionStatus: "not_required",
      blastRadiusTier: "low",
      hasDeprecatedTaxonomyCandidate: false,
      hasManualConflict: false,
      hasEstateAmbiguity: false,
      affectedEntityCount: 1,
    });

    expect(result.decision).toBe("auto_accept");
  });

  it("routes customer-critical observations to human review regardless of confidence", () => {
    const result = evaluateFingerprintPolicy({
      identityConfidence: 1,
      taxonomyConfidence: 1,
      candidateMargin: 0.5,
      evidenceFamilies: ["snmp", "http_banner"],
      redactionStatus: "redacted",
      blastRadiusTier: "customer-critical",
      hasDeprecatedTaxonomyCandidate: false,
      hasManualConflict: false,
      hasEstateAmbiguity: false,
      affectedEntityCount: 1,
    });

    expect(result.decision).toBe("human_review");
    expect(result.reasons).toContain("customer_critical_blast_radius");
  });
});
