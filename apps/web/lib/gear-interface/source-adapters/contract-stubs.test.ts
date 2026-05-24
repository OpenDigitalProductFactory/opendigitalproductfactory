// apps/web/lib/gear-interface/source-adapters/contract-stubs.test.ts
//
// Contract tests for Ring 2→3, 3→4, 4→5 adapters that are NOT emitted in
// production during Phase 0. We still validate their shape so the spec contract
// is mechanized and so Phase 1+ wiring inherits a tested baseline.
//
// Each contract test confirms:
//   - The adapter produces a valid GearInterfaceInput
//   - The writer's validator accepts it (idempotency key derives cleanly)
//   - Required archetypeContext is set for Ring 2→3 and beyond

import { describe, it, expect } from "vitest";
import { deriveIdempotencyKey, validateGearInterfaceInput } from "../writer";
import { runtimeVerificationToRing34Input } from "./runtime-verification";
import { promotionToRing34Input } from "./promotion";
import { featurePackToRing45Input } from "./feature-pack";
import {
  toolExecutionToRing12Input,
} from "./tool-execution";
import { adapterRunTelemetryToRing12Input } from "./adapter-run-telemetry";

describe("contract stub: RuntimeVerification → Ring 3→4", () => {
  const source = {
    id: "rv-1",
    verificationId: "rv-1",
    kind: "deployment-smoke",
    status: "pass",
    runtimeTargetId: "rt-1",
    featureBuildId: "fb-1",
    gitPromotionCandidateId: null,
    startedAt: new Date("2026-05-24T15:00:00Z"),
    completedAt: new Date("2026-05-24T15:01:00Z"),
    archetypeContext: "hvac",
    agentId: "agent-runtime",
  };

  it("produces a valid Ring 3→4 record with archetypeContext", () => {
    const input = runtimeVerificationToRing34Input(source);
    expect(input.innerRing).toBe(3);
    expect(input.outerRing).toBe(4);
    expect(input.archetypeContext).toBe("hvac");
    expect(() => validateGearInterfaceInput(input)).not.toThrow();
    expect(deriveIdempotencyKey(input)).toBe(
      "internal-adjacent:3:4:outward:runtime-verification:rv-1:transmission",
    );
  });

  it("rejects without archetypeContext (Ring 3→4 requires it)", () => {
    const input = runtimeVerificationToRing34Input({ ...source, archetypeContext: "" });
    // empty string is truthy-false for our nullish path; force null:
    expect(() =>
      validateGearInterfaceInput({ ...input, archetypeContext: null }),
    ).toThrow(/archetypeContext/);
  });
});

describe("contract stub: Promotion → Ring 3→4", () => {
  it("produces a valid Ring 3→4 promotion record", () => {
    const input = promotionToRing34Input({
      id: "gpc-1",
      promotionKind: "GitPromotionCandidate",
      archetypeContext: "hvac",
      agentId: "agent-release",
      success: true,
      recordedAt: new Date("2026-05-24T15:30:00Z"),
    });
    expect(input.innerRing).toBe(3);
    expect(input.outerRing).toBe(4);
    expect(() => validateGearInterfaceInput(input)).not.toThrow();
  });
});

describe("contract stub: FeaturePack → Ring 4↔5 external-federated", () => {
  it("produces a valid lateral external-federated record", () => {
    const input = featurePackToRing45Input({
      id: "fp-1",
      direction: "outward",
      peerInstallPseudonym: "anon-install-7f8a",
      agentId: "agent-hive",
      archetypeContext: "hvac",
      success: true,
      failureReason: null,
      recordedAt: new Date("2026-05-24T15:45:00Z"),
    });
    expect(input.interfaceClass).toBe("external-federated");
    expect(input.transmissionDirection).toBe("lateral");
    expect(input.externalCounterpartyType).toBe("peer-install");
    expect(input.externalCounterpartyId).toBe("anon-install-7f8a");
    expect(input.innerRing).toBeNull();
    expect(input.outerRing).toBeNull();
    expect(() => validateGearInterfaceInput(input)).not.toThrow();
  });
});

describe("contract stub: ToolExecution → Ring 1→2", () => {
  it("normalizes a successful tool call", () => {
    const input = toolExecutionToRing12Input({
      id: "te-1",
      threadId: "t-1",
      agentId: "agent-build-specialist",
      userId: "u-1",
      toolName: "create_backlog_item",
      success: true,
      executionMode: "governed",
      routeContext: "/api/mcp/v1",
      durationMs: 120,
      createdAt: new Date(),
      capabilityId: "backlog/create",
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    });
    expect(input.outcomeType).toBe("transmission");
    expect(input.capabilityName).toBe("backlog/create");
    expect(() => validateGearInterfaceInput(input)).not.toThrow();
  });
});

describe("contract stub: AdapterRunTelemetry → Ring 1→2", () => {
  it("normalizes a successful inference", () => {
    const input = adapterRunTelemetryToRing12Input({
      id: "art-1",
      threadId: null,
      agentId: "agent-build-specialist",
      buildId: "build-1",
      adapterKind: "anthropic-messages",
      providerId: "anthropic",
      modelId: "claude-opus-4-7",
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 800,
      status: "success",
      refusalReason: null,
      errorClass: null,
      inputTokens: 1200,
      cachedInputTokens: 800,
      cacheCreationInputTokens: 100,
      outputTokens: 400,
      reasoningTokens: 50,
      estimatedCostUsd: 0.012,
      toolCallsTotal: 3,
      toolCallsInvalid: 0,
      schemaDriftDetected: false,
      capabilitiesUsed: ["tool_use"],
    });
    expect(input.outcomeType).toBe("transmission");
    expect(input.cacheReadInputTokens).toBe(800);
    expect(input.reasoningOutputTokens).toBe(50);
    expect(() => validateGearInterfaceInput(input)).not.toThrow();
  });

  it("normalizes a refusal as a slip with safety-block reason", () => {
    const input = adapterRunTelemetryToRing12Input({
      id: "art-2",
      threadId: null,
      agentId: "agent-build-specialist",
      buildId: "build-1",
      adapterKind: "anthropic-messages",
      providerId: "anthropic",
      modelId: "claude-opus-4-7",
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 200,
      status: "refusal",
      refusalReason: "policy",
      errorClass: null,
      inputTokens: 200,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      outputTokens: 20,
      reasoningTokens: null,
      estimatedCostUsd: null,
      toolCallsTotal: 0,
      toolCallsInvalid: 0,
      schemaDriftDetected: false,
      capabilitiesUsed: [],
    });
    expect(input.outcomeType).toBe("slip");
    expect(input.slipReason).toBe("safety-block");
    expect(input.slipDetected).toBe(true);
  });
});
