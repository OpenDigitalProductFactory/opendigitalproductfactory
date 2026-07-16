import { describe, it, expect } from "vitest";
import { ALL_ARCHETYPES } from "./archetypes/index";
import { deriveDemoBusiness, evaluateDemoDelight } from "./demo-business";
import { deriveTwinProfile } from "./twin-profile";
import { DEMO_FLAVORS, resolveDemoFlavor } from "./demo-flavor";

describe("resolveDemoFlavor", () => {
  it("returns the authored flavor for a flagship archetype", () => {
    const f = resolveDemoFlavor("dental-practice", "healthcare-wellness");
    expect(f?.companyName).toBe("Bright Smile Dental");
    expect(f?.staff?.length).toBeGreaterThan(0);
  });

  it("falls back to the category floor (notes) for a non-flagship archetype", () => {
    const f = resolveDemoFlavor("optician", "healthcare-wellness");
    expect(f?.companyName).toBeUndefined();
    expect(f?.notes).toMatch(/./);
  });

  it("merges the archetype flavor OVER the category floor", () => {
    // dental-practice authored notes should win over the healthcare category floor.
    const f = resolveDemoFlavor("dental-practice", "healthcare-wellness");
    expect(f?.notes).toBe(DEMO_FLAVORS["dental-practice"].notes);
  });

  it("returns undefined when neither archetype nor category has flavor", () => {
    expect(resolveDemoFlavor("nonexistent", undefined)).toBeUndefined();
  });

  it("every flagship flavor keys a real archetype", () => {
    const ids = new Set(ALL_ARCHETYPES.map((a) => a.archetypeId));
    for (const id of Object.keys(DEMO_FLAVORS)) expect(ids.has(id)).toBe(true);
  });
});

describe("deriveDemoBusiness honours the flavor registry by default", () => {
  it("uses the authored company name + staff for a flagship", () => {
    const dentist = ALL_ARCHETYPES.find((a) => a.archetypeId === "dental-practice")!;
    const demo = deriveDemoBusiness(dentist);
    expect(demo.companyName).toBe("Bright Smile Dental");
    expect(demo.workforce[0].name).toBe("Dr. Ada Rowe");
    expect(demo.narrative.notes).toBe(DEMO_FLAVORS["dental-practice"].notes);
  });

  it("still derives a valid company name for a non-flagship", () => {
    const optician = ALL_ARCHETYPES.find((a) => a.archetypeId === "optician");
    if (!optician) return;
    const demo = deriveDemoBusiness(optician);
    expect(demo.companyName.length).toBeGreaterThan(0);
    // Category floor supplies the "what great looks like" note.
    expect(demo.narrative.notes).toMatch(/./);
  });

  it("an explicit flavor still overrides the registry", () => {
    const dentist = ALL_ARCHETYPES.find((a) => a.archetypeId === "dental-practice")!;
    const demo = deriveDemoBusiness(dentist, { flavor: { companyName: "Custom Dental Co." } });
    expect(demo.companyName).toBe("Custom Dental Co.");
  });

  it("keeps every archetype non-degenerate with the registry applied", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const demo = deriveDemoBusiness(archetype);
      const verdict = evaluateDemoDelight(demo, deriveTwinProfile(archetype));
      expect(verdict.violations).toEqual([]);
    }
  });
});
