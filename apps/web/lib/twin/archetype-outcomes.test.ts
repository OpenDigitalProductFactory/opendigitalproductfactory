import { describe, expect, it } from "vitest";

import { buildArchetypeOutcomes } from "./archetype-outcomes";

/** Select by key: tile order is part of the design and changes deliberately,
 *  so an assertion about donations should not break when a tile moves. */
function outcome(
  projection: ReturnType<typeof buildArchetypeOutcomes>,
  key: string,
) {
  return projection.outcomes.find((entry) => entry.key === key);
}

describe("buildArchetypeOutcomes", () => {
  it("projects pet-rescue mission outcomes from canonical aggregates", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 900,
      deliveredJobs: 4,
      donationTotals: [{ currency: "USD", amount: 275, count: 3 }],
      animalsInCare: { total: 6, onHold: 5, available: 1, pending: 0 },
      animalsPlaced: 2,
      fostersActive: null,
    });

    expect(projection.heading).toBe("Mission impact");
    expect(projection.outcomes.map((outcome) => outcome.label)).toEqual([
      "Animals in care",
      "Kennels",
      "Donations received",
      "Animals placed",
      "Fosters active",
    ]);
    expect(outcome(projection, "donations-received")?.value).toContain("$275");
    expect(outcome(projection, "animals-placed")?.value).toBe("2 animals");
    expect(outcome(projection, "fosters-active")?.value).toBe("Unavailable");
    expect(outcome(projection, "fosters-active")?.hint).toMatch(/no foster record source/i);
  });

  it("leads the rescue projection with the animals actually in the shelter", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 0,
      deliveredJobs: 0,
      donationTotals: [],
      animalsInCare: { total: 6, onHold: 5, available: 1, pending: 0 },
      animalsPlaced: 0,
      fostersActive: null,
    });

    const inCare = projection.outcomes[0];
    expect(inCare?.key).toBe("animals-in-care");
    expect(inCare?.value).toBe("6 animals");
    expect(inCare?.hint).toBe("5 on hold · 1 available");
  });

  it("names every status present in the split, and omits the empty ones", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 0,
      deliveredJobs: 0,
      donationTotals: [],
      animalsInCare: { total: 4, onHold: 1, available: 2, pending: 1 },
      animalsPlaced: 0,
      fostersActive: null,
    });

    expect(projection.outcomes[0]?.hint).toBe("1 on hold · 2 available · 1 pending");
  });

  it("reads an empty shelter as a real zero, not as a missing source", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 0,
      deliveredJobs: 0,
      donationTotals: [],
      animalsInCare: { total: 0, onHold: 0, available: 0, pending: 0 },
      animalsPlaced: 0,
      fostersActive: null,
    });

    expect(projection.outcomes[0]?.value).toBe("0 animals");
    expect(projection.outcomes[0]?.hint).toBe("None in care");
  });

  it("keeps an unreadable animal source visible rather than showing a false zero", () => {
    const projection = buildArchetypeOutcomes({
      archetypeId: "pet-rescue",
      currency: "USD",
      locale: "en-US",
      paidRevenue: 0,
      deliveredJobs: 0,
      donationTotals: [],
      animalsInCare: null,
      animalsPlaced: null,
      fostersActive: null,
    });

    expect(projection.outcomes[0]?.value).toBe("Unavailable");
    expect(projection.outcomes[0]?.hint).toMatch(/animal source unavailable/i);
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

    expect(outcome(projection, "donations-received")).toMatchObject({
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

    expect(outcome(projection, "donations-received")?.value).toContain("75");
    expect(outcome(projection, "donations-received")?.value).not.toBe("Unavailable");
    expect(outcome(projection, "donations-received")?.hint).toBe("2 gifts · 90 days");
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

    expect(outcome(projection, "donations-received")?.value).not.toBe("Unavailable");
    expect(outcome(projection, "donations-received")?.value).toContain("120");
    expect(outcome(projection, "donations-received")?.value).toContain("75");
    expect(outcome(projection, "donations-received")?.hint).toMatch(/4 gifts/);
    expect(outcome(projection, "donations-received")?.hint).toMatch(/kept apart by currency/);
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

    expect(outcome(projection, "donations-received")?.value).toContain("0");
    expect(outcome(projection, "donations-received")?.hint).toBe("0 gifts · 90 days");
  });
});

describe("kennel capacity", () => {
  const base = {
    archetypeId: "pet-rescue" as const,
    currency: "USD",
    locale: "en-US",
    paidRevenue: 0,
    deliveredJobs: 0,
    donationTotals: [],
    animalsInCare: { total: 6, onHold: 5, available: 1, pending: 0 },
    animalsPlaced: 0,
    fostersActive: null,
  };

  it("answers the 16:00 question: how many kennels are free", () => {
    const projection = buildArchetypeOutcomes({
      ...base,
      kennelCapacity: { total: 20, free: 13, occupied: 6, outOfService: 1 },
    });

    const kennels = outcome(projection, "kennels-free");
    expect(kennels?.value).toBe("13 free");
    expect(kennels?.hint).toBe("6 occupied · 1 out of service of 20");
  });

  it("omits out-of-service from the hint when every unit is in service", () => {
    const projection = buildArchetypeOutcomes({
      ...base,
      kennelCapacity: { total: 8, free: 2, occupied: 6, outOfService: 0 },
    });

    expect(outcome(projection, "kennels-free")?.hint).toBe("6 occupied of 8");
  });

  it("warns when the shelter is full rather than reading as a healthy zero", () => {
    const projection = buildArchetypeOutcomes({
      ...base,
      kennelCapacity: { total: 6, free: 0, occupied: 6, outOfService: 0 },
    });

    const kennels = outcome(projection, "kennels-free");
    expect(kennels?.value).toBe("0 free");
    expect(kennels?.intent).toBe("warning");
  });

  it("does not tell a manager they are full when no housing has been recorded", () => {
    const projection = buildArchetypeOutcomes({ ...base, kennelCapacity: null });

    const kennels = outcome(projection, "kennels-free");
    expect(kennels?.value).toBe("Not recorded");
    expect(kennels?.value).not.toBe("0 free");
    expect(kennels?.hint).toMatch(/no housing recorded/i);
  });
});
