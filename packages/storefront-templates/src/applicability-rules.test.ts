import { describe, expect, it } from "vitest";

import {
  deriveBillingPatternProfile,
  deriveCapabilityApplicability,
  derivePartnerProgramProfile,
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

const platformAxes: OperatingModelAxes = {
  form: "services",
  delivery: "digital",
  primaryConsumer: "business",
  consumptionChannel: "api-portal-cli",
  commercialModel: "subscription",
  provisioning: "account-and-entitlement",
  platform: "yes-developer",
};

const channelPartnerAxes: OperatingModelAxes = {
  form: "services",
  delivery: "hybrid",
  primaryConsumer: "channel-partner",
  consumptionChannel: "portal-api",
  commercialModel: "recurring-agreement",
  provisioning: "account-and-entitlement",
  platform: "no",
};

const wholesaleAxes: OperatingModelAxes = {
  form: "goods",
  delivery: "physical",
  primaryConsumer: "business",
  consumptionChannel: "sales-assisted",
  commercialModel: "transactional",
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

describe("derivePartnerProgramProfile", () => {
  it("makes the partner portal primary when the primary consumer is a channel partner", () => {
    expect(derivePartnerProgramProfile(channelPartnerAxes, mspPortfolios)).toMatchObject({
      portalMode: "primary",
      dealRegistration: true,
      partnerGraph: "separate-partner-projection",
    });
  });

  it("offers an available partner program for platform/ecosystem (SaaS) archetypes", () => {
    const program = derivePartnerProgramProfile(platformAxes, mspPortfolios);
    expect(program.portalMode).toBe("available");
    expect(program.partnerTypes).toContain("technology");
    expect(program.dealRegistration).toBe(true);
  });

  it("offers an available partner program for managed service providers", () => {
    expect(derivePartnerProgramProfile(mspAxes, mspPortfolios)).toMatchObject({
      portalMode: "available",
      partnerTypes: ["managed-service-provider", "technology"],
    });
  });

  it("offers an available partner program for wholesale/distribution (goods sold to business)", () => {
    expect(derivePartnerProgramProfile(wholesaleAxes, salonPortfolios)).toMatchObject({
      portalMode: "available",
      partnerTypes: ["reseller", "distributor"],
    });
  });

  it("activates no partner channel for direct-to-consumer archetypes", () => {
    expect(derivePartnerProgramProfile(salonAxes, salonPortfolios).portalMode).toBe("none");
    expect(derivePartnerProgramProfile(retailAxes, salonPortfolios).portalMode).toBe("none");
    expect(derivePartnerProgramProfile(hoaAxes, salonPortfolios).portalMode).toBe("none");
  });
});

const creditUnionAxes: OperatingModelAxes = {
  form: "services",
  delivery: "hybrid",
  primaryConsumer: "member",
  consumptionChannel: "multi-channel",
  commercialModel: "account-based-fees",
  provisioning: "account-with-kyc",
  platform: "no",
  governance: "member-owned",
};

const cooperativeAxes: OperatingModelAxes = {
  form: "services",
  delivery: "physical",
  primaryConsumer: "member",
  consumptionChannel: "physical",
  commercialModel: "transactional",
  provisioning: "account-with-billing",
  platform: "no",
  governance: "member-owned",
};

const townAxes: OperatingModelAxes = {
  form: "services",
  delivery: "physical",
  primaryConsumer: "resident",
  consumptionChannel: "onsite-plus-portal",
  commercialModel: "statutory-fees-and-levies",
  provisioning: "account-with-billing",
  platform: "no",
  governance: "public-body",
};

const utilityAxes: OperatingModelAxes = {
  ...townAxes,
  commercialModel: "usage-based",
};

const policeAxes: OperatingModelAxes = {
  ...townAxes,
  provisioning: "none",
};

const communityBankAxes: OperatingModelAxes = {
  form: "services",
  delivery: "hybrid",
  primaryConsumer: "individual",
  consumptionChannel: "multi-channel",
  commercialModel: "account-based-fees",
  provisioning: "account-with-kyc",
  platform: "no",
  governance: "investor-owned",
};

const civicPortfolios: PortfolioDecomposition = {
  foundational: { scope: "minimal" },
  manufactureAndDeliver: { scope: "standard", it4itStages: ["request-to-fulfill"] },
  forEmployees: { scope: "standard" },
  productsAndServicesSold: { scope: "primary" },
};

const CIVIC_CAPABILITY_KEYS = [
  "member-governance",
  "membership-eligibility",
  "member-equity",
  "public-body-governance",
  "records-request",
  "service-request-311",
] as const;

describe("civic & member-governed capability derivation", () => {
  it("derives member governance, eligibility intake, and equity for member-owned axes (credit union)", () => {
    const capabilities = deriveCapabilityApplicability(creditUnionAxes, civicPortfolios);

    expect(getCapability(capabilities, "member-governance")).toMatchObject({
      applicability: "required",
      ownershipScopes: ["organization"],
      isolation: "organization-scope",
    });
    expect(getCapability(capabilities, "membership-eligibility").applicability).toBe("required");
    expect(getCapability(capabilities, "member-equity").applicability).toBe("recommended");
    expect(getCapability(capabilities, "customer-accounts")).toMatchObject({
      applicability: "required",
      isolation: "organization-scope",
    });
    expect(getCapability(capabilities, "public-body-governance").applicability).toBe("not-applicable");
    expect(getCapability(capabilities, "service-request-311").applicability).toBe("not-applicable");
  });

  it("derives the same member machinery for a cooperative from axes alone", () => {
    const capabilities = deriveCapabilityApplicability(cooperativeAxes, civicPortfolios);

    expect(getCapability(capabilities, "member-governance").applicability).toBe("required");
    expect(getCapability(capabilities, "membership-eligibility").applicability).toBe("required");
    expect(getCapability(capabilities, "member-equity").applicability).toBe("recommended");
  });

  it("derives public-body governance, records requests, and 311 for a town", () => {
    const capabilities = deriveCapabilityApplicability(townAxes, civicPortfolios);

    expect(getCapability(capabilities, "public-body-governance")).toMatchObject({
      applicability: "required",
      ownershipScopes: ["organization"],
      isolation: "organization-scope",
    });
    expect(getCapability(capabilities, "records-request").applicability).toBe("required");
    expect(getCapability(capabilities, "service-request-311").applicability).toBe("required");
    expect(getCapability(capabilities, "customer-accounts")).toMatchObject({
      applicability: "required",
      isolation: "organization-scope",
    });
    expect(getCapability(capabilities, "member-governance").applicability).toBe("not-applicable");
  });

  it("derives the public-body set for utility and police specializations from the same rules", () => {
    const utilityCapabilities = deriveCapabilityApplicability(utilityAxes, civicPortfolios);
    const policeCapabilities = deriveCapabilityApplicability(policeAxes, civicPortfolios);

    for (const capabilities of [utilityCapabilities, policeCapabilities]) {
      expect(getCapability(capabilities, "public-body-governance").applicability).toBe("required");
      expect(getCapability(capabilities, "records-request").applicability).toBe("required");
      expect(getCapability(capabilities, "service-request-311").applicability).toBe("required");
    }
  });

  it("activates no civic machinery for investor-owned axes, explicit or absent", () => {
    const bankCapabilities = deriveCapabilityApplicability(communityBankAxes, civicPortfolios);
    const salonCapabilities = deriveCapabilityApplicability(salonAxes, salonPortfolios);

    for (const key of CIVIC_CAPABILITY_KEYS) {
      expect(getCapability(bankCapabilities, key).applicability).toBe("not-applicable");
      expect(getCapability(salonCapabilities, key).applicability).toBe("not-applicable");
    }
  });
});

const rentalAxes: OperatingModelAxes = {
  form: "services",
  delivery: "physical",
  primaryConsumer: "business",
  consumptionChannel: "onsite-plus-portal",
  commercialModel: "usage-based",
  provisioning: "reservation-and-return",
  platform: "no",
};

describe("rental / shared-asset capability derivation", () => {
  it("derives the rental-fleet / rental-agreements / asset-pool set from reservation-and-return provisioning", () => {
    const capabilities = deriveCapabilityApplicability(rentalAxes, salonPortfolios);

    expect(getCapability(capabilities, "rental-fleet").applicability).toBe("required");
    expect(getCapability(capabilities, "rental-agreements").applicability).toBe("required");
    expect(getCapability(capabilities, "asset-pool").applicability).toBe("required");
  });

  it("does not derive rental capabilities for a usage-based archetype that is not reservation-and-return (e.g. a utility)", () => {
    const utilityLikeAxes: OperatingModelAxes = { ...rentalAxes, provisioning: "account-with-billing", primaryConsumer: "resident", governance: "public-body" };
    const capabilities = deriveCapabilityApplicability(utilityLikeAxes, salonPortfolios);

    expect(getCapability(capabilities, "rental-fleet").applicability).toBe("not-applicable");
    expect(getCapability(capabilities, "rental-agreements").applicability).toBe("not-applicable");
    expect(getCapability(capabilities, "asset-pool").applicability).toBe("not-applicable");
  });
});

describe("statutory and usage-based billing derivation", () => {
  it("derives obligation-driven invoicing for statutory fees and levies", () => {
    expect(deriveBillingPatternProfile(townAxes)).toMatchObject({
      primaryPaymentPattern: "ad-hoc-invoice",
      supportedPaymentPatterns: ["ad-hoc-invoice", "recurring-agreement"],
      invoiceExecutionMode: "prepared-not-prescribed",
      recurringBillingApplicability: "optional",
    });
  });

  it("keeps usage-based billing for utility axes", () => {
    expect(deriveBillingPatternProfile(utilityAxes)).toMatchObject({
      primaryPaymentPattern: "usage-based",
      recurringBillingApplicability: "recommended",
    });
  });
});

describe("partner-program capability derivation", () => {
  it("requires the partner program when selling through channel partners", () => {
    const capabilities = deriveCapabilityApplicability(channelPartnerAxes, mspPortfolios);
    expect(getCapability(capabilities, "partner-program")).toMatchObject({
      applicability: "required",
      ownershipScopes: ["partner-account"],
      isolation: "strict-partner-scope",
    });
  });

  it("recommends the partner program for platform/MSP/wholesale models", () => {
    expect(getCapability(deriveCapabilityApplicability(platformAxes, mspPortfolios), "partner-program").applicability).toBe("recommended");
    expect(getCapability(deriveCapabilityApplicability(mspAxes, mspPortfolios), "partner-program").applicability).toBe("recommended");
    expect(getCapability(deriveCapabilityApplicability(wholesaleAxes, salonPortfolios), "partner-program").applicability).toBe("recommended");
  });

  it("leaves the partner program not-applicable for direct-to-consumer archetypes", () => {
    expect(getCapability(deriveCapabilityApplicability(salonAxes, salonPortfolios), "partner-program").applicability).toBe("not-applicable");
  });
});
