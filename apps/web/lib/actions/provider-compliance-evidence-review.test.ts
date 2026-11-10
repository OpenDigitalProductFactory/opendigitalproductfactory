import { describe, expect, it } from "vitest";

import { providerComplianceReviewUpdate } from "./provider-compliance-evidence-review-state";

describe("providerComplianceReviewUpdate", () => {
  it("renews retrieval evidence when the cited claims are confirmed", () => {
    const reviewedAt = new Date("2026-11-10T15:00:00.000Z");
    expect(providerComplianceReviewUpdate({
      decision: "confirmed",
      reviewedAt,
      reviewerId: "USR-1",
      existingLocator: { schemaVersion: "provider-compliance-source.v1", authority: "first-party" },
    })).toEqual({
      retrievedAt: reviewedAt,
      locator: {
        schemaVersion: "provider-compliance-source.v1",
        authority: "first-party",
        review: { decision: "confirmed", reviewedAt: reviewedAt.toISOString(), reviewerId: "USR-1" },
      },
    });
  });

  it("records changed evidence without renewing its retrieval date", () => {
    const reviewedAt = new Date("2026-11-10T15:00:00.000Z");
    expect(providerComplianceReviewUpdate({
      decision: "changed",
      reviewedAt,
      reviewerId: "USR-1",
      existingLocator: null,
    })).toEqual({
      locator: {
        review: { decision: "changed", reviewedAt: reviewedAt.toISOString(), reviewerId: "USR-1" },
      },
    });
  });
});
