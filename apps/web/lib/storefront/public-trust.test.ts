import { describe, expect, it, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
vi.mock("@dpf/db", () => ({ prisma: { businessProfile: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

import {
  isJourneySupported,
  resolveTrustProfile,
  getPublicOperatingHours,
  type PublicJourney,
} from "./public-trust";

type Store = Parameters<typeof isJourneySupported>[0];
type Item = Store["items"][number];
type Section = Store["sections"][number];

function storefront(over: Partial<Store> = {}): Store {
  return { items: [], sections: [], ...over };
}

const item = (o: Record<string, unknown>): Item =>
  ({ ctaType: "inquiry", priceAmount: null, ...o }) as unknown as Item;
const section = (type: string): Section => ({ type }) as unknown as Section;

describe("isJourneySupported", () => {
  it("treats inquiry as always available (universal fallback)", () => {
    expect(isJourneySupported(storefront(), "inquiry")).toBe(true);
  });

  it("only supports donation when an appeal item or donate section exists", () => {
    expect(isJourneySupported(storefront(), "donation")).toBe(false);
    expect(isJourneySupported(storefront({ items: [item({ ctaType: "donation" })] }), "donation")).toBe(true);
    expect(
      isJourneySupported(storefront({ sections: [section("donate")] }), "donation"),
    ).toBe(true);
  });

  it("only supports order when a purchasable item carries a real price", () => {
    expect(isJourneySupported(storefront({ items: [item({ ctaType: "purchase", priceAmount: null })] }), "order")).toBe(false);
    expect(isJourneySupported(storefront({ items: [item({ ctaType: "purchase", priceAmount: "9.50" })] }), "order")).toBe(true);
  });

  it("supports booking when a booking item exists", () => {
    expect(isJourneySupported(storefront(), "booking")).toBe(false);
    expect(isJourneySupported(storefront({ items: [item({ ctaType: "booking" })] }), "booking")).toBe(true);
  });

  it("does not offer a restaurant (booking-only) donation/order path", () => {
    const restaurant = storefront({ items: [item({ ctaType: "booking" }), item({ ctaType: "booking" })] });
    const gated: PublicJourney[] = ["donation", "order"];
    for (const j of gated) expect(isJourneySupported(restaurant, j)).toBe(false);
    expect(isJourneySupported(restaurant, "booking")).toBe(true);
  });
});

describe("resolveTrustProfile", () => {
  it("gives food-hospitality a reservation noun, dietary + deposit copy", () => {
    const p = resolveTrustProfile("food-hospitality");
    expect(p.bookingNoun).toBe("reservation");
    expect(p.dietaryNote).toMatch(/allerg/i);
    expect(p.paymentNote).toMatch(/deposit/i);
    expect(p.accountPurpose).toMatch(/reservation/i);
  });

  it("falls back to a safe generic profile with no invented dietary claim", () => {
    const p = resolveTrustProfile("something-unknown");
    expect(p.bookingNoun).toBe("booking");
    expect(p.dietaryNote).toBeNull();
    expect(p.bookingPolicy).toBeTruthy();
    expect(p.cancellationPolicy).toBeTruthy();
  });

  it("gives a pet rescue adoption and surrender policy without booking language", () => {
    const p = resolveTrustProfile("nonprofit-community", "pet-rescue");

    expect(p.policyLinkLabel).toBe("Adoption & surrender");
    expect(p.pageTitle).toBe("Policies & supporter information");
    expect(p.policyHeading).toBe("Adoption & surrender");
    expect(p.pageIntro).toMatch(/adoption and surrender enquiries/i);
    expect(p.termsPolicy).toMatch(/animal welfare|capacity|fit/i);
    expect(`${p.pageIntro} ${p.termsPolicy}`).not.toMatch(/bookings|menus/i);
  });
});

describe("getPublicOperatingHours", () => {
  beforeEach(() => findFirst.mockReset());

  it("returns null when hours are not confirmed (never shows invented hours)", async () => {
    findFirst.mockResolvedValue({ hoursConfirmedAt: null, businessHours: { monday: { open: "11:00", close: "22:00" } } });
    expect(await getPublicOperatingHours()).toBeNull();
  });

  it("maps confirmed business hours to a weekly schedule", async () => {
    findFirst.mockResolvedValue({
      hoursConfirmedAt: new Date("2026-01-01"),
      businessHours: { monday: { open: "11:00", close: "22:00" }, tuesday: null },
    });
    const schedule = await getPublicOperatingHours();
    expect(schedule?.monday).toEqual({ enabled: true, open: "11:00", close: "22:00" });
    expect(schedule?.tuesday.enabled).toBe(false);
  });
});
