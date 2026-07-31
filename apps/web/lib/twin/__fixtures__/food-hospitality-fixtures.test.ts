import { describe, expect, it } from "vitest";

import { bakeryProductionFixture } from "./bakery-production";
import { cateringEventFixture } from "./catering-event";

describe("Food & Hospitality operational pressure fixtures", () => {
  it("foregrounds catering event, guest, menu, prep, staff, delivery, and deposit readiness", () => {
    const text = JSON.stringify(cateringEventFixture()).toLowerCase();
    for (const term of [
      "event",
      "guest",
      "menu",
      "prep",
      "staff",
      "delivery",
      "setup",
      "deposit",
      "invoice",
    ]) {
      expect(text).toContain(term);
    }
    expect(text).not.toContain("table");
    expect(text).not.toContain("dwell-time");
    expect(text).not.toContain("turn-time");
  });

  it("foregrounds bakery bake, custom-order, pickup/delivery, allergen, production, and balance readiness", () => {
    const text = JSON.stringify(bakeryProductionFixture()).toLowerCase();
    for (const term of [
      "bake",
      "custom",
      "pickup",
      "delivery",
      "allergen",
      "production",
      "balance",
      "ingredient",
    ]) {
      expect(text).toContain(term);
    }
    expect(text).not.toContain("table");
    expect(text).not.toContain("waitlist");
  });
});
