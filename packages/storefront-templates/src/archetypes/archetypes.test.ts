import { describe, it, expect } from "vitest";
import { ALL_ARCHETYPES } from "./index";

describe("archetype catalog", () => {
  it("has at least 30 archetypes", () => {
    expect(ALL_ARCHETYPES.length).toBeGreaterThanOrEqual(30);
  });

  it("every archetype has required fields", () => {
    for (const a of ALL_ARCHETYPES) {
      expect(a.archetypeId, `${a.archetypeId} missing archetypeId`).toBeTruthy();
      expect(a.name, `${a.archetypeId} missing name`).toBeTruthy();
      expect(a.ctaType, `${a.archetypeId} missing ctaType`).toBeTruthy();
      expect(a.itemTemplates.length, `${a.archetypeId} needs items`).toBeGreaterThan(0);
      expect(a.sectionTemplates.length, `${a.archetypeId} needs sections`).toBeGreaterThan(0);
    }
  });

  it("every archetype has unique archetypeId", () => {
    const ids = ALL_ARCHETYPES.map((a) => a.archetypeId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("hero section always comes first", () => {
    for (const a of ALL_ARCHETYPES) {
      const sorted = [...a.sectionTemplates].sort((x, y) => x.sortOrder - y.sortOrder);
      expect(sorted[0].type, `${a.archetypeId} hero should be first section`).toBe("hero");
    }
  });

  it("all booking-type archetypes have schedulingDefaults", () => {
    const bookingArchetypes = ALL_ARCHETYPES.filter((a) => a.ctaType === "booking");
    for (const a of bookingArchetypes) {
      expect(a.schedulingDefaults, `${a.archetypeId} missing schedulingDefaults`).toBeDefined();
    }
  });

  it("it-managed-services carries a strong activation profile", () => {
    const msp = ALL_ARCHETYPES.find((a) => a.archetypeId === "it-managed-services");
    expect(msp).toBeDefined();
    expect(msp?.activationProfile?.profileType).toBe("managed-service-provider");
    expect(msp?.activationProfile?.modules).toContain("customer-estate");
    expect(msp?.activationProfile?.modules).toContain("service-agreements");
    expect(msp?.activationProfile?.modules).toContain("service-operations");
    expect(msp?.activationProfile?.customerGraph).toBe("separate-customer-projection");
    expect(msp?.activationProfile?.estateSeparation).toBe("strict");
  });
});
