import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { getExclusionReasonV2, routeEndpointV2 } from "./pipeline-v2";
import type { RequestContract } from "./request-contract";
import type { EndpointManifest } from "./types";

vi.mock("./champion-challenger", () => ({
  selectRecipeWithExploration: vi.fn().mockResolvedValue({
    recipe: null,
    explorationMode: "champion",
  }),
}));

function endpoint(overrides: Partial<EndpointManifest> = {}): EndpointManifest {
  return {
    id: "codex:gpt-5.4",
    providerId: "codex",
    modelId: "gpt-5.4",
    name: "Codex model",
    endpointType: "responses",
    status: "active",
    providerTier: "user_configured",
    sensitivityClearance: ["public", "internal"],
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 400_000,
    maxOutputTokens: 128_000,
    modelRestrictions: [],
    reasoning: 90,
    codegen: 90,
    toolFidelity: 90,
    instructionFollowing: 90,
    structuredOutput: 90,
    conversational: 90,
    contextRetention: 90,
    customScores: {},
    avgLatencyMs: 1_000,
    recentFailureRate: 0,
    costPerOutputMToken: 14,
    profileSource: "seed",
    profileConfidence: "medium",
    retiredAt: null,
    modelClass: "code",
    modelFamily: "gpt-5",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true },
    pricing: { ...EMPTY_PRICING, outputPerMToken: 14 },
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "catalog",
    metadataConfidence: "high",
    perRequestLimits: null,
    ...overrides,
  };
}

function contract(): RequestContract {
  return {
    contractId: "codex-subscription-eligibility",
    contractFamily: "build.code",
    taskType: "reasoning",
    modality: { input: ["text"], output: ["text"] },
    interactionMode: "background",
    sensitivity: "internal",
    requiresTools: false,
    requiresStrictSchema: false,
    requiresStreaming: false,
    estimatedInputTokens: 1_000,
    estimatedOutputTokens: 500,
    reasoningDepth: "medium",
    budgetClass: "quality_first",
  };
}

beforeEach(async () => {
  const { _resetAllTracking } = await import("./rate-tracker");
  _resetAllTracking();
});

describe("Codex subscription model routing", () => {
  const reason =
    "Model 'gpt-5.3-codex' is not supported when Codex uses a ChatGPT account";

  it("surfaces a loader-owned account incompatibility before ranking", () => {
    expect(getExclusionReasonV2(endpoint({
      modelId: "gpt-5.3-codex",
      eligibilityExclusionReason: reason,
    }), contract())).toBe(reason);
  });

  it("selects a supported Codex sibling without detouring to a bundled endpoint", async () => {
    const unsupported = endpoint({
      id: "codex:gpt-5.3-codex",
      modelId: "gpt-5.3-codex",
      eligibilityExclusionReason: reason,
    });
    const supported = endpoint();
    const bundled = endpoint({
      id: "ollama:qwen",
      providerId: "ollama",
      modelId: "qwen",
      providerTier: "bundled",
    });

    const decision = await routeEndpointV2(
      [unsupported, supported, bundled],
      contract(),
      [],
      [],
    );

    expect(decision.selectedEndpoint).toBe("codex:gpt-5.4");
    expect(decision.candidates.find((candidate) => candidate.endpointId === unsupported.id))
      .toMatchObject({ excluded: true, excludedReason: reason });
  });
});
