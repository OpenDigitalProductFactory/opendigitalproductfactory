import { describe, it, expect } from "vitest";
import { getExclusionReasonV2 } from "./pipeline-v2";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";

function activeEp(overrides: Partial<EndpointManifest> = {}): EndpointManifest {
  return {
    id: "test-ep",
    providerId: "codex",
    modelId: "gpt-5.3-codex",
    name: "GPT-5.3",
    endpointType: "chat",
    status: "active",
    providerTier: "user_configured",
    sensitivityClearance: ["public", "internal", "confidential", "restricted"],
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 400000,
    maxOutputTokens: 16000,
    modelRestrictions: [],
    reasoning: 90,
    codegen: 88,
    toolFidelity: 92,
    instructionFollowing: 90,
    structuredOutput: 88,
    conversational: 85,
    contextRetention: 78,
    customScores: {},
    avgLatencyMs: 1200,
    recentFailureRate: 0,
    costPerOutputMToken: 15,
    profileSource: "seed",
    profileConfidence: "high",
    retiredAt: null,
    qualityTier: "frontier",
    modelClass: "chat",
    modelFamily: "gpt",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: { toolUse: true, structuredOutput: true, streaming: true } as never,
    pricing: {} as never,
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "catalog",
    metadataConfidence: "high",
    perRequestLimits: null,
    ...overrides,
  };
}

function contract(overrides: Partial<RequestContract> = {}): RequestContract {
  return {
    contractId: "test",
    contractFamily: "sync.conversation",
    taskType: "conversation",
    modality: { input: ["text"], output: ["text"] },
    interactionMode: "sync",
    sensitivity: "internal",
    requiresTools: false,
    requiresStrictSchema: false,
    requiresStreaming: false,
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    reasoningDepth: "low",
    budgetClass: "balanced",
    ...overrides,
  };
}

describe("getExclusionReasonV2 — capability floor (EP-AGENT-CAP-002)", () => {
  it("passes when no minimumCapabilities set (null/undefined)", () => {
    const ep = activeEp({ supportsToolUse: false });
    const c = contract(); // no minimumCapabilities
    expect(getExclusionReasonV2(ep, c)).toBeNull();
  });

  it("passes empty minimumCapabilities {} (passive agent)", () => {
    const ep = activeEp({ supportsToolUse: false });
    const c = contract({ minimumCapabilities: {} });
    expect(getExclusionReasonV2(ep, c)).toBeNull();
  });

  it("excludes endpoint when agent requires toolUse and endpoint has supportsToolUse: false", () => {
    const ep = activeEp({ supportsToolUse: false });
    const c = contract({ minimumCapabilities: { toolUse: true } });
    const reason = getExclusionReasonV2(ep, c);
    expect(reason).toContain("toolUse");
    expect(reason).toContain("EP-AGENT-CAP-002");
  });

  it("passes endpoint when agent requires toolUse and endpoint has supportsToolUse: true", () => {
    const ep = activeEp({ supportsToolUse: true });
    const c = contract({ minimumCapabilities: { toolUse: true } });
    expect(getExclusionReasonV2(ep, c)).toBeNull();
  });

  it("excludes inactive endpoint even if capability floor would pass", () => {
    const ep = activeEp({ supportsToolUse: true, status: "disabled" });
    const c = contract({ minimumCapabilities: { toolUse: true } });
    const reason = getExclusionReasonV2(ep, c);
    expect(reason).not.toBeNull();
  });

  it("excludes endpoint missing imageInput when agent requires it", () => {
    const ep = activeEp({ capabilities: {} as never });
    const c = contract({ minimumCapabilities: { imageInput: true } });
    const reason = getExclusionReasonV2(ep, c);
    expect(reason).toContain("imageInput");
  });
});
