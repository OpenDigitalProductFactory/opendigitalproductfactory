import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";
import { describe, expect, it } from "vitest";
import type { ActivityContract } from "../activity-contract";
import type { DataPolicyDecision } from "@/lib/govern/data/policy-decision";
import { compileAiProviderSuitabilityPolicy } from "./compile";
import { resolveProviderTrustFacts } from "./provider-trust";
import {
  bindProviderSuitabilityWorkContext,
  deriveProviderSuitabilityWorkContext,
} from "./work-context";
import type { BusinessSuitabilityProfile, ProviderTrustFacts } from "./types";

function activity(overrides: Partial<ActivityContract> = {}): ActivityContract {
  return {
    activityId: "activity-1",
    parentRef: {},
    activityClass: "summarize",
    title: "Summarize work",
    distributionShape: "center",
    riskClass: "low",
    successShape: "text",
    contextPolicy: "retrieval",
    tokenEnvelope: { maxInputTokens: 8_000, maxOutputTokens: 1_000, compression: "summarize" },
    evaluationPolicy: { evaluator: "human-acceptance", minimumSignal: "accepted" },
    requestContractHints: {},
    ...overrides,
  };
}

const BUSINESS: BusinessSuitabilityProfile = {
  organizationId: "org-dental",
  archetypeId: "dental-practice",
  archetypeCategory: "healthcare-wellness",
  operatesIn: ["us"],
  sellsTo: ["us"],
  employsIn: ["us"],
  dataResidency: [],
  riskPosture: "balanced",
};

const ALLOW_DECISION: DataPolicyDecision = {
  decisionId: "dpd-allow",
  organizationId: "org-dental",
  inputHash: "hash",
  effect: "allow",
  obligations: [],
  matchedPolicyVersions: [],
  assetVersion: "1",
  classificationVersion: "1",
  authorityVersion: "1",
  explanationCode: "allowed",
  replay: "single-use",
};

function regularCloud(): ProviderTrustFacts {
  return resolveProviderTrustFacts({
    catalog: {
      providerId: "cloud",
      catalogProviderId: "cloud",
      category: "direct",
      jurisdictions: ["us"],
      externalEgress: "provider-cloud",
      supportsZdr: false,
      supportsNoTraining: false,
      supportsRegionalRouting: false,
      supportedRegions: [],
      regionalEndpoints: [],
    },
    connection: {
      providerConnectionId: "conn-cloud",
      providerId: "cloud",
      executionChannel: "direct-api",
      accountClass: "regular",
      commercialBasis: "usage-metered",
      authMethod: "api-key",
      contractEvidence: {},
      entitlements: {},
      evidenceStatus: "operator-attested",
      lastReviewedAt: "2026-07-20T00:00:00.000Z",
    },
  });
}

function compileFor(workloadProfiles: ReturnType<typeof deriveProviderSuitabilityWorkContext>["workloadProfiles"]) {
  return compileAiProviderSuitabilityPolicy({
    businessProfile: BUSINESS,
    workloadProfiles,
    dataPolicyDecisions: [ALLOW_DECISION],
    regulationResults: [],
    providerFacts: [regularCloud()],
    source: "admin",
  });
}

describe("deriveProviderSuitabilityWorkContext", () => {
  it("allows public marketing but classifies dental delivery as PHI in the same organization", () => {
    const publicWork = deriveProviderSuitabilityWorkContext({
      archetypeId: "dental-practice",
      archetypeCategory: "healthcare-wellness",
      valueStreamStage: "attract",
      activity: activity(),
    });
    const clinicalWork = deriveProviderSuitabilityWorkContext({
      archetypeId: "dental-practice",
      archetypeCategory: "healthcare-wellness",
      valueStreamStage: "deliver",
      activity: activity({ riskClass: "high" }),
    });

    expect(publicWork.workloadClasses).toEqual(["public-marketing"]);
    expect(publicWork.workloadProfiles[0]).toMatchObject({ sensitivity: "public" });
    expect(clinicalWork.workloadClasses).toEqual(["health-phi"]);
    expect(clinicalWork.workloadProfiles[0]).toMatchObject({
      sensitivity: "restricted",
      residencyClass: "region-bound",
    });
    expect(compileFor(publicWork.workloadProfiles).allowedProviderConnectionIds).toContain("conn-cloud");
    expect(compileFor(clinicalWork.workloadProfiles)).toMatchObject({
      effect: "deny",
      deniedProviderConnectionIds: ["conn-cloud"],
    });
  });

  it.each([
    ["banking-financial-services", "credit-union", "payments-finance"],
    ["education-training", "training-provider", "student-records"],
    ["public-sector", "small-town-municipality", "public-sector-records"],
  ] as const)("applies bounded %s defaults", (archetypeCategory, archetypeId, expected) => {
    const context = deriveProviderSuitabilityWorkContext({
      archetypeId,
      archetypeCategory,
      valueStreamStage: "deliver",
      activity: activity({ riskClass: "high" }),
    });
    expect(context.workloadClasses).toEqual([expected]);
  });

  it("uses explicit activity workload hints and governed references ahead of category defaults", () => {
    const context = deriveProviderSuitabilityWorkContext({
      archetypeId: "software-platform",
      archetypeCategory: "software-platform",
      valueStreamStage: "operate-improve",
      activity: activity({
        activityClass: "tool-act",
        workloadClassHints: ["secrets-credentials"],
        governedData: {
          assetIds: ["data:credential-secret"],
          fieldIds: ["data:credential-secret#token"],
          processingPurpose: "platform-operations",
          processingActivityId: "DPA-1",
          applicableRegulationIds: ["REG-2", "REG-1"],
        },
      }),
    });

    expect(context.workloadProfiles[0]).toMatchObject({
      workloadClass: "secrets-credentials",
      assetIds: ["data:credential-secret"],
      fieldIds: ["data:credential-secret#token"],
      purpose: "platform-operations",
      processingActivityId: "DPA-1",
      applicableRegulationIds: ["REG-1", "REG-2"],
    });
    expect(bindProviderSuitabilityWorkContext({
      businessProfile: { ...BUSINESS, archetypeId: "software-platform", archetypeCategory: "software-platform" },
      dataPolicyDecisions: [ALLOW_DECISION],
      regulationResults: [],
      providerFacts: [regularCloud()],
      source: "admin",
    }, context)).toMatchObject({
      activityClass: "tool-act",
      workloadProfiles: [{ workloadClass: "secrets-credentials" }],
    });
  });

  it("refuses an archetype mismatch instead of silently widening policy", () => {
    const context = deriveProviderSuitabilityWorkContext({
      archetypeId: "dental-practice",
      archetypeCategory: "healthcare-wellness",
      valueStreamStage: "deliver",
      activity: activity(),
    });
    expect(() => bindProviderSuitabilityWorkContext({
      businessProfile: { ...BUSINESS, archetypeId: "credit-union", archetypeCategory: "banking-financial-services" },
      dataPolicyDecisions: [ALLOW_DECISION],
      regulationResults: [],
      providerFacts: [regularCloud()],
      source: "admin",
    }, context)).toThrow(/canonical business archetype/i);
  });

  it("fails high-risk referenced work to unknown when no governed profile or workload hint exists", () => {
    const context = deriveProviderSuitabilityWorkContext({
      archetypeId: null,
      archetypeCategory: null,
      valueStreamStage: null,
      activity: activity({
        riskClass: "high",
        governedData: { assetIds: ["data:unknown-work"] },
      }),
    });
    expect(context.workloadProfiles[0]).toMatchObject({
      workloadClass: "internal-operations",
      classificationKnown: false,
    });
    expect(context.explanationCodes).toContain("governed-classification-required");
  });

  it("uses occupation only to focus recommendations and never widen enforced workload context", () => {
    const base = {
      archetypeId: "dental-practice",
      archetypeCategory: "healthcare-wellness",
      valueStreamStage: "deliver" as const,
      activity: activity({ riskClass: "high" }),
    };
    const hygienist = deriveProviderSuitabilityWorkContext({
      ...base,
      occupation: {
        occupationKey: "dental-hygienist",
        archetypeCategories: ["healthcare-wellness"],
        archetypeIds: ["dental-practice"],
      },
    });
    const marketer = deriveProviderSuitabilityWorkContext({
      ...base,
      occupation: {
        occupationKey: "marketing-manager",
        archetypeCategories: ["professional-services"],
        archetypeIds: [],
      },
    });

    expect(hygienist.workloadProfiles).toEqual(marketer.workloadProfiles);
    expect(hygienist.recommendationFocus.occupationKey).toBe("dental-hygienist");
    expect(marketer.recommendationFocus.occupationKey).toBe("marketing-manager");
  });

  it("structurally derives a bounded context for every canonical archetype and stage", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const stream = deriveOperationalValueStream(archetype);
      for (const stage of stream.stages) {
        const context = deriveProviderSuitabilityWorkContext({
          archetypeId: archetype.archetypeId,
          archetypeCategory: archetype.category,
          valueStreamStage: stage.key,
          activity: activity(),
        });
        expect(context.workloadProfiles.length, `${archetype.archetypeId}/${stage.key}`).toBeGreaterThan(0);
        expect(context.workloadClasses, `${archetype.archetypeId}/${stage.key}`).toEqual(
          [...new Set(context.workloadClasses)].sort(),
        );
      }
    }
  });
});
