import { describe, expect, it } from "vitest";

import {
  scoreTrustVector,
  type TrustDimensionInput,
} from "@/lib/trust-vector";

const subject = {
  type: "assurance-scan",
  id: "scan-1",
  label: "Build assurance scan",
};

function dimension(
  key: TrustDimensionInput["key"],
  score: number | null,
  rationale: string,
  weight = 1,
): TrustDimensionInput {
  return {
    key,
    label: key,
    score,
    weight,
    rationale,
    evidenceRefs: [],
  };
}

describe("scoreTrustVector", () => {
  it("presents high-trust current facts when freshness, authority, coverage, and runtime are strong", () => {
    const assessment = scoreTrustVector({
      subject,
      asOf: "2026-05-26T12:00:00.000Z",
      dimensions: [
        dimension("freshness", 1, "Latest scan completed today."),
        dimension("sourceAuthority", 1, "AssuranceRun is the authoritative scan source."),
        dimension("coverageCompleteness", 0.95, "Scan covered the whole build."),
        dimension("runtimeAvailability", 1, "Scanner was available."),
      ],
    });

    expect(assessment.statementKind).toBe("current-fact");
    expect(assessment.tier).toBe("high");
    expect(assessment.action).toBe("present");
    expect(assessment.overallScore).toBeGreaterThanOrEqual(0.8);
  });

  it("turns stale high-risk scan findings into last-known facts that require refresh", () => {
    const assessment = scoreTrustVector({
      subject,
      asOf: "2026-05-26T12:00:00.000Z",
      riskLevel: "high",
      dimensions: [
        dimension("freshness", 0.2, "Latest scan completed 45 days ago.", 2),
        dimension("sourceAuthority", 1, "AssuranceFinding is authoritative for persisted findings."),
        dimension("evidenceGrade", 1, "The scan has a receipt."),
        dimension("runtimeAvailability", 1, "Scanner is currently available."),
      ],
    });

    expect(assessment.statementKind).toBe("last-known-fact");
    expect(assessment.action).toBe("refresh-required");
    expect(assessment.primaryRationale).toContain("45 days");
  });

  it("caps runtime-unavailable results at low trust and prevents present action", () => {
    const assessment = scoreTrustVector({
      subject: {
        type: "graph-view",
        id: "portfolio-map",
        label: "Portfolio graph",
      },
      asOf: "2026-05-26T12:00:00.000Z",
      dimensions: [
        dimension("freshness", 1, "Postgres records were read now."),
        dimension("sourceAuthority", 1, "Postgres is authoritative for products."),
        dimension("runtimeAvailability", 0.1, "Neo4j was unavailable."),
      ],
    });

    expect(assessment.tier).toBe("low");
    expect(assessment.statementKind).toBe("low-confidence-result");
    expect(assessment.action).not.toBe("present");
    expect(assessment.primaryRationale).toContain("Neo4j");
  });

  it("escalates contradicted source claims", () => {
    const assessment = scoreTrustVector({
      subject,
      asOf: "2026-05-26T12:00:00.000Z",
      dimensions: [
        dimension("freshness", 1, "Both sources were current."),
        dimension("sourceAuthority", 0.8, "Both sources are operational."),
        dimension("conflictContradiction", 0.1, "Inventory and scanner evidence disagree."),
      ],
    });

    expect(assessment.tier).toBe("low");
    expect(assessment.action).toBe("escalate");
    expect(assessment.statementKind).toBe("low-confidence-result");
  });

  it("does not penalize not-applicable dimensions", () => {
    const assessment = scoreTrustVector({
      subject,
      asOf: "2026-05-26T12:00:00.000Z",
      dimensions: [
        dimension("freshness", 1, "Latest scan completed today."),
        dimension("sourceAuthority", 1, "AssuranceRun is authoritative."),
        dimension("humanValidation", null, "No human review is required for this read-only summary.", 10),
      ],
    });

    expect(assessment.tier).toBe("high");
    expect(assessment.overallScore).toBe(1);
  });
});
