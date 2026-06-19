import { describe, it, expect } from "vitest";
import {
  assessAssuranceLevel,
  DPF_SOVEREIGN_REFERENCE_INPUT,
  type SovereigntyInput,
} from "./sovereignty-assessment";

const euFull: SovereigntyInput = {
  operatorJurisdiction: "DE",
  dataInEea: true,
  personnelInEea: true,
  supplyChainTransparent: true,
  noAiInferenceEgress: true,
  softwareFullyControlled: true,
  euCloudCertified: true,
};

describe("assessAssuranceLevel", () => {
  it("returns Level 0 when data is not in the EEA", () => {
    const r = assessAssuranceLevel({ ...euFull, dataInEea: false });
    expect(r.level).toBe(0);
    expect(r.gaps.join(" ")).toMatch(/Level 1/);
  });

  it("returns Level 1 when only residency holds", () => {
    const r = assessAssuranceLevel({
      operatorJurisdiction: "DE",
      dataInEea: true,
      personnelInEea: false,
      supplyChainTransparent: false,
    });
    expect(r.level).toBe(1);
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it("reaches Level 4 for a fully-sovereign EU deployment", () => {
    const r = assessAssuranceLevel(euFull);
    expect(r.level).toBe(4);
    expect(r.gaps).toHaveLength(0);
    expect(r.cappedBy).toBeUndefined();
  });

  it("caps a third-country operator at Level 2 even with every other control", () => {
    const r = assessAssuranceLevel({ ...euFull, operatorJurisdiction: "US", thirdCountryMitigated: true });
    expect(r.level).toBe(2);
    expect(r.cappedBy).toMatch(/third country/i);
    expect(r.cappedBy).toMatch(/US/);
  });

  it("drops an unmitigated third-country operator to Level 1", () => {
    const r = assessAssuranceLevel({
      operatorJurisdiction: "US",
      dataInEea: true,
      personnelInEea: true,
      supplyChainTransparent: true,
      thirdCountryMitigated: false,
    });
    expect(r.level).toBe(1);
  });

  it("treats UK (post-Brexit) as a third country", () => {
    const r = assessAssuranceLevel({ ...euFull, operatorJurisdiction: "GB", thirdCountryMitigated: true });
    expect(r.level).toBe(2);
    expect(r.cappedBy).toMatch(/GB/);
  });

  it("stops at Level 3 when the Level 4 extras are missing", () => {
    const r = assessAssuranceLevel({ ...euFull, noAiInferenceEgress: false, euCloudCertified: false });
    expect(r.level).toBe(3);
    expect(r.gaps.join(" ")).toMatch(/inference|Level 4/i);
  });

  it("scores the DPF reference posture at Level 3 (→ 4 with the build-out)", () => {
    const r = assessAssuranceLevel(DPF_SOVEREIGN_REFERENCE_INPUT);
    expect(r.level).toBe(3);
    // The remaining gaps are exactly the documented Level 4 build-out.
    expect(r.gaps.join(" ")).toMatch(/steward|certificate|inference/i);
  });
});
