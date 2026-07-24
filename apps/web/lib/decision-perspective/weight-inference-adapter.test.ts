import { describe, expect, it, vi } from "vitest";
import { extractWeightInferenceObservations } from "./weight-inference-adapter";

// BI-D88DFEEA Phase 2. Pins: only rows carrying all three Phase 1 scoring
// columns are queried at all; a malformed/inconsistent row is reported in
// `failures`, never silently dropped or thrown; a clean row produces exactly
// the {chosenVector, recommendedVector} pair weight-inference.ts expects.

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    interactionId: "DI-1",
    domainClass: "risk-assessment",
    profileId: "prof-1",
    scoredOptions: [
      { id: "approve", description: "Approve", features: { speed_to_value: 0.8 } },
      { id: "defer", description: "Defer", features: { speed_to_value: 0.3 } },
    ],
    recommendedOptionId: "defer",
    chosenOptionId: "approve",
    ...overrides,
  };
}

describe("extractWeightInferenceObservations", () => {
  it("queries only rows with all three scoring columns present", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await extractWeightInferenceObservations({ db: { decisionInteraction: { findMany } } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scoredOptions: { not: null },
          recommendedOptionId: { not: null },
          chosenOptionId: { not: null },
        },
      }),
    );
  });

  it("filters by domainClass/profileId when supplied", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await extractWeightInferenceObservations({
      db: { decisionInteraction: { findMany } },
      domainClass: "risk-assessment",
      profileId: "prof-1",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ domainClass: "risk-assessment", profileId: "prof-1" }),
      }),
    );
  });

  it("extracts a clean observation from a well-formed row", async () => {
    const findMany = vi.fn().mockResolvedValue([row()]);
    const result = await extractWeightInferenceObservations({ db: { decisionInteraction: { findMany } } });
    expect(result.failures).toEqual([]);
    expect(result.observations).toEqual([
      {
        domainClass: "risk-assessment",
        profileId: "prof-1",
        chosenVector: { speed_to_value: 0.8 },
        recommendedVector: { speed_to_value: 0.3 },
      },
    ]);
  });

  it("reports (not throws) when recommendedOptionId does not match any scoredOptions entry", async () => {
    const findMany = vi.fn().mockResolvedValue([row({ recommendedOptionId: "reject" })]);
    const result = await extractWeightInferenceObservations({ db: { decisionInteraction: { findMany } } });
    expect(result.observations).toEqual([]);
    expect(result.failures).toEqual([
      { interactionId: "DI-1", reason: "recommendedOptionId-not-in-scoredOptions" },
    ]);
  });

  it("reports when chosenOptionId does not match any scoredOptions entry", async () => {
    const findMany = vi.fn().mockResolvedValue([row({ chosenOptionId: "reject" })]);
    const result = await extractWeightInferenceObservations({ db: { decisionInteraction: { findMany } } });
    expect(result.failures).toEqual([
      { interactionId: "DI-1", reason: "chosenOptionId-not-in-scoredOptions" },
    ]);
  });

  it("reports when scoredOptions is not a well-formed array, without throwing", async () => {
    const findMany = vi.fn().mockResolvedValue([row({ scoredOptions: "not-an-array" })]);
    const result = await extractWeightInferenceObservations({ db: { decisionInteraction: { findMany } } });
    expect(result.failures).toEqual([{ interactionId: "DI-1", reason: "scoredOptions-malformed" }]);
  });

  it("continues past a bad row and still extracts the good ones", async () => {
    const findMany = vi.fn().mockResolvedValue([
      row({ interactionId: "DI-bad", scoredOptions: null }),
      row({ interactionId: "DI-good" }),
    ]);
    const result = await extractWeightInferenceObservations({ db: { decisionInteraction: { findMany } } });
    expect(result.failures).toEqual([{ interactionId: "DI-bad", reason: "scoredOptions-malformed" }]);
    expect(result.observations).toHaveLength(1);
  });
});
