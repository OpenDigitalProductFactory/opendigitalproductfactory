import { describe, expect, it } from "vitest";

import { mergeProviderComplianceSourceEvidence } from "./effective-compliance-sources";

describe("mergeProviderComplianceSourceEvidence", () => {
  it("uses a later human-confirmed retrieval date for the governed source", () => {
    const result = mergeProviderComplianceSourceEvidence([{
      sourceKey: "openai/business-data-privacy",
      retrievedAt: new Date("2026-11-10T15:00:00.000Z"),
      locator: {
        schemaVersion: "provider-compliance-source.v1",
        review: { decision: "confirmed", reviewedAt: "2026-11-10T15:00:00.000Z" },
      },
    }]);

    expect(result["openai/business-data-privacy"].retrievedAt).toBe("2026-11-10T15:00:00.000Z");
  });

  it("does not renew a source merely because someone flagged it as changed", () => {
    const result = mergeProviderComplianceSourceEvidence([{
      sourceKey: "openai/business-data-privacy",
      retrievedAt: new Date("2026-11-10T15:00:00.000Z"),
      locator: {
        schemaVersion: "provider-compliance-source.v1",
        review: { decision: "changed", reviewedAt: "2026-11-10T15:00:00.000Z" },
      },
    }]);

    expect(result["openai/business-data-privacy"].retrievedAt).toBe("2026-07-20");
  });

  it("never lets an older confirmation move the governed date backwards", () => {
    const result = mergeProviderComplianceSourceEvidence([{
      sourceKey: "openai/business-data-privacy",
      retrievedAt: new Date("2026-07-01T00:00:00.000Z"),
      locator: { review: { decision: "confirmed" } },
    }]);

    expect(result["openai/business-data-privacy"].retrievedAt).toBe("2026-07-20");
  });
});
