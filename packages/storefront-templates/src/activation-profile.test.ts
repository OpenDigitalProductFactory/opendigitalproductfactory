import { describe, expect, it } from "vitest";

import {
  activationHasCapability,
  getCapabilityApplicability,
  readActivationProfile,
} from "./activation-profile";

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
});
