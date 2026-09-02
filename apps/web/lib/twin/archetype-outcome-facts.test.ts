import { describe, expect, it, vi } from "vitest";

import {
  loadArchetypeOutcomeFacts,
  summarizeAnimalsInCare,
  summarizeDonations,
} from "./archetype-outcome-facts";

function runtime() {
  return {
    read: async <T>(_source: string, operation: Promise<T>, _fallback: T) =>
      operation,
    unavailable: vi.fn(),
  };
}

describe("archetype outcome facts", () => {
  it("does not query rescue-only sources for a commercial archetype", async () => {
    const rt = runtime();
    const facts = await loadArchetypeOutcomeFacts({
      archetypeId: "hair-salon",
      storefrontId: "sf-1",
      since: new Date("2026-01-01"),
      db: {},
      runtime: rt,
    });

    expect(facts).toEqual({
      donationRows: null,
      animalStatusRows: null,
      animalsPlaced: null,
    });
    expect(rt.unavailable).not.toHaveBeenCalled();
  });

  it("scopes rescue facts to the active storefront and reporting window", async () => {
    const donationFindMany = vi.fn(async () => [
      { amount: 25, currency: "USD" },
    ]);
    const animalCount = vi.fn(async () => 2);
    const since = new Date("2026-01-01");

    const facts = await loadArchetypeOutcomeFacts({
      archetypeId: "pet-rescue",
      storefrontId: "sf-rescue",
      since,
      db: {
        storefrontDonation: { findMany: donationFindMany },
        adoptableAnimal: { count: animalCount },
      },
      runtime: runtime(),
    });

    expect(facts.animalsPlaced).toBe(2);
    expect(donationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storefrontId: "sf-rescue", createdAt: { gte: since } },
      }),
    );
    expect(animalCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storefrontId: "sf-rescue",
          status: "adopted",
          adoptedAt: { gte: since },
        },
      }),
    );
  });

  it("keeps donation currencies apart instead of combining them", () => {
    expect(
      summarizeDonations(
        [
          { amount: 100, currency: "USD" },
          { amount: 50, currency: "GBP" },
        ],
        "USD",
      ),
    ).toEqual({
      totals: [
        { currency: "USD", amount: 100, count: 1 },
        { currency: "GBP", amount: 50, count: 1 },
      ],
    });
  });

  // The tile read "Unavailable · Multiple donation currencies are not combined"
  // over two gifts that were both GBP, because the guard compared a count of
  // ROWS against a count of matching rows rather than counting currencies
  // (BI-685ADDCD).
  it("totals gifts that share one currency, even when it is not the org's", () => {
    expect(
      summarizeDonations(
        [
          { amount: 50, currency: "GBP" },
          { amount: 25, currency: "GBP" },
        ],
        "USD",
      ),
    ).toEqual({ totals: [{ currency: "GBP", amount: 75, count: 2 }] });
  });

  it("totals gifts recorded in the org's own currency", () => {
    expect(
      summarizeDonations(
        [
          { amount: 50, currency: "USD" },
          { amount: "25.50", currency: "USD" },
        ],
        "USD",
      ),
    ).toEqual({ totals: [{ currency: "USD", amount: 75.5, count: 2 }] });
  });

  it("reads a gift with no currency recorded as the org's own", () => {
    expect(
      summarizeDonations(
        [
          { amount: 40, currency: "" },
          { amount: 10, currency: "USD" },
        ],
        "USD",
      ),
    ).toEqual({ totals: [{ currency: "USD", amount: 50, count: 2 }] });
  });

  it("has nothing to total before the first gift", () => {
    expect(summarizeDonations([], "USD")).toEqual({ totals: [] });
  });

  it("stays unavailable when the donation source could not be read", () => {
    expect(summarizeDonations(null, "USD")).toEqual({ totals: null });
  });
});

describe("summarizeAnimalsInCare", () => {
  it("counts every animal that has not left, split by the status staff act on", () => {
    expect(
      summarizeAnimalsInCare([
        { status: "hold", _count: { _all: 5 } },
        { status: "available", _count: { _all: 1 } },
      ]),
    ).toEqual({ total: 6, onHold: 5, available: 1, pending: 0 });
  });

  it("excludes adopted animals — they are an outcome, not a population", () => {
    expect(
      summarizeAnimalsInCare([
        { status: "available", _count: { _all: 2 } },
        { status: "adopted", _count: { _all: 9 } },
      ]),
    ).toEqual({ total: 2, onHold: 0, available: 2, pending: 0 });
  });

  it("counts an unrecognised status into the total rather than losing the animal", () => {
    const summary = summarizeAnimalsInCare([
      { status: "available", _count: { _all: 1 } },
      { status: "quarantine", _count: { _all: 3 } },
    ]);

    expect(summary?.total).toBe(4);
    expect(summary?.available).toBe(1);
  });

  it("reads an empty shelter as zero and an unreadable source as null", () => {
    expect(summarizeAnimalsInCare([])).toEqual({
      total: 0,
      onHold: 0,
      available: 0,
      pending: 0,
    });
    expect(summarizeAnimalsInCare(null)).toBeNull();
  });
});
