import { describe, expect, it } from "vitest";
import { summarizeCanonicalAnimalPopulation } from "./custody.js";

describe("canonical custody summary", () => {
  it("keeps holds and readiness independent without asserting adoption availability", () => {
    expect(summarizeCanonicalAnimalPopulation({ inCare: 3, legalHold: 1, placementReady: 2, intakeReview: 1 })).toEqual({ total: 3, onHold: 1, available: 0, pending: 0, placementReady: 2, intakeReview: 1 });
  });
  it("keeps unknown distinct from zero and refuses malformed counts", () => {
    expect(summarizeCanonicalAnimalPopulation(null)).toBeNull();
    expect(summarizeCanonicalAnimalPopulation({ inCare: 0, legalHold: 0, placementReady: 0, intakeReview: 0 })?.total).toBe(0);
    expect(summarizeCanonicalAnimalPopulation({ inCare: NaN, legalHold: 0, placementReady: 0, intakeReview: 0 })).toBeNull();
    expect(summarizeCanonicalAnimalPopulation({ inCare: -1, legalHold: 0, placementReady: 0, intakeReview: 0 })).toBeNull();
  });
});
