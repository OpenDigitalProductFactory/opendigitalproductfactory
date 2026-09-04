import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadEndpointManifests,
  loadOverrides,
  loadPolicyRules,
  invalidateRoutingLoaderCache,
  persistRouteDecision,
} from "./loader";
import type { InferenceDataScreenReceipt } from "@/lib/inference/data-screening/types";
import type { RouteDecision } from "./types";
import { MODEL_ROUTING_ENDPOINT_TYPES } from "./provider-eligibility";

const { mockPrisma, mockProviderHasConfiguredCredential } = vi.hoisted(() => ({
  mockPrisma: {
    routeDecisionLog: {
      create: vi.fn().mockResolvedValue({ id: "decision-log-1" }),
    },
    modelProfile: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    policyRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    endpointTaskPerformance: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
  mockProviderHasConfiguredCredential: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/ai-provider-internals", () => ({
  providerHasConfiguredCredential: mockProviderHasConfiguredCredential,
}));

describe("persistRouteDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.routeDecisionLog.create.mockResolvedValue({ id: "decision-log-1" });
  });

  it("rejects new route decision logs without an explicit actor", async () => {
    await expect(persistRouteDecision(makeDecision())).rejects.toThrow(
      /RouteDecisionLog requires an actor/,
    );

    expect(mockPrisma.routeDecisionLog.create).not.toHaveBeenCalled();
  });

  it("persists agent attribution as both the actor and coworker id", async () => {
    const decision = makeDecision();
    decision.traceId = "0123456789abcdef0123456789abcdef";
    decision.designRevision = "2026-07-26.1";
    await persistRouteDecision(decision, { actor: { kind: "agent", id: "build-specialist" } });

    expect(mockPrisma.routeDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        traceId: "0123456789abcdef0123456789abcdef",
        designRevision: "2026-07-26.1",
        actorKind: "agent",
        actorId: "build-specialist",
        agentId: "build-specialist",
      }),
    });
  });

  it("persists explicit non-coworker actors without inventing a coworker id", async () => {
    await persistRouteDecision(makeDecision(), { actor: { kind: "system", id: "routing-evaluator" } });

    expect(mockPrisma.routeDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorKind: "system",
        actorId: "routing-evaluator",
        agentId: null,
      }),
    });
  });

  it("serializes selected activity harness metadata into the candidate trace", async () => {
    await persistRouteDecision(makeDecisionWithHarness(), { actor: { kind: "agent", id: "build-specialist" } });

    const data = mockPrisma.routeDecisionLog.create.mock.calls[0]?.[0].data;
    expect(data.candidateTrace).toEqual([
      expect.objectContaining({
        endpointId: "anthropic:claude-sonnet",
        activityHarness: {
          recipeKey: "high-risk.code-edit.frontier-coding",
          activityClass: "code-edit",
          activityConfidence: "trusted",
          promptStrategy: "repo-packet-with-verification",
          contextAssembler: "work-case-repo-packet",
          memoryPolicy: "work-case-packet",
          tokenPolicy: { inputPacking: "full-context", outputBudget: "expansive" },
          evaluator: "tool-success",
          providerFamily: "frontier",
        },
      }),
    ]);
  });

  it("persists the privacy-safe provider suitability receipt when supplied", async () => {
    const decision = makeDecision();
    decision.providerSuitabilityReceipt = makeSuitabilityReceipt();

    await persistRouteDecision(decision, { actor: { kind: "agent", id: "build-specialist" } });

    expect(mockPrisma.routeDecisionLog.create.mock.calls[0]?.[0].data.suitabilityReceipt).toEqual(
      makeSuitabilityReceipt(),
    );
  });

  it("persists the privacy-safe inference data screen receipt when supplied", async () => {
    const decision = makeDecision();
    decision.inferenceDataScreenReceipt = makeInferenceDataScreenReceipt();

    await persistRouteDecision(decision, { actor: { kind: "agent", id: "build-specialist" } });

    const persisted = mockPrisma.routeDecisionLog.create.mock.calls[0]?.[0].data.inferenceDataScreenReceipt;
    expect(persisted).toEqual(makeInferenceDataScreenReceipt());
    expect(JSON.stringify(persisted)).not.toContain("Summarize Jane's payroll.");
  });
});

describe("loadEndpointManifests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRoutingLoaderCache();
    mockPrisma.modelProfile.findMany.mockResolvedValue([]);
    mockProviderHasConfiguredCredential.mockResolvedValue(true);
  });

  it("loads all model-routing endpoint types, including responses providers", async () => {
    await loadEndpointManifests();

    expect(mockPrisma.modelProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: expect.objectContaining({
            endpointType: { in: [...MODEL_ROUTING_ENDPOINT_TYPES] },
          }),
        }),
      }),
    );
  });
});

// ── BI-OPT-ROUTING-CACHE: request/turn-scoped loader cache ───────────────────
//
// On the agentic hot path the three loaders are re-run on every loop iteration
// (up to 200) via prepareRoute, returning identical rows. These tests prove the
// memo collapses the per-iteration reloads to ONE DB round-trip per turn, that a
// degrade/cooldown mutation (or TTL expiry) invalidates it, and — critically —
// that the cached values are byte-identical to a fresh load so routing decisions
// cannot drift. The `now`/`nowMs` clock is injected so the assertions are
// deterministic rather than wall-clock dependent.
describe("routing-loader cache (BI-OPT-ROUTING-CACHE)", () => {
  // Distinct, non-empty rows so we can assert identity + content parity.
  const profileRow = {
    id: "mp-1",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    friendlyName: "Claude Sonnet",
    modelStatus: "active",
    profileSource: "seed",
    profileConfidence: "medium",
    capabilityOverrides: null,
    capabilities: null,
    supportsToolUse: true,
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    pricing: null,
    customScores: null,
    reasoning: 90,
    codegen: 85,
    toolFidelity: 80,
    instructionFollowingScore: 80,
    structuredOutputScore: 80,
    conversational: 80,
    contextRetention: 80,
    outputPricePerMToken: 15,
    retiredAt: null,
    qualityTier: null,
    modelClass: "chat",
    modelFamily: "claude",
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "inferred",
    metadataConfidence: "low",
    perRequestLimits: null,
    provider: {
      endpointType: "chat",
      status: "active",
      sensitivityClearance: ["public", "internal"],
      supportsToolUse: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
      modelRestrictions: [],
      avgLatencyMs: 1000,
      recentFailureRate: 0,
      outputPricePerMToken: 15,
    },
  };
  const policyRow = {
    id: "pr-1",
    name: "no-public-to-cloud",
    description: "demo",
    condition: { kind: "noop" },
  };
  const overrideRow = {
    endpointId: "anthropic:claude-sonnet",
    taskType: "code-gen",
    pinned: true,
    blocked: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRoutingLoaderCache();
    mockPrisma.modelProfile.findMany.mockResolvedValue([profileRow]);
    mockPrisma.policyRule.findMany.mockResolvedValue([policyRow]);
    mockPrisma.endpointTaskPerformance.findMany.mockResolvedValue([overrideRow]);
    mockProviderHasConfiguredCredential.mockResolvedValue(true);
  });

  it("excludes a credentialed provider that has no usable credential material", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      { ...profileRow, provider: { ...profileRow.provider, authMethod: "api_key" } },
    ]);
    mockProviderHasConfiguredCredential.mockResolvedValue(false);

    expect(await loadEndpointManifests(900_000)).toEqual([]);
    expect(mockProviderHasConfiguredCredential).toHaveBeenCalledWith("anthropic", "api_key");
  });

  it("keeps a no-auth local provider eligible", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      {
        ...profileRow,
        providerId: "docker-model-runner",
        provider: { ...profileRow.provider, authMethod: "none" },
      },
    ]);

    const manifests = await loadEndpointManifests(900_001);
    expect(manifests).toHaveLength(1);
    expect(mockProviderHasConfiguredCredential).toHaveBeenCalledWith("docker-model-runner", "none");
  });

  it("marks unsupported ChatGPT-subscription models ineligible without hiding supported fallbacks", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      {
        ...profileRow,
        providerId: "codex",
        modelId: "gpt-5.3-codex",
        provider: { ...profileRow.provider, authMethod: "oauth2_authorization_code" },
      },
      {
        ...profileRow,
        id: "mp-2",
        providerId: "codex",
        modelId: "gpt-5.4",
        provider: { ...profileRow.provider, authMethod: "oauth2_authorization_code" },
      },
    ]);

    const manifests = await loadEndpointManifests(900_002);
    expect(manifests).toHaveLength(2);
    expect(manifests[0]?.eligibilityExclusionReason).toMatch(/not supported.*ChatGPT account/i);
    expect(manifests[1]?.eligibilityExclusionReason).toBeUndefined();
  });

  it("loads each loader's DB rows exactly once across a 200-iteration turn", async () => {
    const t0 = 1_000_000;
    // Simulate the agentic loop calling prepareRoute's loaders every iteration.
    for (let i = 0; i < 200; i++) {
      await loadEndpointManifests(t0 + i); // +i ms — same TTL window
      await loadPolicyRules(t0 + i);
      await loadOverrides("code-gen", t0 + i);
    }

    expect(mockPrisma.modelProfile.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.policyRule.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.endpointTaskPerformance.findMany).toHaveBeenCalledTimes(1);
  });

  it("returns values byte-identical to a fresh (uncached) load — decisions cannot drift", async () => {
    const t0 = 2_000_000;
    // Fresh load with the cache cold.
    const freshManifests = await loadEndpointManifests(t0);
    const freshPolicies = await loadPolicyRules(t0);
    const freshOverrides = await loadOverrides("code-gen", t0);

    // Cached load later in the same TTL window.
    const cachedManifests = await loadEndpointManifests(t0 + 100);
    const cachedPolicies = await loadPolicyRules(t0 + 100);
    const cachedOverrides = await loadOverrides("code-gen", t0 + 100);

    // Only one DB hit each — second call served from memo.
    expect(mockPrisma.modelProfile.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.policyRule.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.endpointTaskPerformance.findMany).toHaveBeenCalledTimes(1);

    // Same reference (the memo) AND deep-equal to what a cold load produced.
    expect(cachedManifests).toBe(freshManifests);
    expect(cachedPolicies).toBe(freshPolicies);
    expect(cachedOverrides).toBe(freshOverrides);
    expect(cachedManifests).toEqual(freshManifests);
    // The mapped manifest carries the expected shape (sanity that we cached the
    // transformed rows, not raw Prisma rows).
    expect(cachedManifests[0]).toMatchObject({
      id: "mp-1",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      status: "active",
    });
  });

  it("reloads after the TTL window elapses", async () => {
    const t0 = 3_000_000;
    await loadEndpointManifests(t0);
    expect(mockPrisma.modelProfile.findMany).toHaveBeenCalledTimes(1);

    // Just inside the window — still served from memo.
    await loadEndpointManifests(t0 + 29_999);
    expect(mockPrisma.modelProfile.findMany).toHaveBeenCalledTimes(1);

    // Past the 30s TTL — a fresh DB load.
    await loadEndpointManifests(t0 + 30_001);
    expect(mockPrisma.modelProfile.findMany).toHaveBeenCalledTimes(2);
  });

  it("invalidateRoutingLoaderCache forces a reload on the next call (degrade/cooldown hook)", async () => {
    const t0 = 4_000_000;
    await loadEndpointManifests(t0);
    await loadPolicyRules(t0);
    await loadOverrides("code-gen", t0);
    expect(mockPrisma.modelProfile.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.policyRule.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.endpointTaskPerformance.findMany).toHaveBeenCalledTimes(1);

    // A degrade/cooldown mutation busts the cache (what markModelDegraded /
    // markEndpointUnavailable call in fallback.ts).
    invalidateRoutingLoaderCache();

    // Next call within the same TTL window must hit the DB again — proving a
    // status change lands on the next routing iteration, not after the TTL.
    await loadEndpointManifests(t0 + 1);
    await loadPolicyRules(t0 + 1);
    await loadOverrides("code-gen", t0 + 1);
    expect(mockPrisma.modelProfile.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.policyRule.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.endpointTaskPerformance.findMany).toHaveBeenCalledTimes(2);
  });

  it("memoizes overrides per taskType (a process serves many; a turn routes one)", async () => {
    const t0 = 5_000_000;
    await loadOverrides("code-gen", t0);
    await loadOverrides("code-gen", t0 + 1); // same key → memo
    await loadOverrides("conversation", t0 + 2); // different key → fresh load

    expect(mockPrisma.endpointTaskPerformance.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.endpointTaskPerformance.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ taskType: "code-gen" }) }),
    );
    expect(mockPrisma.endpointTaskPerformance.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ taskType: "conversation" }) }),
    );
  });
});

function makeDecision(): RouteDecision {
  return {
    selectedEndpoint: "anthropic:claude-sonnet",
    selectedModelId: "claude-sonnet",
    reason: "Best score for requested task.",
    fitnessScore: 91,
    fallbackChain: [],
    candidates: [
      {
        endpointId: "anthropic:claude-sonnet",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        endpointName: "Claude Sonnet",
        fitnessScore: 91,
        dimensionScores: { reasoning: 90 },
        costPerOutputMToken: 3,
        excluded: false,
      },
    ],
    excludedCount: 0,
    excludedReasons: [],
    policyRulesApplied: [],
    taskType: "conversation",
    sensitivity: "internal",
    timestamp: new Date("2026-05-14T10:00:00.000Z"),
  };
}

function makeDecisionWithHarness(): RouteDecision {
  return {
    ...makeDecision(),
    executionPlan: {
      providerId: "anthropic",
      modelId: "claude-sonnet",
      recipeId: null,
      contractFamily: "sync.tool_action",
      executionAdapter: "claude-cli",
      maxTokens: 4096,
      providerSettings: {},
      toolPolicy: { toolChoice: "auto" },
      responsePolicy: { stream: true },
      harness: {
        recipeKey: "high-risk.code-edit.frontier-coding",
        activityClass: "code-edit",
        activityConfidence: "trusted",
        promptStrategy: "repo-packet-with-verification",
        contextAssembler: "work-case-repo-packet",
        memoryPolicy: "work-case-packet",
        tokenPolicy: { inputPacking: "full-context", outputBudget: "expansive" },
        evaluator: "tool-success",
        providerFamily: "frontier",
      },
    },
  };
}

function makeSuitabilityReceipt() {
  return {
    schemaVersion: "provider-suitability-route-receipt/v1" as const,
    policyId: "policy-sha256",
    compilerVersion: "provider-suitability/v1",
    inputVersion: "work-context/v1",
    activityClass: "code-edit",
    workloadClasses: ["source-code"],
    connectionRef: "connection-sha256:1234567890abcdef12345678",
    executionChannel: "direct-api" as const,
    accountClass: "business-team" as const,
    selectedProviderId: "anthropic",
    selectedUnderlyingProviderId: null,
    excludedProviderIds: ["personal-provider"],
    obligations: null,
    explanationCodes: ["provider-evidence-required"],
    createdAt: "2026-07-20T09:00:00.000Z",
  };
}

function makeInferenceDataScreenReceipt(): InferenceDataScreenReceipt {
  return {
    schemaVersion: "inference-data-screen/v1" as const,
    screenId: "screen_safe",
    decisionIds: ["decision-safe"],
    decisionVersions: [
      {
        decisionId: "decision-safe",
        assetVersion: "asset-v1",
        classificationVersion: "classification-v1",
        authorityVersion: "authority-v1",
      },
    ],
    inputHash: "hash-safe",
    classifiedDataClasses: ["employee-records"],
    policyEffect: "deny" as const,
    routeEffect: "local-only" as const,
    destinationClass: "external-service" as const,
    transformation: "blocked" as const,
    explanationCodes: ["restricted-external-denied"],
    obligationKinds: [],
    rawPayloadStored: false,
  };
}
