import { describe, expect, it } from "vitest";
import {
  ARCHETYPE_READINESS_MATRIX,
  ARCHETYPE_READINESS_TIERS,
  ARCHETYPE_READINESS_TIER_REQUIREMENTS,
  assertArchetypeReadinessClaimAllowed,
  compareArchetypeReadinessTiers,
  evaluateArchetypeReadinessClaim,
  resolveArchetypeReadinessRecord,
} from "./archetype-readiness";
import { ALL_ARCHETYPES } from "./archetypes";

describe("archetype readiness matrix", () => {
  it("keeps the readiness ladder closed and ordered", () => {
    expect(ARCHETYPE_READINESS_TIERS).toEqual([
      "template-ready",
      "ops-ready",
      "connector-ready",
      "regulated-ready",
      "sole-platform-ready",
    ]);
    expect(compareArchetypeReadinessTiers("template-ready", "sole-platform-ready")).toBeLessThan(0);
    expect(compareArchetypeReadinessTiers("sole-platform-ready", "template-ready")).toBeGreaterThan(0);
    expect(compareArchetypeReadinessTiers("connector-ready", "connector-ready")).toBe(0);
  });

  it("defines evidence requirements for every tier", () => {
    const requirementTiers = ARCHETYPE_READINESS_TIER_REQUIREMENTS.map(
      (requirement) => requirement.tier,
    );

    expect(requirementTiers).toEqual(ARCHETYPE_READINESS_TIERS);
    for (const requirement of ARCHETYPE_READINESS_TIER_REQUIREMENTS) {
      expect(requirement.summary).toMatch(/./);
      expect(requirement.requiredEvidence.length).toBeGreaterThan(0);
    }
  });

  it("has exactly one category readiness record for every shipped archetype category", () => {
    const categories = new Set(ALL_ARCHETYPES.map((archetype) => archetype.category));
    const matrixCategories = ARCHETYPE_READINESS_MATRIX.map((record) => record.archetypeCategory);

    expect(new Set(matrixCategories)).toEqual(categories);
    expect(matrixCategories.length).toBe(categories.size);
  });

  it("allows template-ready claims for a shipped archetype category", () => {
    const result = evaluateArchetypeReadinessClaim({
      archetypeCategory: "healthcare-wellness",
      requestedTier: "template-ready",
    });

    expect(result.allowed).toBe(true);
    expect(result.highestClaimableTier).toBe("template-ready");
  });

  it("resolves readiness by leaf archetype id", () => {
    const record = resolveArchetypeReadinessRecord({ archetypeId: "dental-practice" });

    expect(record?.archetypeCategory).toBe("healthcare-wellness");
  });

  it("blocks sole-platform claims from template evidence alone", () => {
    for (const record of ARCHETYPE_READINESS_MATRIX) {
      const result = evaluateArchetypeReadinessClaim({
        archetypeCategory: record.archetypeCategory,
        requestedTier: "sole-platform-ready",
      });
      const blockerEvidenceIds = new Set(
        result.blockers.flatMap((blocker) => blocker.evidence.map((evidence) => evidence.id)),
      );

      expect(result.allowed).toBe(false);
      expect(result.highestClaimableTier).toBe("template-ready");
      expect(blockerEvidenceIds.has("BI-903F5A94")).toBe(true);
      expect(blockerEvidenceIds.has("BI-4C16947C")).toBe(true);
      expect(blockerEvidenceIds.has("BI-35E9EE62")).toBe(true);
    }
  });

  it("throws an actionable error when a claim outruns the evidence", () => {
    expect(() =>
      assertArchetypeReadinessClaimAllowed({
        archetypeCategory: "banking-financial-services",
        requestedTier: "regulated-ready",
      }),
    ).toThrow(/BI-PSC-010/);
  });

  it("cross-references BI-PSC-010 and existing vertical readiness epics", () => {
    const banking = resolveArchetypeReadinessRecord({
      archetypeCategory: "banking-financial-services",
    });
    const dependencyIds = new Set(banking?.dependencies.map((evidence) => evidence.id));

    expect(dependencyIds.has("BI-PSC-010")).toBe(true);
    expect(dependencyIds.has("EP-VERTICAL-BANKING")).toBe(true);
  });

  it("makes missing category-level vertical readiness lanes visible", () => {
    const trades = evaluateArchetypeReadinessClaim({
      archetypeCategory: "trades-maintenance",
      requestedTier: "ops-ready",
    });

    expect(trades.allowed).toBe(false);
    expect(trades.missingEvidence).toContain(
      "No category-level vertical-readiness epic is mapped for this archetype category.",
    );
  });
});
