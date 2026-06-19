import { describe, it, expect } from "vitest";
import {
  regulationApplies,
  CADA_APPLICABILITY,
  type RegionProfile,
  type RegulationApplicability,
} from "./regulation-applicability";

const empty: RegionProfile = { operatesIn: [], sellsTo: [], employsIn: [], dataResidency: [] };

describe("regulationApplies — region scoping", () => {
  it("CADA does NOT apply to an org with no EU nexus", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, operatesIn: ["us"] });
    expect(r.applies).toBe(false);
    expect(r.reason).toMatch(/out of scope/);
  });

  it("CADA does NOT apply when nothing is declared", () => {
    expect(regulationApplies(CADA_APPLICABILITY, empty).applies).toBe(false);
  });

  it("CADA applies to an org operating in the EU", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, operatesIn: ["eu"] });
    expect(r.applies).toBe(true);
    expect(r.matchedBasis).toContain("operating");
  });

  it("CADA applies to a US supplier selling into the EU (the cascade)", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, operatesIn: ["us"], sellsTo: ["eu"] });
    expect(r.applies).toBe(true);
    expect(r.matchedBasis).toContain("selling");
  });

  it("employing in the EU alone does NOT trigger CADA", () => {
    const r = regulationApplies(CADA_APPLICABILITY, { ...empty, employsIn: ["eu"] });
    expect(r.applies).toBe(false);
  });
});

describe("regulationApplies — global + archetype", () => {
  it("a global regulation applies regardless of region", () => {
    const pci: RegulationApplicability = { basis: ["global"], jurisdictions: [] };
    expect(regulationApplies(pci, empty).applies).toBe(true);
  });

  it("an archetype-specific regulation gates on archetype", () => {
    const spec: RegulationApplicability = { basis: ["operating"], jurisdictions: ["eu"], archetypes: ["healthcare-provider"] };
    expect(regulationApplies(spec, { ...empty, operatesIn: ["eu"], archetype: "retailer" }).applies).toBe(false);
    expect(regulationApplies(spec, { ...empty, operatesIn: ["eu"], archetype: "healthcare-provider" }).applies).toBe(true);
  });
});
