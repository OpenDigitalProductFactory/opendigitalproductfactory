import { describe, expect, it } from "vitest";

import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "@/lib/routing/model-card-types";
import type { EndpointManifest } from "@/lib/routing/types";
import {
  projectCoworkerRouteReadiness,
  type CoworkerRoutingReadinessSnapshot,
} from "./route-readiness";

function endpoint(
  overrides: Partial<EndpointManifest> = {},
): EndpointManifest {
  return {
    id: "ep-ready",
    providerId: "openai",
    modelId: "gpt-ready",
    name: "Ready model",
    endpointType: "chat",
    status: "active",
    providerTier: "user_configured",
    sensitivityClearance: ["public", "internal"],
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 75,
    codegen: 75,
    toolFidelity: 75,
    instructionFollowing: 75,
    structuredOutput: 75,
    conversational: 75,
    contextRetention: 75,
    customScores: {},
    avgLatencyMs: 1000,
    recentFailureRate: 0,
    costPerOutputMToken: 10,
    profileSource: "evaluated",
    profileConfidence: "high",
    retiredAt: null,
    modelClass: "chat",
    modelFamily: null,
    inputModalities: ["text"],
    outputModalities: ["text", "tool_call"],
    capabilities: {
      ...EMPTY_CAPABILITIES,
      toolUse: true,
      streaming: true,
    },
    pricing: {
      ...EMPTY_PRICING,
      inputPerMToken: 3,
      outputPerMToken: 15,
    },
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "catalog",
    metadataConfidence: "high",
    perRequestLimits: null,
    ...overrides,
  };
}

function snapshot(
  endpoints: EndpointManifest[],
): CoworkerRoutingReadinessSnapshot {
  return {
    endpoints,
    policyRules: [],
    overrides: [],
    capacityByProvider: new Map(),
    localOnlyInference: false,
    taskRequirement: null,
  };
}

const config = {
  agentId: "marketing-specialist",
  sensitivity: "internal",
  minimumTier: "adequate",
  pinnedProviderId: null,
  pinnedModelId: null,
  budgetClass: "balanced",
  minimumCapabilities: null,
  minimumContextTokens: null,
};

describe("projectCoworkerRouteReadiness", () => {
  it("accepts an endpoint that the canonical conversation route can use", async () => {
    await expect(
      projectCoworkerRouteReadiness(config, snapshot([endpoint()])),
    ).resolves.toMatchObject({
      ready: true,
      providerId: "openai",
      modelId: "gpt-ready",
    });
  });

  it("rejects models without the coworker's sensitivity, capability, or context floor", async () => {
    const blocked = await projectCoworkerRouteReadiness(
      {
        ...config,
        sensitivity: "confidential",
        minimumCapabilities: { toolUse: true, webSearch: true },
        minimumContextTokens: 16000,
      },
      snapshot([
        endpoint({
          sensitivityClearance: ["public", "internal"],
          maxContextTokens: 8000,
          capabilities: {
            ...EMPTY_CAPABILITIES,
            toolUse: true,
            streaming: true,
            webSearch: false,
          },
        }),
      ]),
    );

    expect(blocked.ready).toBe(false);
    expect(blocked.reason).toContain("routing requirements");
  });

  it.each([
    {
      name: "capability",
      config: {
        minimumCapabilities: { toolUse: true, webSearch: true },
      },
      endpoint: {
        capabilities: {
          ...EMPTY_CAPABILITIES,
          toolUse: true,
          streaming: true,
          webSearch: false,
        },
      },
    },
    {
      name: "context",
      config: { minimumContextTokens: 200000 },
      endpoint: {},
    },
  ])("fails closed when the $name floor alone is missing", async (testCase) => {
    await expect(
      projectCoworkerRouteReadiness(
        { ...config, ...testCase.config },
        snapshot([endpoint(testCase.endpoint)]),
      ),
    ).resolves.toMatchObject({ ready: false });
  });

  it("honors the platform local-only boundary", async () => {
    await expect(
      projectCoworkerRouteReadiness(config, {
        ...snapshot([endpoint()]),
        localOnlyInference: true,
      }),
    ).resolves.toMatchObject({ ready: false });
  });

  it("treats configured provider and model pins as preferences with eligible fallback", async () => {
    const endpoints = [
      endpoint({
        id: "ep-basic",
        providerId: "local",
        modelId: "basic",
        reasoning: 40,
        codegen: 40,
        toolFidelity: 40,
      }),
      endpoint({
        id: "ep-strong",
        providerId: "openai",
        modelId: "strong",
      }),
    ];

    await expect(
      projectCoworkerRouteReadiness(
        {
          ...config,
          minimumTier: "strong",
          pinnedProviderId: "local",
          pinnedModelId: "basic",
        },
        snapshot(endpoints),
      ),
    ).resolves.toMatchObject({
      ready: true,
      providerId: "openai",
      modelId: "strong",
    });
  });

  it("applies the effective Golden Triangle posture used by live dispatch", async () => {
    const assured = {
      routeContext: {
        budgetClass: "quality_first" as const,
        reasoningDepth: "high" as const,
        minimumTier: "frontier" as const,
      },
      effort: "high" as const,
      preset: "assured" as const,
      source: "agent" as const,
    };

    await expect(
      projectCoworkerRouteReadiness(config, {
        ...snapshot([endpoint()]),
        postureByAgent: new Map([[config.agentId, assured]]),
      }),
    ).resolves.toMatchObject({ ready: false });

    await expect(
      projectCoworkerRouteReadiness(config, {
        ...snapshot([
          endpoint({
            reasoning: 95,
            codegen: 95,
            toolFidelity: 95,
            instructionFollowing: 95,
            structuredOutput: 95,
            conversational: 95,
            contextRetention: 95,
          }),
        ]),
        postureByAgent: new Map([[config.agentId, assured]]),
      }),
    ).resolves.toMatchObject({ ready: true });
  });

  it("applies the DB-backed conversation requirement used by live dispatch", async () => {
    await expect(
      projectCoworkerRouteReadiness(config, {
        ...snapshot([endpoint()]),
        taskRequirement: {
          taskType: "conversation",
          description: "Configured conversation floor.",
          selectionRationale: "Operator policy.",
          requiredCapabilities: {},
          preferredMinScores: {},
          minimumTier: "frontier",
          preferCheap: false,
          origin: "user",
        },
      }),
    ).resolves.toMatchObject({ ready: false });
  });

  it("fails closed when the selected sole provider has a known repair state", async () => {
    await expect(
      projectCoworkerRouteReadiness(config, {
        ...snapshot([endpoint()]),
        capacityByProvider: new Map([
          ["openai", { state: "reauth_required" }],
        ]),
      }),
    ).resolves.toMatchObject({
      ready: false,
      reason: expect.stringContaining("needs attention"),
    });
  });

  it("keeps the record reachable when routing metadata could not load", async () => {
    await expect(
      projectCoworkerRouteReadiness(config, {
        ...snapshot([]),
        loadError:
          "Routing readiness could not be confirmed. Review AI readiness.",
      }),
    ).resolves.toEqual({
      ready: false,
      reason: "Routing readiness could not be confirmed. Review AI readiness.",
    });
  });
});
