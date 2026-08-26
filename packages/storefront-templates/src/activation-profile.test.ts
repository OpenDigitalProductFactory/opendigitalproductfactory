import { describe, expect, it } from "vitest";

import {
  activationHasCapability,
  getCapabilityApplicability,
  readActivationProfile,
} from "./activation-profile";
import { ALL_ARCHETYPES } from "./archetypes";

describe("readActivationProfile", () => {
  it("defaults legacy records to an inert process profile", () => {
    const profile = readActivationProfile({
      profileType: "standard",
      modules: [],
      billingReadinessMode: "none",
      customerGraph: "none",
      estateSeparation: "shared",
    });

    expect(profile?.processProfile).toEqual({
      catalogModes: [],
      subjectTypes: [],
      housesSubjects: false,
      schedulesSubjects: false,
      resourceKinds: [],
      valueStreams: [],
      supportingCapabilities: [],
    });
  });

  it("strictly normalizes typed process semantics", () => {
    const profile = readActivationProfile({
      profileType: "standard",
      modules: [],
      billingReadinessMode: "none",
      customerGraph: "none",
      estateSeparation: "shared",
      processProfile: {
        catalogModes: ["priced", "donation"],
        subjectTypes: ["patient-profile", "animal"],
        housesSubjects: true,
        schedulesSubjects: true,
        resourceKinds: [
          { kindSlug: "table", capacityUnit: "seats", maxCapacity: 100 },
        ],
        valueStreams: [
          {
            key: "intake-safe-placement",
            label: "Intake and safe placement",
            purpose: "Move an animal from a report or surrender into safe accommodation.",
            input: "Stray report, surrender request, or partner handoff",
            output: "Triaged animal in a safe kennel or foster placement",
            responsibleRole: "Intake coordinator",
            loadBearingStageKeys: ["intake-report-handoff"],
            stages: [
              {
                key: "intake-report-handoff",
                label: "Report or handoff",
                input: "Stray report, surrender request, or partner handoff",
                output: "Accepted intake case",
                responsibleRole: "Intake coordinator",
                trustGateKeys: ["intake-authority"],
              },
            ],
          },
        ],
        supportingCapabilities: ["fundraising", "volunteer-coordination"],
      },
    });

    expect(profile?.processProfile).toEqual({
      catalogModes: ["priced", "donation"],
      subjectTypes: ["patient-profile", "animal"],
      housesSubjects: true,
      schedulesSubjects: true,
      resourceKinds: [
        { kindSlug: "table", capacityUnit: "seats", maxCapacity: 100 },
      ],
      valueStreams: [
        {
          key: "intake-safe-placement",
          label: "Intake and safe placement",
          purpose: "Move an animal from a report or surrender into safe accommodation.",
          input: "Stray report, surrender request, or partner handoff",
          output: "Triaged animal in a safe kennel or foster placement",
          responsibleRole: "Intake coordinator",
          loadBearingStageKeys: ["intake-report-handoff"],
          stages: [
            {
              key: "intake-report-handoff",
              label: "Report or handoff",
              input: "Stray report, surrender request, or partner handoff",
              output: "Accepted intake case",
              responsibleRole: "Intake coordinator",
              trustGateKeys: ["intake-authority"],
            },
          ],
        },
      ],
      supportingCapabilities: ["fundraising", "volunteer-coordination"],
    });
  });

  it("rejects duplicate stage keys across leaf value streams", () => {
    expect(
      readActivationProfile({
        profileType: "standard",
        modules: [],
        billingReadinessMode: "none",
        customerGraph: "none",
        estateSeparation: "shared",
        processProfile: {
          catalogModes: ["unpriced"],
          subjectTypes: ["animal"],
          housesSubjects: true,
          schedulesSubjects: true,
          resourceKinds: [],
          supportingCapabilities: [],
          valueStreams: [
            {
              key: "intake",
              label: "Intake",
              purpose: "Accept the animal safely.",
              input: "Report",
              output: "Accepted animal",
              responsibleRole: "Intake coordinator",
              loadBearingStageKeys: ["triage"],
              stages: [
                { key: "triage", label: "Triage", input: "Animal", output: "Assessment", responsibleRole: "Intake coordinator", trustGateKeys: [] },
              ],
            },
            {
              key: "welfare",
              label: "Welfare",
              purpose: "Maintain health and welfare.",
              input: "Accepted animal",
              output: "Adoption-ready animal",
              responsibleRole: "Animal care lead",
              loadBearingStageKeys: ["triage"],
              stages: [
                { key: "triage", label: "Daily care", input: "Animal", output: "Care record", responsibleRole: "Animal care lead", trustGateKeys: [] },
              ],
            },
          ],
        },
      }),
    ).toBeNull();
  });

  it.each([
    {
      catalogModes: ["sale"],
      subjectTypes: [],
      housesSubjects: false,
      schedulesSubjects: false,
      resourceKinds: [],
    },
    {
      catalogModes: ["priced"],
      subjectTypes: ["Animal"],
      housesSubjects: false,
      schedulesSubjects: false,
      resourceKinds: [],
    },
    {
      catalogModes: ["priced"],
      subjectTypes: [],
      housesSubjects: false,
      schedulesSubjects: false,
      resourceKinds: [
        { kindSlug: "table", capacityUnit: "seats", maxCapacity: Number.POSITIVE_INFINITY },
      ],
    },
    {
      catalogModes: ["priced"],
      subjectTypes: [],
      housesSubjects: false,
      schedulesSubjects: false,
      resourceKinds: [],
      rules: { canBook: true },
    },
  ])("rejects malformed or free-form process profiles", (processProfile) => {
    expect(
      readActivationProfile({
        profileType: "standard",
        modules: [],
        billingReadinessMode: "none",
        customerGraph: "none",
        estateSeparation: "shared",
        processProfile,
      }),
    ).toBeNull();
  });

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

  it("the cooperative archetype derives the member-owned set, with member-equity required via override", () => {
    const coop = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "cooperative");
    expect(coop?.activationProfile).toBeDefined();

    const profile = readActivationProfile(coop?.activationProfile);
    expect(profile?.axes.governance).toBe("member-owned");
    expect(profile?.axes.primaryConsumer).toBe("member");
    expect(getCapabilityApplicability(profile, "member-governance")).toBe("required");
    expect(getCapabilityApplicability(profile, "membership-eligibility")).toBe("required");
    // The rules derive member-equity as recommended; the archetype override promotes it.
    expect(getCapabilityApplicability(profile, "member-equity")).toBe("required");
    expect(getCapabilityApplicability(profile, "public-body-governance")).toBe("not-applicable");
    expect(getCapabilityApplicability(profile, "records-request")).toBe("not-applicable");
  });

  it("the credit-union leaf derives member governance + eligibility, with member-equity suppressed via override (BI-D9ACE184)", () => {
    const cu = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "credit-union");
    expect(cu?.activationProfile).toBeDefined();

    const profile = readActivationProfile(cu?.activationProfile);
    expect(profile?.axes.governance).toBe("member-owned");
    expect(profile?.axes.primaryConsumer).toBe("member");
    expect(getCapabilityApplicability(profile, "member-governance")).toBe("required");
    expect(getCapabilityApplicability(profile, "membership-eligibility")).toBe("required");
    // Credit unions don't run patronage equity — the override suppresses the surface.
    expect(getCapabilityApplicability(profile, "member-equity")).toBe("not-applicable");
    expect(getCapabilityApplicability(profile, "public-body-governance")).toBe("not-applicable");
  });

  it("the community-bank leaf is investor-owned and derives no member or public-body machinery (BI-E677F250)", () => {
    const bank = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "community-bank");
    expect(bank?.activationProfile).toBeDefined();

    const profile = readActivationProfile(bank?.activationProfile);
    expect(profile?.axes.governance).toBe("investor-owned");
    for (const key of [
      "member-governance",
      "membership-eligibility",
      "member-equity",
      "public-body-governance",
      "records-request",
      "service-request-311",
    ] as const) {
      expect(getCapabilityApplicability(profile, key)).toBe("not-applicable");
    }
  });

  it("the equipment-rental and self-storage archetypes derive the rental capability set from reservation-and-return", () => {
    for (const id of ["equipment-rental", "self-storage"]) {
      const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === id);
      expect(archetype?.activationProfile, id).toBeDefined();
      const profile = readActivationProfile(archetype?.activationProfile);
      expect(profile?.axes.provisioning, id).toBe("reservation-and-return");
      expect(getCapabilityApplicability(profile, "rental-fleet"), id).toBe("required");
      expect(getCapabilityApplicability(profile, "rental-agreements"), id).toBe("required");
      expect(getCapabilityApplicability(profile, "asset-pool"), id).toBe("required");
      // Commercial rental — no member machinery.
      expect(getCapabilityApplicability(profile, "member-governance"), id).toBe("not-applicable");
    }
  });

  it("the agricultural cooperative derives BOTH the member-owned set and the rental set (the §10.1 intersection)", () => {
    const coop = ALL_ARCHETYPES.find((a) => a.archetypeId === "agricultural-cooperative");
    expect(coop?.activationProfile).toBeDefined();
    const profile = readActivationProfile(coop?.activationProfile);

    expect(profile?.axes.governance).toBe("member-owned");
    expect(profile?.axes.provisioning).toBe("reservation-and-return");
    // member-owned machinery
    expect(getCapabilityApplicability(profile, "member-governance")).toBe("required");
    expect(getCapabilityApplicability(profile, "membership-eligibility")).toBe("required");
    expect(activationHasCapability(profile, "member-equity")).toBe(true);
    // rental machinery
    expect(getCapabilityApplicability(profile, "rental-fleet")).toBe("required");
    expect(getCapabilityApplicability(profile, "asset-pool")).toBe("required");
  });

  it("the law-enforcement archetype derives public-body governance (with records requests) and no member machinery", () => {
    const police = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "law-enforcement-agency");
    expect(police?.activationProfile).toBeDefined();

    const profile = readActivationProfile(police?.activationProfile);
    expect(profile?.axes.governance).toBe("public-body");
    expect(profile?.axes.primaryConsumer).toBe("resident");
    expect(getCapabilityApplicability(profile, "public-body-governance")).toBe("required");
    // Police DO answer public records requests (unlike a co-op).
    expect(getCapabilityApplicability(profile, "records-request")).toBe("required");
    expect(getCapabilityApplicability(profile, "service-request-311")).toBe("required");
    // No member-owned machinery.
    expect(getCapabilityApplicability(profile, "member-governance")).toBe("not-applicable");
    expect(getCapabilityApplicability(profile, "member-equity")).toBe("not-applicable");
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
