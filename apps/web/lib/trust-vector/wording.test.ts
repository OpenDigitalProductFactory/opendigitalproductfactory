import { describe, expect, it } from "vitest";

import {
  buildTrustMessage,
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
  score: number,
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

describe("buildTrustMessage", () => {
  it("uses current-fact wording when the assessment can be presented", () => {
    const assessment = scoreTrustVector({
      subject,
      asOf: "2026-05-26T12:00:00.000Z",
      dimensions: [
        dimension("freshness", 1, "Latest scan completed today."),
        dimension("sourceAuthority", 1, "AssuranceRun is authoritative."),
      ],
    });

    expect(buildTrustMessage(assessment, {
      currentFact: "No active findings.",
      lastKnownFact: "No active findings in the latest scan.",
    })).toBe("No active findings.");
  });

  it("qualifies stale scan claims as last-known facts", () => {
    const assessment = scoreTrustVector({
      subject,
      asOf: "2026-05-26T12:00:00.000Z",
      riskLevel: "high",
      dimensions: [
        dimension("freshness", 0.2, "Latest scan completed 45 days ago.", 2),
        dimension("sourceAuthority", 1, "AssuranceFinding is authoritative."),
        dimension("runtimeAvailability", 1, "Scanner is available."),
      ],
    });

    expect(buildTrustMessage(assessment, {
      currentFact: "No active findings.",
      lastKnownFact: "No active findings in the latest scan.",
    })).toBe(
      "No active findings in the latest scan. Latest scan completed 45 days ago.",
    );
  });

  it("explains low-confidence results without raw math", () => {
    const assessment = scoreTrustVector({
      subject: {
        type: "graph-view",
        id: "portfolio-map",
        label: "Portfolio graph",
      },
      asOf: "2026-05-26T12:00:00.000Z",
      dimensions: [
        dimension("freshness", 1, "Postgres records were read now."),
        dimension("runtimeAvailability", 0.1, "Neo4j was unavailable."),
      ],
    });

    const message = buildTrustMessage(assessment, {
      lowConfidenceResult: "This graph result is incomplete.",
    });

    expect(message).toBe("This graph result is incomplete. Neo4j was unavailable.");
    expect(message).not.toMatch(/\d+\.\d+/);
  });
});
