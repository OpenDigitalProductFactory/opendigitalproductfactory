import { describe, it, expect } from "vitest";
import { parseApplicability, regulationApplies, type RegionProfile } from "./regulation-applicability";
import { SOFTWARE_HORIZONTAL_REGULATIONS } from "./seed-software-horizontal-compliance";

// BI-242F344C — the horizontal pack must gate on data-handling and/or nexus, and
// keep the statutory-vs-framework distinction honest.

describe("software horizontal compliance pack", () => {
  it("every regulation carries a parseable applicability spec", () => {
    for (const reg of SOFTWARE_HORIZONTAL_REGULATIONS) {
      const parsed = parseApplicability(JSON.parse(JSON.stringify(reg.applicability)));
      expect(parsed, `${reg.regulationId} spec must parse`).not.toBeNull();
      expect(parsed!.basis.length).toBeGreaterThan(0);
    }
  });

  it("every regulation is gated by a data-handling predicate OR a non-US nexus (never unscoped)", () => {
    for (const reg of SOFTWARE_HORIZONTAL_REGULATIONS) {
      const hasPredicate = (reg.applicability.dataHandling?.length ?? 0) > 0;
      const nonUsNexus = reg.applicability.jurisdictions.some((j) => j !== "us");
      expect(
        hasPredicate || nonUsNexus,
        `${reg.regulationId} must gate on a data-handling predicate or a non-US nexus, else it is noise`,
      ).toBe(true);
    }
  });

  it("frameworks (SOC 2 / ISO / NIST) are marked sourceType 'framework', statutes are 'external'", () => {
    const frameworks = SOFTWARE_HORIZONTAL_REGULATIONS.filter((r) => r.sourceType === "framework").map((r) => r.regulationId);
    expect(frameworks.sort()).toEqual(
      ["REG-FRAMEWORK-ISO-27001", "REG-FRAMEWORK-NIST-AI-RMF", "REG-FRAMEWORK-SOC2"].sort(),
    );
    // A statute must never be mislabeled a framework and vice-versa.
    for (const reg of SOFTWARE_HORIZONTAL_REGULATIONS) {
      expect(["external", "framework"]).toContain(reg.sourceType);
    }
  });

  it("regulation ids and obligation references are unique", () => {
    const regIds = SOFTWARE_HORIZONTAL_REGULATIONS.map((r) => r.regulationId);
    expect(new Set(regIds).size).toBe(regIds.length);
    for (const reg of SOFTWARE_HORIZONTAL_REGULATIONS) {
      const refs = reg.obligations.map((o) => o.reference);
      expect(new Set(refs).size, `${reg.regulationId} obligation refs must be unique`).toBe(refs.length);
    }
  });

  it("a US software platform that processes personal data + sends marketing sees privacy, breach, and CAN-SPAM as APPLIES", () => {
    const profile: RegionProfile = {
      operatesIn: ["us"],
      sellsTo: [],
      employsIn: [],
      dataResidency: [],
      archetype: "software-platform",
      archetypeId: "software-platform",
      dataHandling: ["processes-personal-data", "sends-marketing"],
    };
    const byId = (id: string) => SOFTWARE_HORIZONTAL_REGULATIONS.find((r) => r.regulationId === id)!;
    expect(regulationApplies(byId("REG-US-CCPA").applicability, profile).applies).toBe(true);
    expect(regulationApplies(byId("REG-US-STATE-BREACH-NOTIFICATION").applicability, profile).applies).toBe(true);
    expect(regulationApplies(byId("REG-US-CAN-SPAM").applicability, profile).applies).toBe(true);
    // Sector overlays it did NOT trigger are out of scope, not noise.
    expect(regulationApplies(byId("REG-US-HIPAA").applicability, profile).applies).toBe(false);
    // EU regimes stay dormant with no EU nexus.
    expect(regulationApplies(byId("REG-EU-GDPR").applicability, profile).applies).toBe(false);
  });
});
