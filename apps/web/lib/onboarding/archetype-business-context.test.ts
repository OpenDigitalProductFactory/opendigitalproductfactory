import { describe, expect, it } from "vitest";

import {
  resolveBusinessProfile,
  GENERIC_BUSINESS_PROFILE,
} from "./archetype-business-context";

describe("resolveBusinessProfile", () => {
  it("returns the industry profile for a known category", () => {
    const p = resolveBusinessProfile({ industry: "healthcare-wellness" });
    expect(p.missionTheme.toLowerCase()).toContain("care");
    expect(p.whoWeServe.toLowerCase()).toContain("patient");
    expect(p.howWeDecide.toLowerCase()).toContain("safety");
  });

  it("falls back to the generic profile for an unknown / missing industry", () => {
    expect(resolveBusinessProfile({ industry: "made-up" })).toBe(GENERIC_BUSINESS_PROFILE);
    expect(resolveBusinessProfile({})).toBe(GENERIC_BUSINESS_PROFILE);
  });

  it("merges a flagship archetype override over its industry profile", () => {
    const industry = resolveBusinessProfile({ industry: "healthcare-wellness" });
    const dental = resolveBusinessProfile({
      archetypeId: "dental-practice",
      industry: "healthcare-wellness",
    });
    // Override specialises missionTheme + businessModel...
    expect(dental.missionTheme).not.toBe(industry.missionTheme);
    expect(dental.missionTheme.toLowerCase()).toContain("smile");
    // ...but inherits the non-overridden fields from the industry profile.
    expect(dental.whoWeServe).toBe(industry.whoWeServe);
  });

  it("ignores an unknown archetypeId and uses the industry profile", () => {
    const p = resolveBusinessProfile({ archetypeId: "no-such-archetype", industry: "retail-goods" });
    expect(p).toBe(resolveBusinessProfile({ industry: "retail-goods" }));
  });

  it("varies the profile across distinct industries", () => {
    const food = resolveBusinessProfile({ industry: "food-hospitality" });
    const pro = resolveBusinessProfile({ industry: "professional-services" });
    expect(food.missionTheme).not.toBe(pro.missionTheme);
    expect(food.howWeDecide).not.toBe(pro.howWeDecide);
  });

  // ─── supplyChain (archetype-aware supplier / supply-chain stance) ──────────

  describe("supplyChain", () => {
    const INDUSTRIES = [
      "healthcare-wellness",
      "beauty-personal-care",
      "fitness-recreation",
      "food-hospitality",
      "professional-services",
      "hoa-property-management",
      "education-training",
      "retail-goods",
      "nonprofit-community",
    ];

    it("populates a non-empty supplyChain on every industry profile", () => {
      for (const industry of INDUSTRIES) {
        const p = resolveBusinessProfile({ industry });
        expect(typeof p.supplyChain).toBe("string");
        expect(p.supplyChain.trim().length).toBeGreaterThan(20);
      }
    });

    it("populates a brief generic supplyChain on the fallback profile", () => {
      expect(typeof GENERIC_BUSINESS_PROFILE.supplyChain).toBe("string");
      expect(GENERIC_BUSINESS_PROFILE.supplyChain.trim().length).toBeGreaterThan(20);
    });

    it("reflects the characteristic posture for representative industries", () => {
      // Food-hospitality leans on perishables; professional-services explicitly
      // does not lean on a heavy physical supply chain. These are starter
      // statements, but they have to read like they understand the business.
      const food = resolveBusinessProfile({ industry: "food-hospitality" }).supplyChain.toLowerCase();
      expect(food).toMatch(/perish|cold[- ]chain|local/);

      const pro = resolveBusinessProfile({ industry: "professional-services" }).supplyChain.toLowerCase();
      expect(pro).toMatch(/light|minimal|software|subscriptions/);

      const retail = resolveBusinessProfile({ industry: "retail-goods" }).supplyChain.toLowerCase();
      expect(retail).toMatch(/wholesal|inventory|stock/);
    });

    it("varies supplyChain across distinct industries", () => {
      const food = resolveBusinessProfile({ industry: "food-hospitality" }).supplyChain;
      const pro = resolveBusinessProfile({ industry: "professional-services" }).supplyChain;
      const retail = resolveBusinessProfile({ industry: "retail-goods" }).supplyChain;
      expect(new Set([food, pro, retail]).size).toBe(3);
    });

    it("merges a flagship archetype override over the industry supplyChain", () => {
      const restaurant = resolveBusinessProfile({
        archetypeId: "restaurant",
        industry: "food-hospitality",
      });
      const industry = resolveBusinessProfile({ industry: "food-hospitality" });
      // Override specialises the supply-chain text (restaurants — daily perishables)
      // beyond the industry baseline; both still read like food-hospitality.
      expect(restaurant.supplyChain).not.toBe(industry.supplyChain);
      expect(restaurant.supplyChain.toLowerCase()).toMatch(/perish|ingredient|cold[- ]chain|food safety/);
    });

    it("inherits the industry supplyChain when an override doesn't specialise it", () => {
      // dental-practice overrides missionTheme/businessModel but not supplyChain,
      // so it should inherit healthcare-wellness's supply-chain posture verbatim.
      const dental = resolveBusinessProfile({
        archetypeId: "dental-practice",
        industry: "healthcare-wellness",
      });
      const industry = resolveBusinessProfile({ industry: "healthcare-wellness" });
      expect(dental.supplyChain).toBe(industry.supplyChain);
    });
  });
});
