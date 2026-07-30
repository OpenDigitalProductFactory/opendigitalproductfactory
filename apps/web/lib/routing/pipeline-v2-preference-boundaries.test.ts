import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { routeEndpointV2 } from "./pipeline-v2";
import { markEndpointUnavailable } from "./rate-tracker";
import type { RequestContract } from "./request-contract";
import type { EndpointManifest, EndpointOverride } from "./types";

vi.mock("./champion-challenger", () => ({
  selectRecipeWithExploration: vi.fn().mockResolvedValue({
    recipe: null,
    explorationMode: "champion",
  }),
}));

vi.mock("./production-feedback", async () => {
  const taskDimensions = await vi.importActual<
    typeof import("./task-dimension-map")
  >("./task-dimension-map");
  return taskDimensions;
});

function endpoint(
  overrides: Partial<EndpointManifest>,
): EndpointManifest {
  return {
    id: "ep-default",
    providerId: "test",
    modelId: "test-model",
    name: "Default Endpoint",
    endpointType: "chat",
    status: "active",
    providerTier: "user_configured",
    sensitivityClearance: ["public", "internal"],
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128_000,
    maxOutputTokens: 4_096,
    modelRestrictions: [],
    reasoning: 70,
    codegen: 70,
    toolFidelity: 70,
    instructionFollowing: 70,
    structuredOutput: 70,
    conversational: 70,
    contextRetention: 70,
    customScores: {},
    avgLatencyMs: 1_000,
    recentFailureRate: 0,
    costPerOutputMToken: 10,
    profileSource: "seed",
    profileConfidence: "medium",
    retiredAt: null,
    modelClass: "chat",
    modelFamily: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: {
      ...EMPTY_CAPABILITIES,
      toolUse: true,
      structuredOutput: true,
      streaming: true,
    },
    pricing: {
      ...EMPTY_PRICING,
      inputPerMToken: 3,
      outputPerMToken: 15,
    },
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "inferred",
    metadataConfidence: "low",
    perRequestLimits: null,
    ...overrides,
  };
}

function contract(
  overrides: Partial<RequestContract> = {},
): RequestContract {
  return {
    contractId: "test-contract",
    contractFamily: "sync.test",
    taskType: "reasoning",
    modality: { input: ["text"], output: ["text"] },
    interactionMode: "sync",
    sensitivity: "internal",
    requiresTools: false,
    requiresStrictSchema: false,
    requiresStreaming: false,
    estimatedInputTokens: 1_000,
    estimatedOutputTokens: 500,
    reasoningDepth: "medium",
    budgetClass: "balanced",
    ...overrides,
  };
}

const cheapModel = endpoint({
  id: "ep-cheap",
  providerId: "openai",
  modelId: "gpt-4o-mini",
  name: "GPT-4o Mini",
  reasoning: 55,
  codegen: 55,
  toolFidelity: 60,
  instructionFollowing: 65,
  structuredOutput: 60,
  conversational: 65,
  contextRetention: 60,
  costPerOutputMToken: 0.6,
  pricing: {
    ...EMPTY_PRICING,
    inputPerMToken: 0.15,
    outputPerMToken: 0.6,
  },
});

const qualityModel = endpoint({
  id: "ep-quality",
  providerId: "anthropic",
  modelId: "claude-sonnet-4-5",
  name: "Claude Sonnet",
  reasoning: 90,
  codegen: 91,
  toolFidelity: 85,
  instructionFollowing: 88,
  structuredOutput: 85,
  conversational: 88,
  contextRetention: 85,
  costPerOutputMToken: 15,
});

const localModel = endpoint({
  id: "ep-local",
  providerId: "ollama",
  modelId: "llama3.1",
  name: "Llama 3.1 Local",
  reasoning: 55,
  codegen: 50,
  toolFidelity: 40,
  instructionFollowing: 55,
  structuredOutput: 45,
  conversational: 55,
  contextRetention: 50,
  sensitivityClearance: [
    "public",
    "internal",
    "confidential",
    "restricted",
  ],
  costPerOutputMToken: null,
  pricing: {
    ...EMPTY_PRICING,
    inputPerMToken: 0,
    outputPerMToken: 0,
  },
});

const pinned = (endpointId: string): EndpointOverride[] => [
  {
    endpointId,
    taskType: "reasoning",
    pinned: true,
    blocked: false,
  },
];

beforeEach(async () => {
  const { _resetAllTracking } = await import("./rate-tracker");
  _resetAllTracking();
});

describe("routeEndpointV2 finalized preference boundaries", () => {
  it("does not let a persisted pin override an explicit block", async () => {
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      contract(),
      [],
      [
        ...pinned("ep-quality"),
        {
          endpointId: "ep-quality",
          taskType: "reasoning",
          pinned: false,
          blocked: true,
        },
      ],
      { capacityByProvider: new Map() },
    );

    expect(decision.selectedEndpoint).toBe("ep-cheap");
    expect(decision.preferenceResolution).toMatchObject({
      fallbackUsed: true,
      unavailable: [{ kind: "endpoint", value: "ep-quality" }],
    });
  });

  it("does not let a persisted pin override a policy exclusion", async () => {
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      contract(),
      [
        {
          id: "block-openai",
          name: "Block OpenAI",
          description: "Exclude OpenAI",
          condition: {
            field: "providerId",
            operator: "equals",
            value: "openai",
          },
        },
      ],
      pinned("ep-cheap"),
      { capacityByProvider: new Map() },
    );

    expect(decision.selectedEndpoint).toBe("ep-quality");
    expect(decision.preferenceResolution?.fallbackUsed).toBe(true);
  });

  it("does not let a persisted pin override unhealthy capacity", async () => {
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      contract(),
      [],
      pinned("ep-cheap"),
      {
        capacityByProvider: new Map([
          ["openai", { state: "reauth_required" }],
        ]),
      },
    );

    expect(decision.selectedEndpoint).toBe("ep-quality");
    expect(
      decision.candidates.find(({ endpointId }) => endpointId === "ep-cheap"),
    ).toMatchObject({
      excluded: true,
      excludedReason: "provider capacity reauth_required",
    });
  });

  it("does not let a persisted pin override a runtime cooldown", async () => {
    markEndpointUnavailable(
      "openai",
      "gpt-4o-mini",
      "rate_limit",
      30_000,
    );

    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      contract(),
      [],
      pinned("ep-cheap"),
      { capacityByProvider: new Map() },
    );

    expect(decision.selectedEndpoint).toBe("ep-quality");
    expect(
      decision.candidates.find(({ endpointId }) => endpointId === "ep-cheap"),
    ).toMatchObject({
      excluded: true,
      excludedReason: expect.stringContaining("runtime_cooldown:rate_limit"),
    });
  });

  it("builds the execution plan from the finalized preference", async () => {
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      contract({ budgetClass: "quality_first" }),
      [],
      [],
      {
        capacityByProvider: new Map(),
        preferences: { preferredProviderId: "openai" },
      },
    );

    expect(decision.selectedEndpoint).toBe("ep-cheap");
    expect(decision.executionPlan).toMatchObject({
      providerId: "openai",
      modelId: "gpt-4o-mini",
    });
  });

  it.each([
    [
      "local-only residency",
      contract({ residencyPolicy: "local_only" }),
      [cheapModel, localModel],
      "ep-local",
      "local_only",
    ],
    [
      "sensitivity clearance",
      contract({ sensitivity: "confidential" }),
      [cheapModel, localModel],
      "ep-local",
      "Sensitivity clearance",
    ],
    [
      "context-window floor",
      contract({ minContextTokens: 32_000 }),
      [endpoint({ ...cheapModel, maxContextTokens: 8_192 }), qualityModel],
      "ep-quality",
      "Context window",
    ],
    [
      "minimum quality",
      contract({ minimumDimensions: { reasoning: 80 } }),
      [cheapModel, qualityModel],
      "ep-quality",
      "Minimum quality dimensions not met",
    ],
  ] as const)(
    "does not let a persisted pin bypass %s",
    async (_name, request, endpoints, selected, reason) => {
      const decision = await routeEndpointV2(
        [...endpoints],
        request,
        [],
        pinned("ep-cheap"),
      );

      expect(decision.selectedEndpoint).toBe(selected);
      expect(
        decision.candidates.find(
          ({ endpointId }) => endpointId === "ep-cheap",
        ),
      ).toMatchObject({
        excluded: true,
        excludedReason: expect.stringContaining(reason),
      });
    },
  );

  it("does not let a persisted pin bypass a capability floor", async () => {
    const capable = endpoint({
      ...qualityModel,
      id: "ep-capable",
      capabilities: {
        ...qualityModel.capabilities,
        codeExecution: true,
      },
    });
    const decision = await routeEndpointV2(
      [cheapModel, capable],
      contract({ minimumCapabilities: { codeExecution: true } }),
      [],
      pinned("ep-cheap"),
    );

    expect(decision.selectedEndpoint).toBe("ep-capable");
    expect(
      decision.candidates.find(({ endpointId }) => endpointId === "ep-cheap"),
    ).toMatchObject({
      excluded: true,
      excludedReason: expect.stringContaining("codeExecution"),
    });
  });
});
