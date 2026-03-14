import { describe, expect, it } from "vitest";

import { evaluateInventoryQuality } from "./discovery-attribution";

describe("evaluateInventoryQuality", () => {
  it("creates a needs-review issue for an unmapped runtime entity", () => {
    const result = evaluateInventoryQuality([
      {
        entityKey: "service:dpf-web",
        entityType: "service",
        attributionStatus: "needs_review",
        taxonomyNodeId: null,
        digitalProductId: null,
        qualityStatus: "warning",
      },
    ]);

    expect(result.issues[0]?.issueType).toBe("attribution_missing");
  });
});
