import { describe, it, expect } from "vitest";
import { deriveStorefrontCompositionView } from "./composition-view";
import type { StorefrontCompositionTemplateRef } from "./composition-view";
import type { ActivationProfile } from "@dpf/storefront-templates";

function makeProfile(
  modules: string[],
  serviceCategories: string[] = [],
): ActivationProfile {
  return {
    profileType: "standard",
    modules: modules as ActivationProfile["modules"],
    seededServiceCategories: serviceCategories,
    billingReadinessMode: "off",
    customerGraph: "simple",
    seededConfigurationItemTypes: [],
  };
}

function makeRef(
  overrides: Partial<StorefrontCompositionTemplateRef> & Pick<StorefrontCompositionTemplateRef, "compositionId" | "archetypeSlug" | "category">,
): StorefrontCompositionTemplateRef {
  return {
    name: overrides.archetypeSlug,
    activationProfile: makeProfile(["crm"]),
    ...overrides,
  };
}

const PRIMARY = makeRef({
  compositionId: "comp-1",
  archetypeSlug: "hoa",
  category: "hoa-property-management",
  name: "HOA Management",
  activationProfile: makeProfile(["crm", "payments"]),
});

describe("deriveStorefrontCompositionView", () => {
  it("returns single-line view for no secondaries", () => {
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: PRIMARY,
      secondaries: [],
    });
    expect(view.primary.role).toBe("primary");
    expect(view.primary.status).toBe("good");
    expect(view.secondaries).toHaveLength(0);
    expect(view.compatibilitySummary.label).toBe("Single service line");
    expect(view.compatibilitySummary.status).toBe("good");
  });

  it("same-category secondary → good status", () => {
    const secondary = makeRef({
      compositionId: "comp-2",
      archetypeSlug: "hoa-2",
      category: "hoa-property-management",
      name: "HOA Commercial",
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: PRIMARY,
      secondaries: [secondary],
    });
    expect(view.secondaries[0].status).toBe("good");
    expect(view.compatibilitySummary.status).toBe("good");
    expect(view.compatibilitySummary.reasons).toHaveLength(0);
  });

  it("cross-category secondary → concern status", () => {
    const secondary = makeRef({
      compositionId: "comp-2",
      archetypeSlug: "trades",
      category: "trades-maintenance",
      name: "Trades",
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: PRIMARY,
      secondaries: [secondary],
    });
    expect(view.secondaries[0].status).toBe("concern");
    expect(view.compatibilitySummary.status).toBe("concern");
    expect(view.compatibilitySummary.reasons).toHaveLength(1);
  });

  it("banking + healthcare → acute status", () => {
    const bankingPrimary = makeRef({
      compositionId: "comp-1",
      archetypeSlug: "bank",
      category: "banking-financial-services",
      name: "Bank",
    });
    const healthcareSecondary = makeRef({
      compositionId: "comp-2",
      archetypeSlug: "health",
      category: "healthcare-wellness",
      name: "Health",
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: bankingPrimary,
      secondaries: [healthcareSecondary],
    });
    expect(view.secondaries[0].status).toBe("acute");
    expect(view.compatibilitySummary.status).toBe("acute");
  });

  it("public-sector cross-category → acute status", () => {
    const pubPrimary = makeRef({
      compositionId: "comp-1",
      archetypeSlug: "gov",
      category: "public-sector",
      name: "Government",
    });
    const retailSecondary = makeRef({
      compositionId: "comp-2",
      archetypeSlug: "retail",
      category: "retail-goods",
      name: "Retail",
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: pubPrimary,
      secondaries: [retailSecondary],
    });
    expect(view.secondaries[0].status).toBe("acute");
  });

  it("worst-case status bubbles to summary with two secondaries", () => {
    const concern = makeRef({
      compositionId: "comp-2",
      archetypeSlug: "trades",
      category: "trades-maintenance",
      name: "Trades",
    });
    const acute = makeRef({
      compositionId: "comp-3",
      archetypeSlug: "health",
      category: "healthcare-wellness",
      name: "Health",
    });
    const bankPrimary = makeRef({
      compositionId: "comp-1",
      archetypeSlug: "bank",
      category: "banking-financial-services",
      name: "Bank",
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: bankPrimary,
      secondaries: [concern, acute],
    });
    expect(view.compatibilitySummary.status).toBe("acute");
    expect(view.compatibilitySummary.reasons).toHaveLength(2);
  });

  it("missing activationProfile → unknown status, no crash", () => {
    const noProfile = makeRef({
      compositionId: "comp-2",
      archetypeSlug: "unknown-arch",
      category: "some-category",
      name: "Unknown",
      activationProfile: null,
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: PRIMARY,
      secondaries: [noProfile],
    });
    expect(view.secondaries[0].status).toBe("unknown");
    expect(view.secondaries[0].warnings).toContain(
      "Archetype metadata is incomplete — compatibility cannot be assessed.",
    );
  });

  it("seededCounts are surfaced on rows", () => {
    const secondary = makeRef({
      compositionId: "comp-2",
      archetypeSlug: "trades",
      category: "trades-maintenance",
      name: "Trades",
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: PRIMARY,
      secondaries: [secondary],
      seededCountsByCompositionId: {
        "comp-1": { items: 4, sections: 3 },
        "comp-2": { items: 6, sections: 2 },
      },
    });
    expect(view.primary.contributedItemCount).toBe(4);
    expect(view.primary.contributedSectionCount).toBe(3);
    expect(view.secondaries[0].contributedItemCount).toBe(6);
    expect(view.secondaries[0].contributedSectionCount).toBe(2);
  });

  it("visual pattern: banking → trust-gate-board", () => {
    const bankPrimary = makeRef({
      compositionId: "comp-1",
      archetypeSlug: "bank",
      category: "banking-financial-services",
      name: "Bank",
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: bankPrimary,
      secondaries: [],
    });
    expect(view.primary.visualPattern).toBe("trust-gate-board");
  });

  it("visual pattern: fitness → slot-board", () => {
    const fitnessPrimary = makeRef({
      compositionId: "comp-1",
      archetypeSlug: "fitness",
      category: "fitness-recreation",
      name: "Fitness",
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: fitnessPrimary,
      secondaries: [],
    });
    expect(view.primary.visualPattern).toBe("slot-board");
  });

  it("visual pattern: trades with service-operations → map-dispatch", () => {
    const tradesPrimary = makeRef({
      compositionId: "comp-1",
      archetypeSlug: "trades",
      category: "trades-maintenance",
      name: "Trades",
      activationProfile: makeProfile(["crm", "service-operations"]),
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: tradesPrimary,
      secondaries: [],
    });
    expect(view.primary.visualPattern).toBe("map-dispatch");
  });

  it("primary.operatorLabel equals archetype name", () => {
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: PRIMARY,
      secondaries: [],
    });
    expect(view.primary.operatorLabel).toBe("HOA Management");
  });

  it("statusIntent maps correctly: good→success, concern→warning, acute→danger", () => {
    const bankPrimary = makeRef({
      compositionId: "comp-1",
      archetypeSlug: "bank",
      category: "banking-financial-services",
      name: "Bank",
    });
    const secondaryConcern = makeRef({
      compositionId: "comp-2",
      archetypeSlug: "trades",
      category: "trades-maintenance",
      name: "Trades",
    });
    const secondaryAcute = makeRef({
      compositionId: "comp-3",
      archetypeSlug: "health",
      category: "healthcare-wellness",
      name: "Health",
    });
    const view = deriveStorefrontCompositionView({
      storefrontId: "sf-1",
      primary: bankPrimary,
      secondaries: [secondaryConcern, secondaryAcute],
    });
    expect(view.secondaries[0].statusIntent).toBe("warning");
    expect(view.secondaries[1].statusIntent).toBe("danger");
  });
});
