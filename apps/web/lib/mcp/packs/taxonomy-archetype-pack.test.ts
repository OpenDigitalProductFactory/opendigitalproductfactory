import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  storefrontArchetype: { findUnique: vi.fn(), create: vi.fn() },
  storefrontConfig: { findFirst: vi.fn() },
  storefrontItem: { findMany: vi.fn() },
  storefrontSection: { findMany: vi.fn() },
  featureBuild: { findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  onboardingDraft: { create: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

const attribution = vi.hoisted(() => ({
  attributeFeatureBuild: vi.fn(),
  formatAttributionRecommendation: vi.fn(),
  confirmFeatureTaxonomy: vi.fn(),
}));
vi.mock("@/lib/build/feature-attribution", () => ({
  attributeFeatureBuild: (...a: unknown[]) => attribution.attributeFeatureBuild(...a),
  formatAttributionRecommendation: (...a: unknown[]) => attribution.formatAttributionRecommendation(...a),
  confirmFeatureTaxonomy: (...a: unknown[]) => attribution.confirmFeatureTaxonomy(...a),
}));

import { taxonomyArchetypePack } from "./taxonomy-archetype-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "generate_custom_archetype",
  "assess_archetype_refinement",
  "suggest_taxonomy_placement",
  "confirm_taxonomy_placement",
  "prefill_onboarding_wizard",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("taxonomy-archetype pack — registration", () => {
  it("exposes exactly the five tools with a handler each", () => {
    expect(taxonomyArchetypePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(taxonomyArchetypePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of taxonomyArchetypePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants for every tool", () => {
    expect(taxonomyArchetypePack.grants.generate_custom_archetype).toEqual(["marketing_write"]);
    expect(taxonomyArchetypePack.grants.assess_archetype_refinement).toEqual(["marketing_read"]);
    expect(taxonomyArchetypePack.grants.suggest_taxonomy_placement).toEqual(["registry_read"]);
    expect(taxonomyArchetypePack.grants.confirm_taxonomy_placement).toEqual(["backlog_write"]);
    expect(taxonomyArchetypePack.grants.prefill_onboarding_wizard).toEqual(["data_governance_validate"]);

    expect(isToolAllowedByGrants("generate_custom_archetype", ["marketing_write"])).toBe(true);
    expect(isToolAllowedByGrants("assess_archetype_refinement", ["marketing_read"])).toBe(true);
    expect(isToolAllowedByGrants("suggest_taxonomy_placement", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("confirm_taxonomy_placement", ["backlog_write"])).toBe(true);
    expect(isToolAllowedByGrants("prefill_onboarding_wizard", ["data_governance_validate"])).toBe(true);
  });
});

describe("taxonomy-archetype pack — handler behavior (delegation preserved)", () => {
  it("generate_custom_archetype rejects when no offerings are supplied, before touching the db", async () => {
    const res = await taxonomyArchetypePack.handlers.generate_custom_archetype(
      { businessName: "Co-working Space", offerings: [] },
      "u1",
      {},
    );
    expect(res.success).toBe(false);
    expect(res.message).toContain("At least one offering");
    expect(db.storefrontArchetype.findUnique).not.toHaveBeenCalled();
  });

  it("generate_custom_archetype creates a StorefrontArchetype and returns its id", async () => {
    db.storefrontArchetype.findUnique.mockResolvedValue(null);
    db.storefrontArchetype.create.mockResolvedValue({
      archetypeId: "custom-co-working-space",
      name: "Co-working Space",
      category: "professional-services",
      ctaType: "booking",
    });
    const res = await taxonomyArchetypePack.handlers.generate_custom_archetype(
      { businessName: "Co-working Space", offerings: ["Hot desk"], primaryCtaType: "booking" },
      "u1",
      {},
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("custom-co-working-space");
    expect(db.storefrontArchetype.create).toHaveBeenCalledTimes(1);
  });

  it("assess_archetype_refinement reports no storefront when none is configured", async () => {
    db.storefrontConfig.findFirst.mockResolvedValue(null);
    const res = await taxonomyArchetypePack.handlers.assess_archetype_refinement({}, "u1", {});
    expect(res.success).toBe(false);
    expect(res.message).toContain("No storefront configured");
  });

  it("suggest_taxonomy_placement errors when there is no active build, before delegating", async () => {
    db.featureBuild.findFirst.mockResolvedValue(null);
    const res = await taxonomyArchetypePack.handlers.suggest_taxonomy_placement({}, "u1", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("No active build");
    expect(attribution.attributeFeatureBuild).not.toHaveBeenCalled();
  });

  it("confirm_taxonomy_placement delegates to confirmFeatureTaxonomy and returns its result", async () => {
    db.featureBuild.findFirst.mockResolvedValue({ buildId: "FB-1" });
    attribution.confirmFeatureTaxonomy.mockResolvedValue({
      success: true,
      confirmedNodeId: "foundational/x",
      message: "Confirmed",
    });
    db.featureBuild.findUnique.mockResolvedValue({ plan: null });
    db.featureBuild.update.mockResolvedValue({});
    const res = await taxonomyArchetypePack.handlers.confirm_taxonomy_placement(
      { nodeId: "foundational/x" },
      "u1",
      {},
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("FB-1");
    expect(res.data).toMatchObject({ confirmedNodeId: "foundational/x" });
    expect(attribution.confirmFeatureTaxonomy).toHaveBeenCalledWith("FB-1", "foundational/x", undefined);
  });

  it("prefill_onboarding_wizard stores a draft and returns the wizard URL", async () => {
    db.onboardingDraft.create.mockResolvedValue({ id: "DRAFT-1" });
    const res = await taxonomyArchetypePack.handlers.prefill_onboarding_wizard(
      { name: "GDPR", shortName: "GDPR", sourceType: "external" },
      "actor-9",
      {},
    );
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ wizardUrl: "/compliance/onboard?draft=DRAFT-1", draftId: "DRAFT-1" });
    const [arg] = db.onboardingDraft.create.mock.calls[0] as [{ data: { createdBy: string } }];
    expect(arg.data.createdBy).toBe("actor-9");
  });
});
