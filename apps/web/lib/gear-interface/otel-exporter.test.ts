// apps/web/lib/gear-interface/otel-exporter.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildOtelAttributes,
  buildOtelSpanName,
  isOtelExportEnabled,
  type GearInterfaceRow,
} from "./otel-exporter";

const baseRow: GearInterfaceRow = {
  id: "gear-1",
  schemaVersion: 1,
  recordedAt: new Date("2026-05-24T16:00:00Z"),
  sourceEventAt: new Date("2026-05-24T15:59:00Z"),
  idempotencyKey: "internal-adjacent:1:2:outward:phase-run:pr-1:transmission",
  organizationId: null,
  interfaceClass: "internal-adjacent",
  transmissionDirection: "outward",
  innerRing: 1,
  outerRing: 2,
  externalCounterpartyType: null,
  externalCounterpartyId: null,
  shaftSourceType: "phase-run",
  shaftSourceId: "pr-1",
  actorType: "agent",
  actorId: "agent-build",
  actorPrincipalId: null,
  intent: "complete-phase-build",
  capabilityName: "build-phase-build",
  capabilityVocabularyVersion: "raw-v0",
  archetypeContext: null,
  agentIdForTriple: "agent-build",
  torqueTechnical: 1.0,
  torqueValue: null,
  torqueConfidence: 0.9,
  ratioConsumed: 8,
  outcomeType: "transmission",
  slipDetected: false,
  slipReason: null,
  // Prisma's Decimal type stringifies; tests pass a string-compatible stand-in.
  costUsd: null,
  inputTokens: 12000,
  outputTokens: 4500,
  cacheCreationInputTokens: null,
  cacheReadInputTokens: null,
  reasoningOutputTokens: null,
  durationMs: 1800000,
  graduationFromAutonomy: null,
  graduationToAutonomy: null,
  graduationSampleSize: null,
  graduationGovernorRef: null,
  graderType: "automated",
  graderId: "build-phase-run.completeBuildPhaseRun",
  rationale: null,
  otelTraceId: null,
  otelSpanId: null,
};

beforeEach(() => {
  delete process.env.DPF_GEAR_OTEL_EXPORT;
});

describe("isOtelExportEnabled", () => {
  it("is disabled by default", () => {
    expect(isOtelExportEnabled()).toBe(false);
  });
  it("is enabled when flag=1", () => {
    process.env.DPF_GEAR_OTEL_EXPORT = "1";
    expect(isOtelExportEnabled()).toBe(true);
  });
  it("is enabled when flag=true", () => {
    process.env.DPF_GEAR_OTEL_EXPORT = "true";
    expect(isOtelExportEnabled()).toBe(true);
  });
});

describe("buildOtelSpanName", () => {
  it("renders outward internal-adjacent as ring{n}_to_ring{n+1}", () => {
    expect(buildOtelSpanName(baseRow)).toBe(
      "dpf.gear.transmit ring1_to_ring2 build-phase-build",
    );
  });
  it("renders inward as ring{n}_from_ring{n+1}", () => {
    expect(
      buildOtelSpanName({ ...baseRow, transmissionDirection: "inward" }),
    ).toBe("dpf.gear.transmit ring1_from_ring2 build-phase-build");
  });
  it("renders external classes with capability suffix", () => {
    expect(
      buildOtelSpanName({
        ...baseRow,
        interfaceClass: "external-federated",
        innerRing: null,
        outerRing: null,
      }),
    ).toBe("dpf.gear.external external-federated build-phase-build");
  });
});

describe("buildOtelAttributes", () => {
  it("emits dpf.gear.* attributes", () => {
    const attrs = buildOtelAttributes(baseRow);
    expect(attrs["dpf.gear.interface_class"]).toBe("internal-adjacent");
    expect(attrs["dpf.gear.transmission_direction"]).toBe("outward");
    expect(attrs["dpf.gear.inner_ring"]).toBe(1);
    expect(attrs["dpf.gear.outer_ring"]).toBe(2);
    expect(attrs["dpf.gear.torque.technical"]).toBe(1.0);
    expect(attrs["dpf.gear.torque.confidence"]).toBe(0.9);
    expect(attrs["dpf.gear.outcome_type"]).toBe("transmission");
  });

  it("maps shaft source type to gen_ai.operation.name", () => {
    const attrs = buildOtelAttributes(baseRow);
    expect(attrs["gen_ai.operation.name"]).toBe("invoke_workflow");

    const toolAttrs = buildOtelAttributes({
      ...baseRow,
      shaftSourceType: "tool-execution",
    });
    expect(toolAttrs["gen_ai.operation.name"]).toBe("execute_tool");
  });

  it("emits gen_ai.usage.* token fields when present", () => {
    const attrs = buildOtelAttributes(baseRow);
    expect(attrs["gen_ai.usage.input_tokens"]).toBe(12000);
    expect(attrs["gen_ai.usage.output_tokens"]).toBe(4500);
  });

  it("omits null/optional fields cleanly", () => {
    const attrs = buildOtelAttributes(baseRow);
    expect(attrs).not.toHaveProperty("dpf.gear.slip.reason");
    expect(attrs).not.toHaveProperty("dpf.gear.capability.archetype_context");
    expect(attrs).not.toHaveProperty("dpf.gear.graduation.from_autonomy");
  });

  it("includes archetype and slip details when set", () => {
    const attrs = buildOtelAttributes({
      ...baseRow,
      archetypeContext: "hvac",
      slipDetected: true,
      slipReason: "rate-limit",
    });
    expect(attrs["dpf.gear.capability.archetype_context"]).toBe("hvac");
    expect(attrs["dpf.gear.slip.detected"]).toBe(true);
    expect(attrs["dpf.gear.slip.reason"]).toBe("rate-limit");
  });
});
