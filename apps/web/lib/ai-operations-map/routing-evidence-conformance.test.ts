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
      // BI-A4BC02BE: nothing in this window is stamped, so the instrumented era
      // cannot be located and this legacy row counts as pre-instrumentation
      // history rather than a conformance failure. It previously reported
      // unprovenDesignDecisions: 1 and emitted a design-unproven finding.
      unprovenDesignDecisions: 0,
      preInstrumentationDecisions: 1,
      instrumentedSince: null,
    });
    // The other three findings are unaffected — legacy traffic is still visible
    // as unattributed, uncorrelated, and unevidenced.
    expect(projection.findings.map((finding) => finding.issueType)).toEqual([
      "ai-routing-evidence-unattributed",
      "ai-routing-evidence-uncorrelated",
      "ai-routing-evidence-missing",
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

// BI-C8BC9DD1. The founder asked their coworker "what do I do about these 173
// issues?" and no answer was possible: findings carried only `message` and
// `count`, so there was no remediation to retrieve. The coworker exhausted its
// iteration budget and returned a safety-limit message, which read as a
// coworker defect but was an empty contract.
describe("owner-actionable findings (BI-C8BC9DD1)", () => {
  const unstampedDecision = (id: string) => ({
    id,
    traceId: null,
    designRevision: null,
    agentId: "ops-coordinator",
    actorKind: "agent",
    actorId: "ops-coordinator",
    selectedEndpointId: "profile-openai",
    selectedModelId: "gpt-5",
    taskType: "conversation",
    sensitivity: "internal",
    candidateTrace: [],
    excludedTrace: [],
    fallbackChain: [],
    fallbacksUsed: [],
    screenReceipt: null,
    createdAt: new Date("2026-07-27T12:00:00.000Z"),
  });

  it("gives every emitted finding a non-empty next action", () => {
    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [unstampedDecision("d-1"), unstampedDecision("d-2")],
    }));

    expect(projection.findings.length).toBeGreaterThan(0);
    for (const finding of projection.findings) {
      expect(finding.nextAction.trim()).not.toBe("");
      expect(finding.ownerAction).toBeDefined();
    }
  });

  // Superseded by BI-A4BC02BE. Pre-instrumentation traffic no longer produces a
  // finding AT ALL — which is stronger than classifying it as historical, and is
  // why this assertion changed from "is none-historical" to "does not appear".
  it("emits no design finding at all for pre-instrumentation traffic", () => {
    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [unstampedDecision("d-1")],
    }));

    expect(projection.findings.map((finding) => finding.issueType))
      .not.toContain("ai-routing-design-unproven");
    expect(projection.coverage.preInstrumentationDecisions).toBe(1);
    expect(projection.coverage.unprovenDesignDecisions).toBe(0);
  });

  it("marks a boundary crossing as a platform defect the owner cannot fix", () => {
    const traceId = "abcdefabcdefabcdefabcdefabcdefab";
    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [{
        ...unstampedDecision("d-blocked"),
        traceId,
        designRevision: AI_ROUTING_ARCHITECTURE_VERSION,
        candidateTrace: [{ endpointId: "profile-openai", providerId: "openai", modelId: "gpt-5", excluded: false }],
        screenReceipt: {
          screenId: "screen_1",
          routeEffect: "block",
          transformation: "blocked",
          classifiedDataClasses: ["employee-records"],
          rawPayloadStored: false,
        },
      }],
      adapterRuns: [{
        id: "run-1",
        traceId,
        providerId: "openai",
        modelId: "gpt-5",
        adapterKind: "chat",
        status: "success",
        durationMs: 100,
        inputTokens: 10,
        outputTokens: 10,
        estimatedCostUsd: 0,
        startedAt: new Date("2026-07-27T12:00:01.000Z"),
      }],
      providers: [{ providerId: "openai", category: "direct" }],
    }));

    const blocked = projection.findings.find(
      (finding) => finding.issueType === "ai-routing-blocked-path-dispatched",
    );
    expect(blocked?.severity).toBe("error");
    expect(blocked?.ownerAction).toBe("platform-defect");
    expect(blocked?.nextAction).toMatch(/no action available to you/i);
  });

  it("keeps remediation free of request content", () => {
    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [unstampedDecision("d-1")],
    }));
    const remediation = projection.findings.map((finding) => finding.nextAction).join(" ");
    expect(remediation).not.toMatch(/prompt|detectedValue|rawPayload/i);
  });
});

// BI-A4BC02BE. `unprovenDesignDecisions` was `totalDecisions - designBoundDecisions`,
// where totalDecisions is however many rows the loader fetched. Since stamping
// began at a fixed past point, that evaluated to `fetch_limit - total_stamped_rows`
// and was reported to an owner as "171 issues". It measured the page size.
describe("design conformance is bounded to the instrumented era (BI-A4BC02BE)", () => {
  const decision = (id: string, iso: string, designRevision: string | null) => ({
    id,
    traceId: null,
    designRevision,
    agentId: "ops-coordinator",
    actorKind: "agent",
    actorId: "ops-coordinator",
    selectedEndpointId: "profile-openai",
    selectedModelId: "gpt-5",
    taskType: "conversation",
    sensitivity: "internal",
    candidateTrace: [],
    excludedTrace: [],
    fallbackChain: [],
    fallbacksUsed: [],
    screenReceipt: null,
    createdAt: new Date(iso),
  });

  const REV = AI_ROUTING_ARCHITECTURE_VERSION;

  it("does not count decisions older than the first stamped one", () => {
    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [
        decision("old-1", "2026-07-27T01:00:00.000Z", null),
        decision("old-2", "2026-07-27T02:00:00.000Z", null),
        decision("new-1", "2026-07-27T10:00:00.000Z", REV),
      ],
    }));

    expect(projection.coverage.preInstrumentationDecisions).toBe(2);
    expect(projection.coverage.unprovenDesignDecisions).toBe(0);
    expect(projection.coverage.instrumentedSince).toBe("2026-07-27T10:00:00.000Z");
  });

  it("DOES count an unstamped decision recorded after stamping began", () => {
    const projection = projectRoutingEvidenceConformance(baseInput({
      decisions: [
        decision("old-1", "2026-07-27T01:00:00.000Z", null),
        decision("new-1", "2026-07-27T10:00:00.000Z", REV),
        decision("gap-1", "2026-07-27T11:00:00.000Z", null),
      ],
    }));

    expect(projection.coverage.preInstrumentationDecisions).toBe(1);
    expect(projection.coverage.unprovenDesignDecisions).toBe(1);
    const unproven = projection.findings.find(
      (finding) => finding.issueType === "ai-routing-design-unproven",
    );
    // A genuine post-instrumentation gap is a platform defect, not history.
    expect(unproven?.ownerAction).toBe("platform-defect");
  });

  // The defining property of the old bug: the count grew purely because the
  // caller fetched more rows. Adding pre-instrumentation history must not move it.
  it("is invariant to how many historic rows the loader fetched", () => {
    const stamped = decision("new-1", "2026-07-27T10:00:00.000Z", REV);
    const historic = (n: number) =>
      Array.from({ length: n }, (_unused, i) =>
        decision(`old-${i}`, new Date(Date.UTC(2026, 6, 27, 1, i)).toISOString(), null));

    const small = projectRoutingEvidenceConformance(baseInput({
      decisions: [...historic(5), stamped],
    }));
    const large = projectRoutingEvidenceConformance(baseInput({
      decisions: [...historic(300), stamped],
    }));

    expect(small.coverage.unprovenDesignDecisions).toBe(0);
    expect(large.coverage.unprovenDesignDecisions).toBe(0);
    expect(large.coverage.unprovenDesignDecisions)
      .toBe(small.coverage.unprovenDesignDecisions);
  });

  // And it must not silently self-clear: each new stamped decision used to
  // decrement the reported count by one with no remediation performed.
  it("does not decrement as new stamped traffic accrues", () => {
    const historic = [decision("old-1", "2026-07-27T01:00:00.000Z", null)];
    const before = projectRoutingEvidenceConformance(baseInput({
      decisions: [...historic, decision("s-1", "2026-07-27T10:00:00.000Z", REV)],
    }));
    const after = projectRoutingEvidenceConformance(baseInput({
      decisions: [
        ...historic,
        decision("s-1", "2026-07-27T10:00:00.000Z", REV),
        decision("s-2", "2026-07-27T12:00:00.000Z", REV),
        decision("s-3", "2026-07-27T13:00:00.000Z", REV),
      ],
    }));

    expect(after.coverage.unprovenDesignDecisions)
      .toBe(before.coverage.unprovenDesignDecisions);
  });
});
