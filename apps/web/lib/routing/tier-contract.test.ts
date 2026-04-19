/**
 * Tier-contract regression test — asserts that for every task type in
 * BUILT_IN_TASK_REQUIREMENTS, the V2 routing pipeline selects a model
 * whose qualityTier meets or exceeds the task's declared minimumTier,
 * satisfies all required capabilities, and clears the tier-floor
 * dimension thresholds.
 *
 * This is the executable form of the "right LLM for the right job"
 * principle (feedback_no_provider_pinning). Failures here always mean
 * one of:
 *   - A model's qualityTier is wrong / unset in seed data
 *   - A model's dimension score is wrong
 *   - A task's minimumTier or requiredCapabilities is wrong
 *   - A pricing seed row is missing (collapses ranking)
 *   - A pin re-appeared somewhere (see pin-audit in instrumentation.ts)
 *
 * Uses mocked manifests rather than the live DB so the test is
 * deterministic and runs in CI without a provisioned provider stack.
 * Live-DB equivalent: apps/web/scripts/probe-tier-contract.ts.
 */
import { describe, it, expect, vi } from "vitest";
import type { EndpointManifest } from "./types";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { routeEndpointV2 } from "./pipeline-v2";
import { inferContract } from "./request-contract";
import { BUILT_IN_TASK_REQUIREMENTS } from "./task-requirements";
import type { QualityTier } from "./quality-tiers";

// Mock champion-challenger so selectRecipeWithExploration returns null recipe.
vi.mock("./champion-challenger", () => ({
  selectRecipeWithExploration: vi.fn().mockResolvedValue({
    recipe: null,
    explorationMode: "champion",
  }),
}));

const TIER_ORDER: Record<QualityTier, number> = {
  basic: 0,
  adequate: 1,
  strong: 2,
  frontier: 3,
};

// ─── Fixture manifests — shape mirrors production ──────────────────────────
// Anthropic subscription family with real dimension scores + pricing so the
// probe behaves the same way as the live install.

function ep(overrides: Partial<EndpointManifest>): EndpointManifest {
  return {
    id: overrides.id ?? "ep-default",
    providerId: "anthropic-sub",
    modelId: "default",
    name: "default",
    endpointType: "chat",
    status: "active",
    providerTier: "user_configured",
    sensitivityClearance: ["public", "internal", "confidential", "restricted"],
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    modelRestrictions: [],
    reasoning: 75,
    codegen: 75,
    toolFidelity: 75,
    instructionFollowing: 75,
    structuredOutput: 72,
    conversational: 75,
    contextRetention: 72,
    customScores: {},
    avgLatencyMs: 1000,
    recentFailureRate: 0,
    costPerOutputMToken: 5,
    profileSource: "seed",
    profileConfidence: "high",
    retiredAt: null,
    qualityTier: "strong",
    modelClass: "chat",
    modelFamily: "claude",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: {
      ...EMPTY_CAPABILITIES,
      toolUse: true,
      structuredOutput: true,
      streaming: true,
    },
    pricing: { ...EMPTY_PRICING, inputPerMToken: 1, outputPerMToken: 5 },
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "seed",
    metadataConfidence: "high",
    perRequestLimits: null,
    ...overrides,
  };
}

const MANIFESTS: EndpointManifest[] = [
  ep({
    id: "ep-haiku",
    modelId: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    qualityTier: "strong",
    reasoning: 75, codegen: 75, toolFidelity: 75,
    costPerOutputMToken: 5,
    pricing: { ...EMPTY_PRICING, inputPerMToken: 1, outputPerMToken: 5 },
  }),
  ep({
    id: "ep-sonnet-46",
    modelId: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    qualityTier: "frontier",
    reasoning: 95, codegen: 95, toolFidelity: 95,
    costPerOutputMToken: 15,
    pricing: { ...EMPTY_PRICING, inputPerMToken: 3, outputPerMToken: 15 },
  }),
  ep({
    id: "ep-opus-47",
    modelId: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    qualityTier: "frontier",
    reasoning: 95, codegen: 92, toolFidelity: 90,
    costPerOutputMToken: 75,
    pricing: { ...EMPTY_PRICING, inputPerMToken: 15, outputPerMToken: 75 },
  }),
  ep({
    id: "ep-local",
    providerId: "local",
    providerTier: "bundled",
    modelId: "docker.io/ai/gemma4:latest",
    name: "Local Gemma 4",
    qualityTier: "adequate",
    reasoning: 62, codegen: 58, toolFidelity: 55,
    costPerOutputMToken: 0,
    pricing: { ...EMPTY_PRICING, inputPerMToken: 0, outputPerMToken: 0 },
  }),
];

describe("tier contract — each task type gets an appropriate model", () => {
  const canonicalMessage: Record<string, string> = {
    greeting: "Hello there",
    "status-query": "What's the status of order #12345?",
    summarization: "Summarize this text: The meeting covered Q4 plans.",
    "data-extraction": "Extract the name and email from: John Smith, john@acme.com",
    "web-search": "Search the web for recent news about Kubernetes.",
    creative: "Write a tagline for a sustainable clothing brand.",
    reasoning: "If A implies B and B implies C, and not-C, what about A?",
    "code-gen": "Write a TypeScript function that deduplicates an array.",
    "tool-action": "Use the get_weather tool to check today's forecast.",
  };

  for (const [taskType, req] of Object.entries(BUILT_IN_TASK_REQUIREMENTS)) {
    it(`${taskType} routes to a model satisfying minimumTier=${req.minimumTier}`, async () => {
      const contract = await inferContract(
        taskType,
        [{ role: "user", content: canonicalMessage[taskType] ?? "test" }],
      );
      const decision = await routeEndpointV2(MANIFESTS, contract, [], []);

      expect(decision.selectedEndpoint, `${taskType}: ${decision.reason}`).toBeTruthy();

      const selected = MANIFESTS.find((m) => m.id === decision.selectedEndpoint);
      expect(selected, `selected endpoint ${decision.selectedEndpoint} should be in manifests`).toBeDefined();
      if (!selected) return;

      // Tier floor
      const minTier = req.minimumTier as QualityTier | undefined;
      if (minTier) {
        const actualTier = selected.qualityTier;
        expect(
          actualTier && TIER_ORDER[actualTier] >= TIER_ORDER[minTier],
          `${taskType}: selected ${selected.providerId}/${selected.modelId} is ${actualTier ?? "(unset)"}, ` +
            `required minimumTier ${minTier}`,
        ).toBeTruthy();
      }

      // Required capabilities
      const reqCaps = req.requiredCapabilities ?? {};
      if (reqCaps.supportsToolUse) {
        expect(selected.supportsToolUse, `${taskType}: model must support toolUse`).toBe(true);
      }
      if (reqCaps.supportsStructuredOutput) {
        expect(
          selected.capabilities.structuredOutput === true,
          `${taskType}: model must support structuredOutput`,
        ).toBe(true);
      }
      if (reqCaps.supportsStreaming) {
        expect(
          selected.capabilities.streaming === true,
          `${taskType}: model must support streaming`,
        ).toBe(true);
      }

      // preferredMinScores (soft-preferred dimensions)
      const minScores = (req.preferredMinScores ?? {}) as Record<string, number>;
      for (const [dim, min] of Object.entries(minScores)) {
        const actual = (selected as unknown as Record<string, number>)[dim];
        if (typeof actual === "number") {
          expect(
            actual >= min,
            `${taskType}: dim ${dim}=${actual} below preferred floor ${min} for selected ${selected.modelId}`,
          ).toBe(true);
        }
      }
    });
  }
});
