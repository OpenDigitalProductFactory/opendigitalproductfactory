import { describe, expect, it } from "vitest";

import {
  deriveCustomerConfigurationItemDefaults,
  readActivationProfile,
} from "@/lib/storefront/archetype-activation";

describe("deriveCustomerConfigurationItemDefaults", () => {
  it("returns MSP-seeded customer CI defaults from the activation profile", () => {
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
        {
          key: "linux-server",
          label: "Linux Server",
          technologySourceType: "open_source",
          defaultReviewCadenceDays: 90,
          supportsLicensing: false,
        },
      ],
      seededBillingUnitTypes: [
        { key: "device", label: "Device" },
        { key: "seat", label: "Seat" },
      ],
      seededChargeModels: [
        { key: "pass_through", label: "Pass-through" },
        { key: "bundled", label: "Bundled" },
      ],
    });

    const defaults = deriveCustomerConfigurationItemDefaults(profile);

    expect(defaults.itemTypes).toHaveLength(2);
    expect(defaults.itemTypes[0]).toMatchObject({
      key: "endpoint-security-license",
      supportsLicensing: true,
      defaultChargeModel: "pass_through",
    });
    expect(defaults.billingUnitTypes.map((item) => item.key)).toEqual(["device", "seat"]);
    expect(defaults.chargeModels.map((item) => item.key)).toEqual(["pass_through", "bundled"]);
  });

  it("falls back to empty defaults when no MSP activation profile exists", () => {
    const defaults = deriveCustomerConfigurationItemDefaults(null);

    expect(defaults.itemTypes).toEqual([]);
    expect(defaults.billingUnitTypes).toEqual([]);
    expect(defaults.chargeModels).toEqual([]);
  });
});
