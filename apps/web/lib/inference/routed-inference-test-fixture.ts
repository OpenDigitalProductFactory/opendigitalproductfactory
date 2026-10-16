import type { ActivityContract } from "@/lib/routing/activity-contract";

/** Fresh activity values for routed execution tests; no shared mutable state. */
export function makeActivity(overrides: Partial<ActivityContract> = {}): ActivityContract {
  return {
    activityId: "request:REQ-1:01:summarize",
    parentRef: { taskRunId: "TASK-1" },
    activityClass: "summarize",
    title: "Distill source material",
    distributionShape: "center",
    riskClass: "low",
    successShape: "text",
    contextPolicy: "retrieval",
    tokenEnvelope: {
      maxInputTokens: 64000,
      maxOutputTokens: 2000,
      compression: "summarize",
    },
    evaluationPolicy: {
      evaluator: "human-acceptance",
      minimumSignal: "accepted",
    },
    requestContractHints: {},
    ...overrides,
  };
}

export function localAndCloudSuitabilitySource() {
  return {
    businessProfile: {
      organizationId: "org-1",
      archetypeId: "software-platform",
      archetypeCategory: "software-platform",
      operatesIn: ["us"],
      sellsTo: [],
      employsIn: [],
      dataResidency: [],
      riskPosture: "balanced",
    },
    handlesCardPayments: false,
    regulationResults: [],
    connections: [
      {
        label: "Local model",
        status: "active",
        facts: {
          providerId: "local",
          catalogProviderId: "local",
          category: "local",
          jurisdictions: ["us"],
          externalEgress: "none",
          supportsZdr: true,
          supportsNoTraining: true,
          supportsRegionalRouting: false,
          supportedRegions: [],
          regionalEndpoints: [],
          providerConnectionId: "connection-local",
          executionChannel: "local-runtime",
          accountClass: "unknown",
          commercialBasis: "local-compute",
          authMethod: "local",
          contractEvidence: {},
          entitlements: { noTraining: true },
          evidenceStatus: "operator-attested",
          lastReviewedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      {
        label: "OpenAI regular",
        status: "active",
        facts: {
          providerId: "openai",
          catalogProviderId: "openai",
          category: "direct",
          jurisdictions: ["us"],
          externalEgress: "provider-cloud",
          supportsZdr: false,
          supportsNoTraining: false,
          supportsRegionalRouting: false,
          supportedRegions: [],
          regionalEndpoints: [],
          providerConnectionId: "connection-openai-regular",
          executionChannel: "direct-api",
          accountClass: "regular",
          commercialBasis: "usage-metered",
          authMethod: "api-key",
          contractEvidence: {},
          entitlements: {},
          evidenceStatus: "operator-attested",
          lastReviewedAt: "2026-07-01T00:00:00.000Z",
        },
      },
    ],
  };
}
