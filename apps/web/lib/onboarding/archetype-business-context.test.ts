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
});
