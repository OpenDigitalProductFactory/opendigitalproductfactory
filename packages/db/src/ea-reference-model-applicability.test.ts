import { describe, expect, it } from "vitest";
import { referenceModelAppliesToInstall } from "./seed-ea-reference-models.js";

// BI-DDB48B04 follow-on. The eaReferenceModels seed used to import the BIAN
// Service Landscape and then ASSERT a non-zero element count for it on every
// install, regardless of archetype. Since seed steps are caught and logged
// rather than fatal (seed.ts `step()`), that assertion failed silently on
// every non-banking install, on every boot and every upgrade.
//
// Applicability is expressed the way RegulationApplicability.archetypes already
// expresses it — entries match either an archetype CATEGORY slug or a specific
// archetype id — so there is one rule for "is this vertical content mine?".
const ARCHETYPES = {
  bian_service_landscape_v14_0_0: ["banking-financial-services"],
  // A finer-grained model, to prove id-level matching is not category-only.
  ncua_credit_union_pack: ["credit-union"],
} as const;

describe("referenceModelAppliesToInstall", () => {
  it("applies a universal model to every install", () => {
    // IT4IT declares no archetypes: IT management describes any org running IT.
    for (const install of [
      { category: "software-platform", archetypeId: "software-platform" },
      { category: "banking-financial-services", archetypeId: "community-bank" },
      { category: null, archetypeId: null },
    ]) {
      expect(referenceModelAppliesToInstall("it4it_v3_0_1", install, ARCHETYPES)).toBe(true);
    }
  });

  it("applies a banking model on a banking-category install", () => {
    expect(
      referenceModelAppliesToInstall(
        "bian_service_landscape_v14_0_0",
        { category: "banking-financial-services", archetypeId: "community-bank" },
        ARCHETYPES,
      ),
    ).toBe(true);
  });

  // The reported case: this operator install is a software platform and was
  // asserting a banking hierarchy.
  it("does NOT apply a banking model on a software-platform install", () => {
    expect(
      referenceModelAppliesToInstall(
        "bian_service_landscape_v14_0_0",
        { category: "software-platform", archetypeId: "software-platform" },
        ARCHETYPES,
      ),
    ).toBe(false);
  });

  it("does not apply a banking model to any other archetype", () => {
    for (const category of ["dry-cleaning", "field-service", "education-training", "beauty-personal-care"]) {
      expect(
        referenceModelAppliesToInstall(
          "bian_service_landscape_v14_0_0",
          { category, archetypeId: category },
          ARCHETYPES,
        ),
      ).toBe(false);
    }
  });

  it("matches on a specific archetype id, not only the category", () => {
    expect(
      referenceModelAppliesToInstall(
        "ncua_credit_union_pack",
        { category: "banking-financial-services", archetypeId: "credit-union" },
        ARCHETYPES,
      ),
    ).toBe(true);
    // Same category, different archetype id — must NOT match.
    expect(
      referenceModelAppliesToInstall(
        "ncua_credit_union_pack",
        { category: "banking-financial-services", archetypeId: "community-bank" },
        ARCHETYPES,
      ),
    ).toBe(false);
  });

  // Setup has not run yet. Treat as not-applicable rather than applicable:
  // seeding a banking hierarchy onto an install that has not said it is a bank
  // is the defect being fixed. The seed is idempotent and re-runs every boot,
  // so an install that later declares banking picks it up.
  it("treats an undeclared archetype as not applicable for industry models", () => {
    expect(
      referenceModelAppliesToInstall(
        "bian_service_landscape_v14_0_0",
        { category: null, archetypeId: null },
        ARCHETYPES,
      ),
    ).toBe(false);
  });
});
