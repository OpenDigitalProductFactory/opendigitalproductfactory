import { describe, expect, it } from "vitest";

import {
  activationHasCapability,
  getCapabilityApplicability,
  readActivationProfile,
} from "./activation-profile";
import { ALL_ARCHETYPES } from "./archetypes";

describe("readActivationProfile", () => {
  it("normalizes legacy MSP modules into operating axes and derived capabilities", () => {
    const profile = readActivationProfile({
      profileType: "managed-service-provider",
      modules: ["customer-estate", "service-agreements", "service-operations"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
      seededServiceCategories: ["managed-support"],
    });

    expect(profile).toMatchObject({
      profileType: "managed-service-provider",
      axes: {
        primaryConsumer: "business",
        commercialModel: "recurring-agreement",
      },
      billingProfile: {
        primaryPaymentPattern: "recurring-agreement",
        recurringBillingApplicability: "required",
      },
    });
    expect(profile?.portfolios.manufactureAndDeliver.scope).toBe("primary");
    expect(activationHasCapability(profile, "customer-estate")).toBe(true);
    expect(getCapabilityApplicability(profile, "edge-node-customer-deployment")).toBe("required");
  });

  it("normalizes axis-shaped salon profiles without recurring billing as the default motion", () => {
    const profile = readActivationProfile({
      profileType: "standard",
      modules: ["integrations"],
      billingReadinessMode: "none",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "individual",
        consumptionChannel: "physical",
        commercialModel: "appointment-checkout",
        provisioning: "account-with-billing",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "minimal" },
        forEmployees: { scope: "minimal" },
        productsAndServicesSold: { scope: "primary" },
      },
    });

    expect(getCapabilityApplicability(profile, "appointment-checkout")).toBe("required");
    expect(getCapabilityApplicability(profile, "recurring-agreement-billing")).toBe("optional");
    expect(getCapabilityApplicability(profile, "customer-estate")).toBe("not-applicable");
    expect(profile?.billingProfile.primaryPaymentPattern).toBe("appointment-checkout");
  });

  it("rejects invalid axis values and unknown capability overrides", () => {
    expect(
      readActivationProfile({
        profileType: "standard",
        modules: ["integrations"],
        billingReadinessMode: "none",
        customerGraph: "none",
        estateSeparation: "shared",
        axes: {
          form: "rental",
          delivery: "physical",
          primaryConsumer: "individual",
          consumptionChannel: "physical",
          commercialModel: "appointment-checkout",
          provisioning: "account-with-billing",
          platform: "no",
        },
        portfolios: {
          foundational: { scope: "minimal" },
          manufactureAndDeliver: { scope: "minimal" },
          forEmployees: { scope: "minimal" },
          productsAndServicesSold: { scope: "primary" },
        },
      }),
    ).toBeNull();

    expect(
      readActivationProfile({
        profileType: "standard",
        modules: ["integrations"],
        billingReadinessMode: "none",
        customerGraph: "none",
        estateSeparation: "shared",
        capabilityOverrides: [
          {
            capabilityKey: "teamlogic-only",
            applicability: "required",
            reason: "Invalid bespoke override",
          },
        ],
      }),
    ).toBeNull();
  });

  it("defaults governance to investor-owned for legacy and axis-shaped profiles, and rejects invalid values", () => {
    const legacy = readActivationProfile({
      profileType: "standard",
      modules: ["integrations"],
      billingReadinessMode: "none",
      customerGraph: "none",
      estateSeparation: "shared",
    });
    expect(legacy?.axes.governance).toBe("investor-owned");

    const axisShapedWithoutGovernance = readActivationProfile({
      profileType: "standard",
      modules: ["integrations"],
      billingReadinessMode: "none",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "individual",
        consumptionChannel: "physical",
        commercialModel: "appointment-checkout",
        provisioning: "account-with-billing",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "minimal" },
        forEmployees: { scope: "minimal" },
        productsAndServicesSold: { scope: "primary" },
      },
    });
    expect(axisShapedWithoutGovernance?.axes.governance).toBe("investor-owned");

    expect(
      readActivationProfile({
        profileType: "standard",
        modules: ["integrations"],
        billingReadinessMode: "none",
        customerGraph: "none",
        estateSeparation: "shared",
        axes: {
          form: "services",
          delivery: "physical",
          primaryConsumer: "individual",
          consumptionChannel: "physical",
          commercialModel: "appointment-checkout",
          provisioning: "account-with-billing",
          platform: "no",
          governance: "shareholder",
        },
        portfolios: {
          foundational: { scope: "minimal" },
          manufactureAndDeliver: { scope: "minimal" },
          forEmployees: { scope: "minimal" },
          productsAndServicesSold: { scope: "primary" },
        },
      }),
    ).toBeNull();
  });

  it("normalizes member-owned axis profiles with the civic capability set derived", () => {
    const profile = readActivationProfile({
      profileType: "standard",
      modules: ["integrations"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "none",
      estateSeparation: "shared",
      axes: {
        form: "services",
        delivery: "hybrid",
        primaryConsumer: "member",
        consumptionChannel: "multi-channel",
        commercialModel: "account-based-fees",
        provisioning: "account-with-kyc",
        platform: "no",
        governance: "member-owned",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "standard" },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
    });

    expect(profile?.axes.governance).toBe("member-owned");
    expect(getCapabilityApplicability(profile, "member-governance")).toBe("required");
    expect(getCapabilityApplicability(profile, "membership-eligibility")).toBe("required");
    expect(activationHasCapability(profile, "member-equity")).toBe(true);
  });
});

describe("existing archetype regression (governance axis is inert)", () => {
  const CIVIC_CAPABILITY_KEYS = [
    "member-governance",
    "membership-eligibility",
    "member-equity",
    "public-body-governance",
    "records-request",
    "service-request-311",
  ] as const;

  it("every archetype without a governance declaration normalizes to investor-owned with all civic capabilities not-applicable", () => {
    const legacyArchetypes = ALL_ARCHETYPES.filter(
      (archetype) =>
        archetype.activationProfile !== undefined &&
        archetype.activationProfile.axes?.governance === undefined,
    );
    expect(legacyArchetypes.length).toBeGreaterThan(0);

    for (const archetype of legacyArchetypes) {
      const profile = readActivationProfile(archetype.activationProfile);
      expect(profile, `profile for ${archetype.archetypeId} should normalize`).not.toBeNull();
      expect(
        profile?.axes.governance,
        `${archetype.archetypeId} should default to investor-owned`,
      ).toBe("investor-owned");

      for (const key of CIVIC_CAPABILITY_KEYS) {
        expect(
          getCapabilityApplicability(profile, key),
          `${archetype.archetypeId} should not activate ${key}`,
        ).toBe("not-applicable");
      }
    }
  });

  it("the small-town municipality archetype derives the public-body capability set from its declared axes", () => {
    const town = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "small-town-municipality");
    expect(town?.activationProfile).toBeDefined();

    const profile = readActivationProfile(town?.activationProfile);
    expect(profile?.axes.governance).toBe("public-body");
    expect(profile?.axes.primaryConsumer).toBe("resident");
    expect(getCapabilityApplicability(profile, "public-body-governance")).toBe("required");
    expect(getCapabilityApplicability(profile, "records-request")).toBe("required");
    expect(getCapabilityApplicability(profile, "service-request-311")).toBe("required");
    expect(getCapabilityApplicability(profile, "member-governance")).toBe("not-applicable");
    expect(profile?.billingProfile.primaryPaymentPattern).toBe("ad-hoc-invoice");
  });

  it("the municipal utility derives the public-body set with usage-based billing and a ratepayer vocabulary skin", () => {
    const utility = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "municipal-utility");
    expect(utility?.activationProfile).toBeDefined();

    const profile = readActivationProfile(utility?.activationProfile);
    expect(profile?.axes.governance).toBe("public-body");
    expect(profile?.axes.commercialModel).toBe("usage-based");
    expect(getCapabilityApplicability(profile, "public-body-governance")).toBe("required");
    expect(getCapabilityApplicability(profile, "records-request")).toBe("required");
    expect(getCapabilityApplicability(profile, "service-request-311")).toBe("required");
    expect(profile?.billingProfile.primaryPaymentPattern).toBe("usage-based");
    expect(profile?.billingProfile.recurringBillingApplicability).toBe("recommended");

    expect(utility?.vocabulary).toMatchObject({
      stakeholderLabel: "Ratepayers",
      inboxLabel: "Service Orders",
    });
  });
});
