// apps/web/lib/gear-interface/source-adapters/phase-run.test.ts

import { describe, it, expect } from "vitest";
import {
  phaseRunToRing12Input,
  _internals,
  type PhaseOutcomeSignals,
  type PhaseRunSource,
} from "./phase-run";

const completedAt = new Date("2026-05-24T16:00:00Z");
const startedAt = new Date("2026-05-24T15:30:00Z");

function basePhaseRun(overrides: Partial<PhaseRunSource> = {}): PhaseRunSource {
  return {
    id: "phaserun-build-123-build",
    buildId: "build-123",
    phase: "build",
    startedAt,
    completedAt,
    durationMs: 30 * 60 * 1000,
    inputTokens: 12_000,
    outputTokens: 4_500,
    costUsd: "0.142",
    inferenceCount: 8,
    providerId: "anthropic",
    ...overrides,
  };
}

function baseSignals(overrides: Partial<PhaseOutcomeSignals> = {}): PhaseOutcomeSignals {
  return {
    claimedByAgentId: "agent-build-specialist",
    codingProvider: "claude-cli",
    uxVerificationStatus: "complete",
    acceptanceMet: true,
    abandoned: false,
    abandonReason: null,
    worstFailureAxis: null,
    attemptCount: 1,
    ...overrides,
  };
}

describe("phaseRunToRing12Input", () => {
  it("returns null when the phase has not completed", () => {
    const input = phaseRunToRing12Input(
      basePhaseRun({ completedAt: null }),
      baseSignals(),
    );
    expect(input).toBeNull();
  });

  it("emits a transmission with torque=1.0 on clean completion", () => {
    const input = phaseRunToRing12Input(basePhaseRun(), baseSignals());
    expect(input).not.toBeNull();
    expect(input!.outcomeType).toBe("transmission");
    expect(input!.torqueTechnical).toBe(1.0);
    expect(input!.slipDetected).toBe(false);
    expect(input!.slipReason).toBeNull();
    expect(input!.innerRing).toBe(1);
    expect(input!.outerRing).toBe(2);
    expect(input!.ratioConsumed).toBe(8);
    expect(input!.capabilityName).toBe("build-phase-build");
    expect(input!.agentIdForTriple).toBe("agent-build-specialist");
  });

  it("emits a slip when the build was abandoned", () => {
    const input = phaseRunToRing12Input(
      basePhaseRun(),
      baseSignals({ abandoned: true, abandonReason: "operator-veto" }),
    );
    expect(input!.outcomeType).toBe("slip");
    expect(input!.torqueTechnical).toBe(0);
    expect(input!.rationale).toContain("operator-veto");
  });

  it("emits a slip when UX verification failed", () => {
    const input = phaseRunToRing12Input(
      basePhaseRun(),
      baseSignals({ uxVerificationStatus: "failed" }),
    );
    expect(input!.outcomeType).toBe("slip");
    expect(input!.torqueTechnical).toBe(0);
  });

  it("emits partial torque when a dispatch attempt failed but the phase completed", () => {
    const input = phaseRunToRing12Input(
      basePhaseRun(),
      baseSignals({ worstFailureAxis: "rate-limit", attemptCount: 2 }),
    );
    expect(input!.outcomeType).toBe("slip");
    expect(input!.torqueTechnical).toBeLessThan(1.0);
    expect(input!.slipDetected).toBe(true);
    expect(input!.slipReason).toBe("rate-limit");
  });

  it("falls back to coding provider when no claimed coworker", () => {
    const input = phaseRunToRing12Input(
      basePhaseRun(),
      baseSignals({ claimedByAgentId: null }),
    );
    expect(input!.agentIdForTriple).toBe("claude-cli");
  });

  it("never throws when both agent attributions are null", () => {
    const input = phaseRunToRing12Input(
      basePhaseRun(),
      baseSignals({ claimedByAgentId: null, codingProvider: null }),
    );
    expect(input!.agentIdForTriple).toContain("unknown-agent");
  });

  it("leaves archetypeContext null at Ring 1→2 (spec §3.3)", () => {
    const input = phaseRunToRing12Input(basePhaseRun(), baseSignals());
    expect(input!.archetypeContext).toBeNull();
  });

  it("propagates cost + token rollup verbatim from the phase run", () => {
    const input = phaseRunToRing12Input(basePhaseRun(), baseSignals());
    expect(input!.costUsd).toBe("0.142");
    expect(input!.inputTokens).toBe(12_000);
    expect(input!.outputTokens).toBe(4_500);
    expect(input!.durationMs).toBe(30 * 60 * 1000);
  });
});

describe("phase-run internals", () => {
  it("maps rate-limit failure axis to slip reason", () => {
    expect(_internals.failureAxisToSlipReason("rate-limit")).toBe("rate-limit");
  });
  it("maps unknown axis to null (not a slip we can categorize)", () => {
    expect(_internals.failureAxisToSlipReason("unknown")).toBeNull();
    expect(_internals.failureAxisToSlipReason(null)).toBeNull();
  });
  it("falls back to failed-outcome for unmapped axes", () => {
    expect(_internals.failureAxisToSlipReason("weird-new-axis")).toBe("failed-outcome");
  });
});
