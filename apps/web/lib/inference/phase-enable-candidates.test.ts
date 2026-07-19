// Unit tests for the pure enable-candidate selection (BI-1A75E068, F10/F11).
// The selection reuses the live routing hard-filter (getExclusionReasonV2), so a
// candidate qualifies iff real routing would admit it once its provider is on.

import { describe, expect, it } from "vitest";
import type { EndpointManifest } from "@/lib/routing/types";
import type { RequestContract } from "@/lib/routing/request-contract";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "@/lib/routing/model-card-types";
import {
  selectEnableCandidatesForContract,
  type EnableCandidateProvider,
} from "./phase-enable-candidates";

function makeManifest(overrides: Partial<EndpointManifest> = {}): EndpointManifest {
  return {
    id: "ep-default",
    providerId: "test",
    modelId: "test-model",
    name: "Default Endpoint",
    endpointType: "chat",
    // NOTE: candidates are always fed status "active" (the loader forces it) so
    // the hard filter reflects the enabled state.
    status: "active",
    providerTier: "user_configured",
    sensitivityClearance: ["public", "internal", "confidential"],
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 70,
    codegen: 70,
    toolFidelity: 70,
    instructionFollowing: 70,
    structuredOutput: 70,
    conversational: 70,
    contextRetention: 70,
    customScores: {},
    avgLatencyMs: 1000,
    recentFailureRate: 0,
    costPerOutputMToken: 10.0,
    profileSource: "seed",
    profileConfidence: "medium",
    retiredAt: null,
    modelClass: "chat",
    modelFamily: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
    pricing: { ...EMPTY_PRICING, inputPerMToken: 3.0, outputPerMToken: 15.0 },
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "inferred",
    metadataConfidence: "low",
    perRequestLimits: null,
    ...overrides,
  };
}

function makeContract(overrides: Partial<RequestContract> = {}): RequestContract {
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
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    reasoningDepth: "medium",
    budgetClass: "balanced",
    ...overrides,
  };
}

function makeProvider(
  overrides: Partial<EnableCandidateProvider> = {},
  manifestOverrides: Partial<EndpointManifest> = {},
): EnableCandidateProvider {
  const providerId = overrides.providerId ?? "prov";
  return {
    providerId,
    displayName: overrides.displayName ?? providerId,
    status: "inactive",
    authMethod: "none",
    hasCredential: false,
    credentialExpired: false,
    manifests: [makeManifest({ providerId, ...manifestOverrides })],
    ...overrides,
  };
}

describe("selectEnableCandidatesForContract", () => {
  it("returns a disabled, credential-ready provider as a one-click enable candidate", () => {
    const contract = makeContract({ requiresTools: true, sensitivity: "internal" });
    const provider = makeProvider({
      providerId: "anthropic",
      displayName: "Anthropic",
      status: "inactive",
      authMethod: "oauth",
      hasCredential: true,
    });

    const out = selectEnableCandidatesForContract(contract, [provider]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      providerId: "anthropic",
      action: "enable",
      oneClick: true,
    });
    expect(out[0]!.satisfies).toContain("tool use");
  });

  it("excludes a provider whose model cannot satisfy the phase's tool requirement", () => {
    const contract = makeContract({ requiresTools: true });
    const noTools = makeProvider(
      { providerId: "embed-only" },
      { supportsToolUse: false, capabilities: { ...EMPTY_CAPABILITIES, toolUse: false } },
    );

    const out = selectEnableCandidatesForContract(contract, [noTools]);

    expect(out).toHaveLength(0);
  });

  it("excludes a provider whose context window is below the phase floor", () => {
    const contract = makeContract({ minContextTokens: 200000 });
    const small = makeProvider({ providerId: "small-ctx" }, { maxContextTokens: 32000 });

    expect(selectEnableCandidatesForContract(contract, [small])).toHaveLength(0);
  });

  it("excludes a provider lacking clearance for the phase's sensitivity", () => {
    const contract = makeContract({ sensitivity: "restricted" });
    const cloud = makeProvider(
      { providerId: "cloud" },
      { sensitivityClearance: ["public", "internal", "confidential"] },
    );

    expect(selectEnableCandidatesForContract(contract, [cloud])).toHaveLength(0);
  });

  it("uses the live router allowlist when projecting enable candidates", () => {
    const contract = makeContract({ allowedProviders: ["anthropic"] });
    const anthropic = makeProvider({ providerId: "anthropic" });
    const openai = makeProvider({ providerId: "openai" });

    expect(selectEnableCandidatesForContract(contract, [openai, anthropic]))
      .toEqual([expect.objectContaining({ providerId: "anthropic" })]);
  });

  it("uses the live router denylist when projecting enable candidates", () => {
    const contract = makeContract({ deniedProviders: ["openai"] });
    const openai = makeProvider({ providerId: "openai" });

    expect(selectEnableCandidatesForContract(contract, [openai])).toHaveLength(0);
  });

  it("flags a disabled provider that still needs credentials instead of a one-click enable", () => {
    const contract = makeContract();
    const provider = makeProvider({
      providerId: "openai",
      displayName: "OpenAI",
      status: "inactive",
      authMethod: "api_key",
      hasCredential: false,
    });

    const [candidate] = selectEnableCandidatesForContract(contract, [provider]);

    expect(candidate).toMatchObject({ action: "connect_credentials", oneClick: false });
    expect(candidate!.note).toMatch(/credentials/i);
  });

  it("treats an expired-credential provider as needing reconnection", () => {
    const contract = makeContract();
    const provider = makeProvider({
      providerId: "claude-sub",
      status: "inactive",
      authMethod: "oauth",
      hasCredential: true,
      credentialExpired: true,
    });

    const [candidate] = selectEnableCandidatesForContract(contract, [provider]);

    expect(candidate).toMatchObject({ action: "connect_credentials", oneClick: false });
    expect(candidate!.note).toMatch(/expired|reconnect/i);
  });

  it("marks a never-configured provider as needing setup", () => {
    const contract = makeContract();
    const provider = makeProvider({
      providerId: "grok",
      status: "unconfigured",
      authMethod: "api_key",
      hasCredential: false,
    });

    const [candidate] = selectEnableCandidatesForContract(contract, [provider]);

    expect(candidate).toMatchObject({ action: "set_up", oneClick: false });
  });

  it("orders one-click enable candidates ahead of credential/setup ones", () => {
    const contract = makeContract({ requiresTools: true });
    const needsCreds = makeProvider({
      providerId: "needs",
      displayName: "Needs Creds",
      status: "inactive",
      authMethod: "api_key",
      hasCredential: false,
    });
    const ready = makeProvider({
      providerId: "ready",
      displayName: "Ready",
      status: "inactive",
      authMethod: "none",
      hasCredential: false,
    });

    const out = selectEnableCandidatesForContract(contract, [needsCreds, ready]);

    expect(out.map((c) => c.providerId)).toEqual(["ready", "needs"]);
    expect(out[0]!.oneClick).toBe(true);
  });

  it("qualifies a provider when ANY of its models satisfies the contract", () => {
    const contract = makeContract({ requiresTools: true });
    const provider = makeProvider({ providerId: "mixed" });
    provider.manifests = [
      makeManifest({ providerId: "mixed", modelId: "embed", supportsToolUse: false, capabilities: { ...EMPTY_CAPABILITIES, toolUse: false } }),
      makeManifest({ providerId: "mixed", modelId: "coder", supportsToolUse: true }),
    ];

    expect(selectEnableCandidatesForContract(contract, [provider])).toHaveLength(1);
  });

  it("returns nothing when there are no off providers", () => {
    expect(selectEnableCandidatesForContract(makeContract(), [])).toEqual([]);
  });
});
