import { describe, expect, it } from "vitest";

import { buildArchetypeOutcomes } from "./archetype-outcomes";

describe("buildArchetypeOutcomes", () => {
  it("projects pet-rescue mission outcomes from canonical aggregates", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 900,
      deliveredJobs: 4,
      donations: { amount: 275, count: 3 },
      animalsPlaced: 2,
      fostersActive: null,
    });

    expect(projection.heading).toBe("Mission impact");
    expect(projection.outcomes.map((outcome) => outcome.label)).toEqual([
      "Donations received",
      "Animals placed",
      "Fosters active",
    ]);
    expect(projection.outcomes[0]?.value).toContain("$275");
    expect(projection.outcomes[1]?.value).toBe("2 animals");
    expect(projection.outcomes[2]?.value).toBe("Unavailable");
    expect(projection.outcomes[2]?.hint).toMatch(/no foster record source/i);
  });

  it("preserves revenue and delivered-work outcomes for other archetypes", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "hair-salon",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 900,
      deliveredJobs: 4,
    });

    expect(projection.heading).toBe("Delivered");
    expect(projection.outcomes.map((outcome) => outcome.label)).toEqual([
      "Revenue in",
      "Delivered",
    ]);
  });

  it("explains why a rescue donation total is unavailable", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 0,
      deliveredJobs: 0,
      donations: null,
      donationsUnavailableHint: "Multiple donation currencies are not combined",
    });

    expect(projection.outcomes[0]).toMatchObject({
      value: "Unavailable",
      hint: "Multiple donation currencies are not combined",
    });
  });
});
