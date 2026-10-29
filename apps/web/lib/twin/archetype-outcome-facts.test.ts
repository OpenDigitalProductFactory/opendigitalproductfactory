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
  it("does not read confidential custody aggregates without the current animal-welfare permission", async () => {
    const count = vi.fn(async () => 50);
    const rt = runtime();
    const facts = await loadArchetypeOutcomeFacts({ archetypeId: "pet-rescue", storefrontId: "sf-1", organizationId: "org-1", since: new Date("2026-01-01"), runtime: rt, viewer: { platformRole: "HR-600", isSuperuser: false }, db: { animalProfile: { count }, animalCustodyEpisode: { count } } });
    expect(facts.animalsInCare).toBeNull(); expect(facts.adoptionOutcomes).toBeNull(); expect(count).not.toHaveBeenCalled();
    expect((facts as unknown as { kennelSourceUnavailable: boolean }).kennelSourceUnavailable).toBe(true);
    expect(rt.unavailable).toHaveBeenCalledWith("animals-in-care");
  });
  it("uses canonical custody identities and adoption history without querying public listings", async () => {
    const listingCount = vi.fn(async () => 900);
    const animalCount = vi.fn(async () => 3);
    const episodeCount = vi.fn(async (args: unknown) => {
      const where = (args as { where: { outcomeType?: string; legalHoldActive?: boolean } }).where;
      return where.outcomeType === "adoption" ? 2 : where.legalHoldActive ? 1 : 0;
    });
    const facts = await loadArchetypeOutcomeFacts({
      archetypeId: "pet-rescue", storefrontId: "sf-rescue", organizationId: "org-rescue",
      viewer: { platformRole: "HR-000", isSuperuser: false },
      since: new Date("2026-01-01"), runtime: runtime(),
      db: { animalProfile: { count: animalCount }, animalCustodyEpisode: { count: episodeCount }, adoptableAnimal: { count: listingCount } } as never,
    });
    expect((facts as unknown as { animalsInCare: { total: number; onHold: number } }).animalsInCare).toMatchObject({ total: 3, onHold: 1 });
    expect(facts.adoptionOutcomes).toBe(2);
    expect(listingCount).not.toHaveBeenCalled();
    expect(animalCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-rescue" }) }));
    expect(episodeCount).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-rescue", outcomeType: "adoption", closedAt: { gte: new Date("2026-01-01") } } }));
  });
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
      kennelCapacity: null,
      kennelSourceUnavailable: false,
      donationRows: null,
      animalsInCare: null,
      adoptionOutcomes: null,
    });
    expect(rt.unavailable).not.toHaveBeenCalled();
  });

  it("scopes rescue facts to the active storefront and reporting window", async () => {
    const donationFindMany = vi.fn(async () => [
      { amount: 25, currency: "USD" },
    ]);
    const animalCount = vi.fn(async () => 2);
    const episodeCount = vi.fn(async () => 2);
    const since = new Date("2026-01-01");

    const facts = await loadArchetypeOutcomeFacts({
      archetypeId: "pet-rescue",
      storefrontId: "sf-rescue",
      organizationId: "org-rescue",
      viewer: { platformRole: "HR-000", isSuperuser: false },
      since,
      db: {
        storefrontDonation: { findMany: donationFindMany },
        animalProfile: { count: animalCount },
        animalCustodyEpisode: { count: episodeCount },
      },
      runtime: runtime(),
    });

    expect(facts.adoptionOutcomes).toBe(2);
    expect(donationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storefrontId: "sf-rescue", createdAt: { gte: since } },
      }),
    );
    expect(episodeCount).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-rescue", outcomeType: "adoption", closedAt: { gte: since } } }));
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
