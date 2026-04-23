import { describe, expect, it } from "vitest";
import {
  deriveCustomerConfigurationItemDefaults,
  deriveRevenueModelFromActivationProfile,
  isManagedServiceProviderProfile,
  readActivationProfile,
} from "./archetype-activation";

describe("readActivationProfile", () => {
  it("parses a valid managed-service-provider profile", () => {
    const profile = readActivationProfile({
      profileType: "managed-service-provider",
      modules: ["customer-estate", "service-agreements", "service-operations"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
      seededServiceCategories: ["managed-support"],
      seededConfigurationItemTypes: [
        {
          key: "endpoint-security-license",
          label: "Endpoint Security License",
          technologySourceType: "commercial",
          defaultReviewCadenceDays: 30,
          supportsLicensing: true,
          defaultChargeModel: "pass_through",
        },
      ],
      seededBillingUnitTypes: [{ key: "device", label: "Device" }],
      seededChargeModels: [{ key: "pass_through", label: "Pass-through" }],
    });

    expect(profile).toMatchObject({
      profileType: "managed-service-provider",
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
    });
  });

  it("returns null for malformed activation profile data", () => {
    expect(readActivationProfile("managed-service-provider")).toBeNull();
    expect(readActivationProfile({ profileType: "managed-service-provider" })).toBeNull();
    expect(readActivationProfile({ modules: [] })).toBeNull();
  });
});

describe("deriveCustomerConfigurationItemDefaults", () => {
  it("returns seeded MSP operational defaults for managed items", () => {
    const profile = readActivationProfile({
      profileType: "managed-service-provider",
      modules: ["customer-estate", "service-agreements", "service-operations"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
      seededConfigurationItemTypes: [
        {
          key: "endpoint-security-license",
          label: "Endpoint Security License",
          technologySourceType: "commercial",
          defaultReviewCadenceDays: 30,
          supportsLicensing: true,
          defaultChargeModel: "pass_through",
        },
      ],
      seededBillingUnitTypes: [{ key: "device", label: "Device" }],
      seededChargeModels: [{ key: "pass_through", label: "Pass-through" }],
    });

    const defaults = deriveCustomerConfigurationItemDefaults(profile);

    expect(defaults.itemTypes[0]?.key).toBe("endpoint-security-license");
    expect(defaults.billingUnitTypes[0]?.key).toBe("device");
    expect(defaults.chargeModels[0]?.key).toBe("pass_through");
  });
});

describe("isManagedServiceProviderProfile", () => {
  it("detects the stronger MSP activation profile", () => {
    const profile = readActivationProfile({
      profileType: "managed-service-provider",
      modules: ["customer-estate", "service-agreements", "service-operations"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
    });

    expect(isManagedServiceProviderProfile(profile)).toBe(true);
  });

  it("returns false for null or standard profiles", () => {
    expect(isManagedServiceProviderProfile(null)).toBe(false);
    expect(
      isManagedServiceProviderProfile(
        readActivationProfile({
          profileType: "standard",
          modules: ["integrations"],
          billingReadinessMode: "none",
          customerGraph: "none",
          estateSeparation: "shared",
        }),
      ),
    ).toBe(false);
  });
});

describe("deriveRevenueModelFromActivationProfile", () => {
  it("returns an MSP-specific revenue model when the archetype activates MSP modules", () => {
    const profile = readActivationProfile({
      profileType: "managed-service-provider",
      modules: ["customer-estate", "service-agreements", "service-operations"],
      billingReadinessMode: "prepared-not-prescribed",
      customerGraph: "separate-customer-projection",
      estateSeparation: "strict",
    });

    expect(deriveRevenueModelFromActivationProfile(profile, "inquiry")).toBe(
      "Managed service agreements with recurring schedules and customer-estate coverage",
    );
  });

  it("falls back to CTA-based revenue models for standard archetypes", () => {
    const profile = readActivationProfile({
      profileType: "standard",
      modules: ["integrations"],
      billingReadinessMode: "none",
      customerGraph: "none",
      estateSeparation: "shared",
    });

    expect(deriveRevenueModelFromActivationProfile(profile, "booking")).toBe("Appointment-based services");
    expect(deriveRevenueModelFromActivationProfile(null, "purchase")).toBe("Product/service sales");
  });
});
