import { describe, expect, it } from "vitest";

import {
  activityKindBiasFor,
  deriveStakesBias,
  deriveStreamBiases,
  deriveTemporalBias,
  modeBiasFor,
  shapeBiasFor,
} from "./derive";
import { TEMPORAL_BANDS } from "./temporal-band";

// The trap this file guards: `proactivityLevel` can only ever RAISE cadence
// (tighten.ts), so any bias that intends "be quieter" must express it as
// `damp`. A table entry that sets `proactivityLevel: "quiet"` compiles, reads
// naturally, and does nothing — the exact shape of dead control this epic
// exists to remove from the platform.

const ALL_SHAPE_KEYS = [
  "change-consequential",
  "approval-sign-off",
  "outward-review",
  "escalation",
  "specialist-alignment",
  "craft-stewardship",
];

const ALL_ACTIVITY_KINDS = [
  "remediation",
  "governance",
  "launch-readiness",
  "craft-judgment",
];

describe("derivation tables have no inert entries", () => {
  it("no shape bias expresses quiet as a proactivity level", () => {
    for (const key of ALL_SHAPE_KEYS) {
      const bias = shapeBiasFor(key);
      expect(bias, `${key} should resolve a bias`).not.toBeNull();
      expect(
        bias!.proactivityLevel,
        `${key} sets proactivityLevel "quiet", which the tighten-only clamps ignore — use damp instead`,
      ).not.toBe("quiet");
    }
  });

  it("no activity-kind bias expresses quiet as a proactivity level", () => {
    for (const kind of ALL_ACTIVITY_KINDS) {
      const bias = activityKindBiasFor(kind);
      expect(bias).not.toBeNull();
      expect(bias!.proactivityLevel).not.toBe("quiet");
    }
  });

  it("no temporal bias expresses quiet as a proactivity level", () => {
    for (const band of TEMPORAL_BANDS) {
      const bias = deriveTemporalBias(band);
      if (bias) expect(bias.proactivityLevel).not.toBe("quiet");
    }
  });

  it("every declared bias carries a stable reason code and a reason", () => {
    const biases = [
      ...ALL_SHAPE_KEYS.map((k) => shapeBiasFor(k)!),
      ...ALL_ACTIVITY_KINDS.map((k) => activityKindBiasFor(k)!),
      ...TEMPORAL_BANDS.map((b) => deriveTemporalBias(b)).filter((b) => b !== null),
      ...deriveStreamBiases({
        demandSignature: "emergency-reactive",
        capacityUnit: "slot-hours",
        loadBearingStageKeys: ["deliver"],
        stageKey: "deliver",
        trustGates: ["identity-verified"],
      }),
      modeBiasFor("standing", false)!,
    ];
    for (const bias of biases) {
      expect(bias.reasonCode).toMatch(/^[a-z0-9_]+$/);
      expect(bias.reason.length).toBeGreaterThan(0);
    }
  });

  it("every declared bias actually changes something", () => {
    for (const key of ALL_SHAPE_KEYS) {
      const bias = shapeBiasFor(key)!;
      const hasEffect =
        bias.proactivityLevel !== undefined ||
        bias.actionBoundary !== undefined ||
        bias.minimumTier !== undefined ||
        bias.verificationDepth !== undefined ||
        bias.priorityAxis !== undefined ||
        bias.damp === true;
      expect(hasEffect, `${key} declares a bias with no effect`).toBe(true);
    }
  });
});

describe("stream derivation", () => {
  it("returns nothing for an absent or steady stream", () => {
    expect(deriveStreamBiases(null)).toEqual([]);
    expect(deriveStreamBiases({ demandSignature: "steady" })).toEqual([]);
  });

  it("does not fire the load-bearing bias when the stage is not load-bearing", () => {
    expect(
      deriveStreamBiases({ loadBearingStageKeys: ["deliver"], stageKey: "attract" }),
    ).toEqual([]);
  });

  it("treats an empty trustGates list as no trust gate", () => {
    expect(deriveStreamBiases({ trustGates: [] })).toEqual([]);
  });
});

describe("build-rightsizing stakes derivation", () => {
  it("keeps absent and inert rightsizing facts byte-compatible", () => {
    expect(deriveStakesBias(null)).toBeNull();
    expect(deriveStakesBias({ qualityFirst: false, deliverableSensitivity: "low" })).toBeNull();
  });

  it("requires shallow verification for quality-first or elevated work", () => {
    expect(deriveStakesBias({ qualityFirst: true })?.verificationDepth).toBe("shallow");
    expect(deriveStakesBias({ deliverableSensitivity: "elevated" })?.verificationDepth).toBe("shallow");
  });

  it("requires deep verification for high-sensitivity work", () => {
    expect(deriveStakesBias({ deliverableSensitivity: "high" })?.verificationDepth).toBe("deep");
  });
});
