import { describe, expect, it } from "vitest";

import { readActivationProfile } from "@/lib/storefront/archetype-activation";
import { canUseCustomerNetworkTopology } from "./topology-applicability";

const baseProfile = {
  modules: [],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
} as const;

describe("canUseCustomerNetworkTopology", () => {
  it("allows MSP-type managed network profiles", () => {
    const profile = readActivationProfile({
      ...baseProfile,
      profileType: "managed-service-provider",
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
      axes: {
        form: "services",
        delivery: "hybrid",
        primaryConsumer: "business",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "recurring-agreement",
        provisioning: "account-and-entitlement",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: {
          scope: "primary",
          it4itStages: ["detect-to-correct", "deploy-to-operate", "request-to-fulfill"],
        },
        forEmployees: { scope: "standard" },
        productsAndServicesSold: { scope: "primary" },
      },
    });

    expect(canUseCustomerNetworkTopology(profile)).toBe(true);
  });

  it("blocks appointment-service archetypes such as hair salons", () => {
    const profile = readActivationProfile({
      ...baseProfile,
      profileType: "standard",
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

    expect(canUseCustomerNetworkTopology(profile)).toBe(false);
  });

  it("blocks optional facilities-style network inventory", () => {
    const profile = readActivationProfile({
      ...baseProfile,
      profileType: "standard",
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
      axes: {
        form: "services",
        delivery: "physical",
        primaryConsumer: "household",
        consumptionChannel: "onsite-plus-portal",
        commercialModel: "recurring-agreement",
        provisioning: "account-and-entitlement",
        platform: "no",
      },
      portfolios: {
        foundational: { scope: "minimal" },
        manufactureAndDeliver: { scope: "standard" },
        forEmployees: { scope: "minimal" },
        productsAndServicesSold: { scope: "primary" },
      },
    });

    expect(canUseCustomerNetworkTopology(profile)).toBe(false);
  });

  it("returns false for null/undefined profiles", () => {
    expect(canUseCustomerNetworkTopology(null)).toBe(false);
    expect(canUseCustomerNetworkTopology(undefined)).toBe(false);
  });
});
