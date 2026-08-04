import { describe, it, expect } from "vitest";
import { isRegulationDomain, regulationApplies, type RegionProfile } from "./regulation-applicability";
import { HR_EMPLOYMENT_REGULATIONS } from "./seed-hr-employment-compliance";

// BI-0B867B67 phase 3 — the HR/employment pack is the proof functional variant:
// every reg gates on the EMPLOYING basis (not industry) and carries the
// hr-employment domain, so it rolls up under one function while living in the
// central registry.

describe("HR employment compliance pack", () => {
  it("every regulation gates on the employing basis in the US", () => {
    for (const reg of HR_EMPLOYMENT_REGULATIONS) {
      expect(reg.applicability.basis, `${reg.regulationId} must gate on employing`).toContain("employing");
      expect(reg.applicability.jurisdictions).toContain("us");
    }
  });

  it("every regulation is attributed to the hr-employment domain", () => {
    for (const reg of HR_EMPLOYMENT_REGULATIONS) {
      expect(reg.domain).toBe("hr-employment");
      expect(isRegulationDomain(reg.domain)).toBe(true);
    }
  });

  it("every regulation is a cited statute with unique ids and obligation refs", () => {
    const regIds = HR_EMPLOYMENT_REGULATIONS.map((r) => r.regulationId);
    expect(new Set(regIds).size).toBe(regIds.length);
    for (const reg of HR_EMPLOYMENT_REGULATIONS) {
      expect(reg.sourceType).toBe("external");
      expect(reg.sourceUrl, `${reg.regulationId} needs a source`).toBeTruthy();
      const refs = reg.obligations.map((o) => o.reference);
      expect(new Set(refs).size, `${reg.regulationId} obligation refs unique`).toBe(refs.length);
      expect(reg.obligations.length).toBeGreaterThan(0);
    }
  });

  it("applies to a US employer once employsIn is declared, needs review before", () => {
    const flsa = HR_EMPLOYMENT_REGULATIONS.find((r) => r.regulationId === "REG-US-FLSA")!.applicability;
    const base: RegionProfile = { operatesIn: ["us"], sellsTo: [], employsIn: [], dataResidency: [] };
    // Undeclared employsIn → reviewable, not a definitive miss.
    const undeclared = regulationApplies(flsa, base);
    expect(undeclared.applies).toBe(false);
    expect(undeclared.undeclared).toBe(true);
    // Declaring US employment → applies.
    expect(regulationApplies(flsa, { ...base, employsIn: ["us"] }).applies).toBe(true);
    // A software platform that employs in the US is in scope regardless of archetype.
    expect(
      regulationApplies(flsa, { ...base, employsIn: ["us"], archetype: "software-platform" }).applies,
    ).toBe(true);
  });
});
