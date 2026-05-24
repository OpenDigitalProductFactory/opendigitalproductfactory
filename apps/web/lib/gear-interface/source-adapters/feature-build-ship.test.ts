// apps/web/lib/gear-interface/source-adapters/feature-build-ship.test.ts

import { describe, it, expect } from "vitest";
import {
  featureBuildArchetypeUnresolvedToRing23Input,
  featureBuildShipToRing23Input,
  type FeatureBuildShipSource,
} from "./feature-build-ship";
import { validateGearInterfaceInput } from "../writer";

function source(overrides: Partial<FeatureBuildShipSource> = {}): FeatureBuildShipSource {
  return {
    id: "fb-1",
    buildId: "FB-ABC123",
    title: "Add invoice export",
    archetypeContext: "hvac",
    claimedByAgentId: "agent-build-specialist",
    codingProvider: "claude-cli",
    shipSucceeded: true,
    acceptanceMet: true,
    completedAt: new Date("2026-05-24T18:00:00Z"),
    ...overrides,
  };
}

describe("featureBuildShipToRing23Input", () => {
  it("emits a Ring 2→3 outward transmission with archetypeContext set when ship succeeds + accepted", () => {
    const input = featureBuildShipToRing23Input(source());
    expect(input.innerRing).toBe(2);
    expect(input.outerRing).toBe(3);
    expect(input.transmissionDirection).toBe("outward");
    expect(input.archetypeContext).toBe("hvac");
    expect(input.torqueTechnical).toBe(1.0);
    expect(input.outcomeType).toBe("transmission");
    expect(input.slipDetected).toBe(false);
    expect(input.capabilityName).toBe("feature-build-ship");
    expect(input.shaftSourceType).toBe("phase-run");
    expect(input.shaftSourceId).toBe("fb-1-ship");
    expect(() => validateGearInterfaceInput(input)).not.toThrow();
  });

  it("emits partial torque when ship succeeded but acceptance is unknown", () => {
    const input = featureBuildShipToRing23Input(source({ acceptanceMet: null }));
    expect(input.torqueTechnical).toBe(0.75);
    expect(input.outcomeType).toBe("transmission");
    expect(input.torqueConfidence).toBe(0.6);
  });

  it("emits a slip when ship succeeded but acceptance was rejected", () => {
    const input = featureBuildShipToRing23Input(source({ acceptanceMet: false }));
    expect(input.torqueTechnical).toBe(0.25);
    expect(input.outcomeType).toBe("slip");
    expect(input.slipReason).toBe("failed-outcome");
  });

  it("emits a slip with torque=0 when ship failed", () => {
    const input = featureBuildShipToRing23Input(source({ shipSucceeded: false, acceptanceMet: null }));
    expect(input.torqueTechnical).toBe(0);
    expect(input.outcomeType).toBe("slip");
    expect(input.slipReason).toBe("failed-outcome");
  });

  it("falls back to coding provider when no claimed agent", () => {
    const input = featureBuildShipToRing23Input(source({ claimedByAgentId: null }));
    expect(input.agentIdForTriple).toBe("claude-cli");
  });

  it("rejects via the writer invariant when archetypeContext is missing", () => {
    // Force the adapter to produce an input with archetypeContext=null — the
    // writer's validator catches this for us at Ring 2→3 per spec §3.3.
    const input = featureBuildShipToRing23Input(source({ archetypeContext: "" }));
    expect(() =>
      validateGearInterfaceInput({ ...input, archetypeContext: null }),
    ).toThrow(/archetypeContext/);
  });

  it("uses the source completedAt as sourceEventAt", () => {
    const at = new Date("2026-05-24T18:30:00Z");
    const input = featureBuildShipToRing23Input(source({ completedAt: at }));
    expect(input.sourceEventAt).toBe(at);
  });

  it("defaults ratioConsumed to 5 (the default phase lifecycle length)", () => {
    expect(featureBuildShipToRing23Input(source()).ratioConsumed).toBe(5);
  });

  it("respects an explicit ringRatioConsumed override", () => {
    expect(
      featureBuildShipToRing23Input(source({ ringRatioConsumed: 12 })).ratioConsumed,
    ).toBe(12);
  });

  it("can emit a Ring 2→3 archetype-unresolved slip without fabricating context", () => {
    const input = featureBuildArchetypeUnresolvedToRing23Input({
      id: "fb-1",
      buildId: "FB-ABC123",
      title: "Add invoice export",
      claimedByAgentId: "agent-build-specialist",
      codingProvider: "claude-cli",
      completedAt: new Date("2026-05-24T18:00:00Z"),
    });

    expect(input.innerRing).toBe(2);
    expect(input.outerRing).toBe(3);
    expect(input.archetypeContext).toBeNull();
    expect(input.outcomeType).toBe("slip");
    expect(input.slipDetected).toBe(true);
    expect(input.slipReason).toBe("archetype-unresolved");
    expect(input.idempotencyKeySuffix).toBe("archetype-unresolved");
    expect(input.rationale).toMatch(/not onboarded/i);
    expect(() => validateGearInterfaceInput(input)).not.toThrow();
  });
});
