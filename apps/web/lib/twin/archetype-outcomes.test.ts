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
      donationTotals: [{ currency: "USD", amount: 275, count: 3 }],
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

  it("says the donation source is unavailable only when it could not be read", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 0,
      deliveredJobs: 0,
      donationTotals: null,
    });

    expect(projection.outcomes[0]).toMatchObject({
      value: "Unavailable",
      hint: "Donation source unavailable",
    });
  });

  // Two gifts in one currency read "Unavailable" on the live rescue install
  // (BI-685ADDCD). The tile had the number and would not show it.
  it("shows a single-currency total in the currency it was given in", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 0,
      deliveredJobs: 0,
      donationTotals: [{ currency: "GBP", amount: 75, count: 2 }],
    });

    expect(projection.outcomes[0]?.value).toContain("75");
    expect(projection.outcomes[0]?.value).not.toBe("Unavailable");
    expect(projection.outcomes[0]?.hint).toBe("2 gifts · 90 days");
  });

  it("shows every currency when the org really holds more than one", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 0,
      deliveredJobs: 0,
      donationTotals: [
        { currency: "USD", amount: 120, count: 2 },
        { currency: "GBP", amount: 75, count: 2 },
      ],
    });

    expect(projection.outcomes[0]?.value).not.toBe("Unavailable");
    expect(projection.outcomes[0]?.value).toContain("120");
    expect(projection.outcomes[0]?.value).toContain("75");
    expect(projection.outcomes[0]?.hint).toMatch(/4 gifts/);
    expect(projection.outcomes[0]?.hint).toMatch(/kept apart by currency/);
  });

  it("reads zero before the first gift, not unavailable", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 0,
      deliveredJobs: 0,
      donationTotals: [],
    });

    expect(projection.outcomes[0]?.value).toContain("0");
    expect(projection.outcomes[0]?.hint).toBe("0 gifts · 90 days");
  });
});
