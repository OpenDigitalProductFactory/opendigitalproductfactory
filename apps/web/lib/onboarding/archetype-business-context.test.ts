import { describe, expect, it } from "vitest";

import {
  resolveBusinessProfile,
  GENERIC_BUSINESS_PROFILE,
  resolveStanceVectors,
  resolveStanceAuthoringExamples,
  GENERIC_STANCE_VECTORS,
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
    // ...and now specializes the patient/care-team stance while continuing to
    // inherit fields the leaf does not override.
    expect(dental.whoWeServe).not.toBe(industry.whoWeServe);
    expect(dental.whoWeServe).toMatch(/dentist|hygienist/i);
    expect(dental.supplyChain).toBe(industry.supplyChain);
  });

  it("specializes medical-practice onboarding around ambulatory care", () => {
    const medical = resolveBusinessProfile({
      archetypeId: "medical-practice",
      industry: "healthcare-wellness",
    });

    expect(medical.missionTheme).toMatch(/patient|care/i);
    expect(medical.businessModel).toMatch(/appointment|encounter/i);
    expect(medical.whoWeServe).toMatch(/patient|family/i);
    expect(medical.howWeDecide).toMatch(/clinical|safety/i);
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
      "public-sector",
      "asset-rental",
      "real-estate-construction",
      "trades-maintenance",
      "pet-services",
      "software-platform",
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

describe("resolveStanceVectors (BI-70ADC71F)", () => {
  it("returns the generic set for an unknown industry, with all 5 vectors present", () => {
    const v = resolveStanceVectors({ archetypeId: null, industry: "no-such-industry" });
    expect(Object.keys(v).sort()).toEqual([
      "customer-goodwill",
      "growth-vs-stability",
      "pricing-integrity",
      "quality-bar",
      "spend-authority",
    ]);
    expect(v["customer-goodwill"].ceilingUsd).toBe(100);
    expect(v["spend-authority"].ceilingUsd).toBe(250);
    for (const key of Object.keys(v) as (keyof typeof v)[]) {
      expect(v[key].stance.length).toBeGreaterThan(40);
      expect(v[key].title.length).toBeGreaterThan(5);
    }
  });

  it("merges industry overrides over the generic set (healthcare)", () => {
    const v = resolveStanceVectors({ archetypeId: "dental-practice", industry: "healthcare-wellness" });
    // Overridden vectors carry the healthcare posture…
    expect(v["customer-goodwill"].ceilingUsd).toBe(150);
    expect(v["customer-goodwill"].stance).toMatch(/patient/i);
    expect(v["quality-bar"].stance).toMatch(/safety|clinical/i);
    expect(v["spend-authority"].ceilingUsd).toBe(500);
    // …vectors without an override fall back to generic.
    expect(v["growth-vs-stability"]).toEqual(GENERIC_STANCE_VECTORS["growth-vs-stability"]);
    expect(v["pricing-integrity"]).toEqual(GENERIC_STANCE_VECTORS["pricing-integrity"]);
  });

  it("public-sector goodwill carries no discretionary ceiling", () => {
    const v = resolveStanceVectors({ industry: "public-sector" });
    expect(v["customer-goodwill"].ceilingUsd).toBeUndefined();
    expect(v["customer-goodwill"].stance).toMatch(/resident|process|equal/i);
  });

  it("projects all five nonprofit-community vectors without commercial assumptions (BI-5220C674)", () => {
    const vectors = resolveStanceVectors({
      archetypeId: "pet-rescue",
      industry: "nonprofit-community",
    });
    const rendered = Object.values(vectors)
      .flatMap((vector) => [vector.title, vector.stance])
      .join(" ");

    expect(rendered).toMatch(/mission|people we serve|supporter|donor|steward/i);
    expect(rendered).not.toMatch(/prices|quotes|discounts|customer|refund|sell/i);
    expect(vectors["customer-goodwill"].ceilingUsd).toBeUndefined();
    expect(vectors["pricing-integrity"].ceilingUsd).toBeUndefined();
  });

  it("keeps commercial defaults unchanged while giving nonprofits a relevant authoring example", () => {
    expect(resolveStanceVectors({ industry: "no-such-industry" })).toEqual(GENERIC_STANCE_VECTORS);

    const nonprofit = resolveStanceAuthoringExamples({ industry: "nonprofit-community" });
    expect(`${nonprofit.title} ${nonprofit.body} ${nonprofit.summary}`).toMatch(/mission|support|need/i);
    expect(`${nonprofit.title} ${nonprofit.body} ${nonprofit.summary}`).not.toMatch(/refund|customer|price/i);

    const commercial = resolveStanceAuthoringExamples({ industry: "food-hospitality" });
    expect(commercial.title).toBe("How we decide refunds");
  });
});
