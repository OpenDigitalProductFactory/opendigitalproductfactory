import { describe, expect, it } from "vitest";

import { correctCareRecord, recordCareFact } from "./care";

describe("animal care facts", () => {
  it("corrects by superseding rather than erasing the earlier fact", () => {
    const original = recordCareFact({
      id: "care-1",
      organizationId: "org-rescue",
      subjectRef: "animal-1",
      kind: "weight",
      value: "18",
      unit: "kg",
      effectiveAt: new Date("2026-09-04T08:00:00Z"),
      authorPrincipalId: "principal-1",
    });
    const { prior, correction } = correctCareRecord(original, {
      id: "care-2",
      value: "8",
      reason: "Transcription correction",
      authorPrincipalId: "principal-2",
      recordedAt: new Date("2026-09-04T09:00:00Z"),
    });

    expect(prior.lifecycle).toBe("superseded");
    expect(prior.successorId).toBe("care-2");
    expect(correction.correctsId).toBe("care-1");
    expect(correction.value).toBe("8");
  });
});
