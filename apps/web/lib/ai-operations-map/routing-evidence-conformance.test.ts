import { describe, expect, it } from "vitest";

import { AI_ROUTING_ARCHITECTURE_VERSION } from "@/lib/ea/ai-routing-architecture-registry";
import {
  projectRoutingEvidenceConformance,
  type RoutingEvidenceConformanceInput,
} from "./routing-evidence-conformance";

const WINDOW = {
  start: new Date("2026-07-27T00:00:00.000Z"),
  end: new Date("2026-07-28T00:00:00.000Z"),
};

function baseInput(
  overrides: Partial<RoutingEvidenceConformanceInput> = {},
): RoutingEvidenceConformanceInput {
  return {
    window: WINDOW,
    currentDesignRevision: AI_ROUTING_ARCHITECTURE_VERSION,
    decisions: [],
    adapterRuns: [],
    outcomes: [],
    tokenUsage: [],
    capacity: [],
    providers: [],
    ...overrides,
  };
}

describe("projectRoutingEvidenceConformance", () => {
  it("correlates one safe route across decision, adapter, outcome, and usage ledgers", () => {
    const traceId = "0123456789abcdef0123456789abcdef";
    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [{
        id: "decision-1",
        traceId,
        designRevision: AI_ROUTING_ARCHITECTURE_VERSION,
        agentId: "ops-coordinator",
        actorKind: "agent",
        actorId: "ops-coordinator",
        selectedEndpointId: "profile-openai",
        selectedModelId: "gpt-5",
        taskType: "conversation",
        sensitivity: "confidential",
        candidateTrace: [{
          endpointId: "profile-openai",
          providerId: "openai",
          modelId: "gpt-5",
          excluded: false,
        }],
        excludedTrace: [{ providerId: "anthropic", excluded: true }],
        fallbackChain: ["profile-local"],
        fallbacksUsed: [],
        screenReceipt: {
          screenId: "screen_safe",
          routeEffect: "allow",
          transformation: "none",
          classifiedDataClasses: ["customer-records"],
          rawPayloadStored: false,
        },
        createdAt: new Date("2026-07-27T01:00:00.000Z"),
      }],
      adapterRuns: [{
        id: "adapter-1",
        traceId,
        providerId: "openai",
        modelId: "gpt-5",
        adapterKind: "responses",
        status: "success",
        durationMs: 1200,
        inputTokens: 100,
        outputTokens: 20,
        estimatedCostUsd: 0.02,
        startedAt: new Date("2026-07-27T01:00:01.000Z"),
      }],
      outcomes: [{
        id: "outcome-1",
        traceId,
        providerId: "openai",
        modelId: "gpt-5",
        fallbackOccurred: false,
        providerErrorCode: null,
        latencyMs: 1200,
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.02,
        createdAt: new Date("2026-07-27T01:00:02.000Z"),
      }],
      tokenUsage: [{
        id: "usage-1",
        traceId,
        providerId: "openai",
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.02,
        createdAt: new Date("2026-07-27T01:00:02.000Z"),
      }],
      providers: [{ providerId: "openai", category: "external" }],
    }));

    expect(projection.coverage).toMatchObject({
      totalDecisions: 1,
      attributedDecisions: 1,
      tracedDecisions: 1,
      correlatedDecisions: 1,
      uncorrelatedDecisions: 0,
      unevidencedDecisions: 0,
      designBoundDecisions: 1,
    });
    expect(projection.metrics).toMatchObject({
      decisionVolume: 1,
      adapterAttempts: 1,
      successfulAttempts: 1,
      errorAttempts: 0,
      fallbackAttempts: 0,
      excludedCandidates: 1,
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.02,
      latencyP50Ms: 1200,
      latencyP95Ms: 1200,
    });
    expect(projection.providerMetrics).toEqual([
      expect.objectContaining({
        providerId: "openai",
        attributes: expect.objectContaining({
          "gen_ai.provider.name": "openai",
          "gen_ai.request.model": "gpt-5",
          "gen_ai.response.model": "gpt-5",
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 20,
        }),
      }),
    ]);
    expect(projection.findings).toEqual([]);
  });

  it("keeps historic unattributed and uncorrelated activity visible without inventing joins", () => {
    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [{
        id: "legacy-decision",
        traceId: null,
        designRevision: null,
        agentId: null,
        actorKind: "legacy_unattributed",
        actorId: "legacy-route-decision-log",
        selectedEndpointId: "profile-openai",
        selectedModelId: "gpt-4",
        taskType: "conversation",
        sensitivity: "internal",
        candidateTrace: [],
        excludedTrace: [],
        fallbackChain: [],
        fallbacksUsed: null,
        screenReceipt: null,
        createdAt: new Date("2026-07-27T01:00:00.000Z"),
      }],
    }));

    expect(projection.coverage).toMatchObject({
      totalDecisions: 1,
      attributedDecisions: 0,
      tracedDecisions: 0,
      correlatedDecisions: 0,
      uncorrelatedDecisions: 1,
      unevidencedDecisions: 1,
      designBoundDecisions: 0,
      unprovenDesignDecisions: 1,
    });
    expect(projection.findings.map((finding) => finding.issueType)).toEqual([
      "ai-routing-evidence-unattributed",
      "ai-routing-evidence-uncorrelated",
      "ai-routing-evidence-missing",
      "ai-routing-design-unproven",
    ]);
  });

  it("reports stale design and a policy-blocked external dispatch as aggregate conformance", () => {
    const traceId = "fedcba9876543210fedcba9876543210";
    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [{
        id: "blocked-decision",
        traceId,
        designRevision: "2026-07-01.1",
        agentId: null,
        actorKind: "system",
        actorId: "routed-inference",
        selectedEndpointId: "profile-openai",
        selectedModelId: "gpt-5",
        taskType: "conversation",
        sensitivity: "restricted",
        candidateTrace: [{
          endpointId: "profile-openai",
          providerId: "openai",
          modelId: "gpt-5",
          excluded: false,
        }],
        excludedTrace: [],
        fallbackChain: [],
        fallbacksUsed: null,
        screenReceipt: {
          screenId: "screen_blocked",
          routeEffect: "block",
          transformation: "blocked",
          classifiedDataClasses: ["secrets-credentials"],
          rawPayloadStored: false,
        },
        createdAt: new Date("2026-07-27T02:00:00.000Z"),
      }],
      adapterRuns: [{
        id: "adapter-blocked",
        traceId,
        providerId: "openai",
        modelId: "gpt-5",
        adapterKind: "responses",
        status: "success",
        durationMs: 100,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0,
        startedAt: new Date("2026-07-27T02:00:01.000Z"),
      }],
      providers: [{ providerId: "openai", category: "external" }],
    }));

    expect(projection.coverage.staleDesignDecisions).toBe(1);
    expect(projection.findings.map((finding) => finding.issueType)).toEqual([
      "ai-routing-design-stale",
      "ai-routing-blocked-path-dispatched",
    ]);
    expect(projection.findings[1]).toMatchObject({
      severity: "error",
      count: 1,
      architectureStageId: "dispatch",
    });
  });

  it("never copies content-bearing fields into the safe projection", () => {
    const canary = "CANARY-secret-customer-value";
    const unsafeDecision = {
      id: "decision-canary",
      traceId: null,
      designRevision: null,
      agentId: null,
      actorKind: "system",
      actorId: "routed-inference",
      selectedEndpointId: "none",
      selectedModelId: null,
      taskType: "conversation",
      sensitivity: "restricted",
      candidateTrace: [{ excluded: true, rawPrompt: canary }],
      excludedTrace: [{ excluded: true, detectedValue: canary }],
      fallbackChain: [],
      fallbacksUsed: null,
      screenReceipt: {
        screenId: "screen_canary",
        routeEffect: "block" as const,
        transformation: "blocked" as const,
        classifiedDataClasses: ["secrets-credentials"],
        rawPayloadStored: false as const,
        rawPrompt: canary,
      },
      createdAt: new Date("2026-07-27T03:00:00.000Z"),
    };

    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [unsafeDecision],
    }));

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain("rawPrompt");
    expect(serialized).not.toContain("detectedValue");
  });
});
