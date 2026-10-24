// apps/web/lib/deliberation/reviewer-independence.test.ts
//
// BI-0FC71985. The property that matters: never claim independence the install
// cannot field. A same-model review during an outage is still worth running and
// must not read like heterogeneous review.
import { describe, expect, it } from "vitest";
import { achievableDiversity, gradeIndependence } from "./reviewer-independence";

describe("achievableDiversity", () => {
  it("uses different providers when there are some", () => {
    expect(achievableDiversity({ providerCount: 3, modelCount: 9 })).toBe(
      "multi-provider-heterogeneous",
    );
  });

  it("falls to different models on one provider", () => {
    expect(achievableDiversity({ providerCount: 1, modelCount: 4 })).toBe(
      "multi-model-same-provider",
    );
  });

  it("falls to personas on a single-model install — the drain case", () => {
    expect(achievableDiversity({ providerCount: 1, modelCount: 1 })).toBe(
      "single-model-multi-persona",
    );
  });

  it("reports the weakest for an unmeasurable pool, but callers must check poolIsKnown first", () => {
    // Absence of evidence is not evidence of a single model — gradeIndependence
    // keeps those apart; this function only answers the measurable question.
    expect(achievableDiversity(null)).toBe("single-model-multi-persona");
    expect(achievableDiversity({})).toBe("single-model-multi-persona");
  });
});

describe("gradeIndependence", () => {
  it("grants what was asked when the pool supports it", () => {
    const grade = gradeIndependence("multi-provider-heterogeneous", {
      providerCount: 2, modelCount: 5,
    });
    expect(grade.mode).toBe("multi-provider-heterogeneous");
    expect(grade.downgraded).toBe(false);
    expect(grade.note).toContain("different provider");
  });

  it("downgrades rather than overclaims, and says it did", () => {
    const grade = gradeIndependence("multi-provider-heterogeneous", {
      providerCount: 1, modelCount: 1,
    });
    expect(grade.mode).toBe("single-model-multi-persona");
    expect(grade.downgraded).toBe(true);
    expect(grade.requested).toBe("multi-provider-heterogeneous");
    expect(grade.note).toContain("asked for stronger independence");
  });

  it("does not upgrade a pattern that asked for less than the pool offers", () => {
    // The pattern's intent is a ceiling as well as a floor: a cheap review should
    // not silently become an expensive heterogeneous one.
    const grade = gradeIndependence("single-model-multi-persona", {
      providerCount: 4, modelCount: 12,
    });
    expect(grade.mode).toBe("single-model-multi-persona");
    expect(grade.downgraded).toBe(false);
  });

  it("states plainly what a same-model review is and is not worth", () => {
    const grade = gradeIndependence("single-model-multi-persona", { modelCount: 1 });
    expect(grade.note).toContain("catches carelessness");
    expect(grade.note).toContain("not systematic bias");
  });
});
