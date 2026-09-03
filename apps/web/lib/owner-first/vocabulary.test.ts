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
