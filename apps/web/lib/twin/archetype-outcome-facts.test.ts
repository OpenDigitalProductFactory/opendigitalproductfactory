import { describe, expect, it, vi } from "vitest";

import {
  loadArchetypeOutcomeFacts,
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

    expect(facts).toEqual({ donationRows: null, animalsPlaced: null });
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

  it("refuses to combine donation currencies", () => {
    expect(
      summarizeDonations(
        [
          { amount: 100, currency: "USD" },
          { amount: 50, currency: "GBP" },
        ],
        "USD",
      ),
    ).toEqual({
      aggregate: null,
      unavailableHint: "Multiple donation currencies are not combined",
    });
  });
});
