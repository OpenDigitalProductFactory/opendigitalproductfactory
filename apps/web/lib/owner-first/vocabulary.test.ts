import { describe, it, expect } from "vitest";
import { resolveOwnerVocabulary, RESTAURANT_ARCHETYPE_CATEGORY } from "./vocabulary";

describe("resolveOwnerVocabulary", () => {
  it("uses restaurant vocabulary for the food-hospitality archetype", () => {
    const v = resolveOwnerVocabulary(RESTAURANT_ARCHETYPE_CATEGORY);
    expect(v.isRestaurant).toBe(true);
    expect(v.guestsLabel).toBe("guests");
    expect(v.guestFollowUpLabel).toBe("Guest follow-up");
    expect(v.reservationsLabel).toBe("reservations");
    expect(v.staffLabel).toBe("service staff");
    expect(v.serviceReadinessLabel).toBe("Next service readiness");
    expect(v.depositsLabel).toBe("deposits");
  });

  it("is case- and whitespace-insensitive on the category", () => {
    expect(resolveOwnerVocabulary("  Food-Hospitality  ").isRestaurant).toBe(true);
  });

  it("falls back to a neutral small-business default for other archetypes", () => {
    const v = resolveOwnerVocabulary("retail-goods");
    expect(v.isRestaurant).toBe(false);
    expect(v.guestsLabel).toBe("customers");
    expect(v.guestFollowUpLabel).toBe("Customer follow-up");
    expect(v.category).toBe("retail-goods");
  });

  it("handles a missing archetype category", () => {
    const v = resolveOwnerVocabulary(null);
    expect(v.isRestaurant).toBe(false);
    expect(v.category).toBeNull();
  });

  it("uses adoption and community vocabulary for pet rescue", () => {
    const v = resolveOwnerVocabulary("nonprofit-community", "pet-rescue");
    expect(v.guestFollowUpLabel).toBe("Adoption follow-up");
    expect(v.guestsLabel).toBe("people & partners");
    expect(v.inquiriesLabel).toBe("adoption enquiries");
    expect(v.customerSummarySubhead).not.toMatch(/customer|crm/i);
  });
});

describe("front-door vocabulary", () => {
  // The cockpit told an animal rescue about "From your storefront" and "Storefront
  // bookings". A storefront is what DPF calls the product; it is not what a shelter
  // calls the people arriving at its door. The headline is vocabulary now, so no
  // archetype can inherit another's front door by falling through a branch.
  it("no archetype's worker copy calls its front door a storefront", () => {
    for (const [category, archetypeId] of [
      [null, null],
      ["retail-goods", null],
      ["nonprofit-community", "pet-rescue"],
      ["nonprofit-community", "animal-shelter"],
      [RESTAURANT_ARCHETYPE_CATEGORY, null],
    ] as const) {
      const v = resolveOwnerVocabulary(category, archetypeId);
      const words = `${v.inboundHeadline} ${v.inboundSubhead} ${v.customerSummarySubhead}`;
      expect(words.toLowerCase()).not.toContain("storefront");
    }
  });

  it("the rescue is greeted by its community, in its own nouns", () => {
    const v = resolveOwnerVocabulary("nonprofit-community", "pet-rescue");
    expect(v.inboundHeadline).toBe("From your community");
    expect(v.inboundSubhead).toContain("Adoption enquiries");
  });
});
