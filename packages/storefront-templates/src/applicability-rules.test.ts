import { describe, expect, it } from "vitest";

import {
  deriveBillingPatternProfile,
  deriveCapabilityApplicability,
} from "./applicability-rules";
import type {
  CapabilityActivation,
  CapabilityOverride,
  OperatingModelAxes,
  PortfolioDecomposition,
} from "./types";

function getCapability(
  capabilities: Map<string, CapabilityActivation>,
  key: string,
): CapabilityActivation {
  const capability = capabilities.get(key);
  if (!capability) {
    throw new Error(`Missing capability ${key}`);
  }
  return capability;
}

const mspAxes: OperatingModelAxes = {
  form: "services",
  delivery: "hybrid",
  primaryConsumer: "business",
  consumptionChannel: "onsite-plus-portal",
  commercialModel: "recurring-agreement",
  provisioning: "account-and-entitlement",
  platform: "no",
};

const mspPortfolios: PortfolioDecomposition = {
  foundational: { scope: "minimal" },
  manufactureAndDeliver: {
    scope: "primary",
    it4itStages: ["detect-to-correct", "deploy-to-operate", "request-to-fulfill"],
  },
  forEmployees: { scope: "standard" },
  productsAndServicesSold: { scope: "primary" },
};

const salonAxes: OperatingModelAxes = {
  form: "services",
  delivery: "physical",
  primaryConsumer: "individual",
  consumptionChannel: "physical",
  commercialModel: "appointment-checkout",
  provisioning: "account-with-billing",
  platform: "no",
};

const salonPortfolios: PortfolioDecomposition = {
  foundational: { scope: "minimal" },
  manufactureAndDeliver: { scope: "minimal" },
  forEmployees: { scope: "minimal" },
  productsAndServicesSold: { scope: "primary" },
};

const retailAxes: OperatingModelAxes = {
  form: "goods",
  delivery: "physical",
  primaryConsumer: "individual",
  consumptionChannel: "physical",
  commercialModel: "point-of-sale",
  provisioning: "none",
  platform: "no",
};

const hoaAxes: OperatingModelAxes = {
  form: "services",
  delivery: "physical",
  primaryConsumer: "household",
  consumptionChannel: "portal-api",
  commercialModel: "recurring-agreement",
  provisioning: "account-with-billing",
  platform: "no",
};

describe("deriveCapabilityApplicability", () => {
  it("derives MSP capabilities from axes and portfolios, with only remote support overridden", () => {
    const overrides: CapabilityOverride[] = [
      {
        capabilityKey: "remote-support",
        applicability: "recommended",
        reason: "consent gating not yet automated",
      },
    ];

    const capabilities = deriveCapabilityApplicability(mspAxes, mspPortfolios, overrides);

    expect(getCapability(capabilities, "customer-estate")).toMatchObject({
      applicability: "required",
      ownershipScopes: ["customer-account", "customer-site"],
      isolation: "strict-customer-scope",
    });
    expect(getCapability(capabilities, "edge-node-customer-deployment").applicability).toBe("required");
    expect(getCapability(capabilities, "network-inventory").applicability).toBe("required");
    expect(getCapability(capabilities, "service-agreements").applicability).toBe("required");
    expect(getCapability(capabilities, "recurring-agreement-billing").applicability).toBe("required");
    expect(getCapability(capabilities, "appointment-checkout").applicability).toBe("hidden");
    expect(getCapability(capabilities, "remote-support")).toMatchObject({
      applicability: "recommended",
      overrideReason: "consent gating not yet automated",
    });
  });

  it("keeps a salon appointment and point-of-sale first without activating customer estate", () => {
    const capabilities = deriveCapabilityApplicability(salonAxes, salonPortfolios);

    expect(getCapability(capabilities, "appointment-checkout").applicability).toBe("required");
    expect(getCapability(capabilities, "point-of-sale").applicability).toBe("required");
    expect(getCapability(capabilities, "recurring-agreement-billing").applicability).toBe("optional");
    expect(getCapability(capabilities, "customer-estate").applicability).toBe("not-applicable");
    expect(getCapability(capabilities, "edge-node-customer-deployment").applicability).toBe("hidden");
  });

  it("derives retail and HOA variants without changing the rules for each archetype", () => {
    const retailCapabilities = deriveCapabilityApplicability(retailAxes, salonPortfolios);
    const hoaCapabilities = deriveCapabilityApplicability(hoaAxes, {
      ...salonPortfolios,
      manufactureAndDeliver: { scope: "standard" },
    });

    expect(getCapability(retailCapabilities, "point-of-sale").applicability).toBe("required");
    expect(getCapability(retailCapabilities, "customer-estate").applicability).toBe("optional");
    expect(getCapability(hoaCapabilities, "customer-sites").applicability).toBe("required");
    expect(getCapability(hoaCapabilities, "service-agreements").applicability).toBe("required");
    expect(getCapability(hoaCapabilities, "lifecycle-review-queues").applicability).toBe("required");
  });
});

describe("deriveBillingPatternProfile", () => {
  it("derives recurring agreement billing for MSP axes", () => {
    expect(deriveBillingPatternProfile(mspAxes)).toMatchObject({
      primaryPaymentPattern: "recurring-agreement",
      recurringBillingApplicability: "required",
      invoiceExecutionMode: "prepared-not-prescribed",
    });
  });

  it("derives appointment checkout billing for salon axes", () => {
    expect(deriveBillingPatternProfile(salonAxes)).toMatchObject({
      primaryPaymentPattern: "appointment-checkout",
      recurringBillingApplicability: "optional",
      invoiceExecutionMode: "manual",
    });
  });
});
