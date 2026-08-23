import { describe, expect, it } from "vitest";

import {
  dampProactivityLevel,
  tightenActionBoundary,
  tightenMinimumTier,
  tightenProactivityLevel,
  tightenVerificationDepth,
  TIGHTEN_RANKS,
} from "./tighten";
import type {
  ProactivityActionBoundary,
  ProactivityLevel,
} from "@/lib/proactivity/proactivity-types";
import type { QualityTier } from "@/lib/routing/quality-tiers";
import type { VerificationDepth } from "@/lib/golden-triangle";

const LEVELS: ProactivityLevel[] = ["quiet", "balanced", "assertive"];
const BOUNDARIES: ProactivityActionBoundary[] = ["preauthorized", "propose", "advise"];
const TIERS: QualityTier[] = ["basic", "adequate", "strong", "frontier"];
const DEPTHS: VerificationDepth[] = ["none", "shallow", "deep"];

// These are exhaustive cross-product assertions rather than examples: the point
// of the tighten mechanism is that NO input pair can produce a widening result.

describe("tighten-only clamps", () => {
  it("proactivity never decreases", () => {
    for (const current of LEVELS) {
      for (const candidate of LEVELS) {
        const result = tightenProactivityLevel(current, candidate);
        expect(TIGHTEN_RANKS.proactivity[result]).toBeGreaterThanOrEqual(
          TIGHTEN_RANKS.proactivity[current],
        );
      }
    }
  });

  it("action boundary never becomes more permissive", () => {
    for (const current of BOUNDARIES) {
      for (const candidate of BOUNDARIES) {
        const result = tightenActionBoundary(current, candidate);
        expect(TIGHTEN_RANKS.boundary[result]).toBeGreaterThanOrEqual(
          TIGHTEN_RANKS.boundary[current],
        );
      }
    }
  });

  it("tier floor never drops", () => {
    for (const current of TIERS) {
      for (const candidate of TIERS) {
        const result = tightenMinimumTier(current, candidate)!;
        expect(TIGHTEN_RANKS.tier[result]).toBeGreaterThanOrEqual(TIGHTEN_RANKS.tier[current]);
      }
    }
  });

  it("verification depth never shallows", () => {
    for (const current of DEPTHS) {
      for (const candidate of DEPTHS) {
        const result = tightenVerificationDepth(current, candidate)!;
        expect(TIGHTEN_RANKS.verification[result]).toBeGreaterThanOrEqual(
          TIGHTEN_RANKS.verification[current],
        );
      }
    }
  });

  it("a null candidate is a no-op on every axis", () => {
    expect(tightenProactivityLevel("balanced", null)).toBe("balanced");
    expect(tightenActionBoundary("propose", null)).toBe("propose");
    expect(tightenMinimumTier("strong", null)).toBe("strong");
    expect(tightenVerificationDepth("shallow", null)).toBe("shallow");
    expect(tightenMinimumTier(undefined, null)).toBeUndefined();
    expect(tightenVerificationDepth(undefined, null)).toBeUndefined();
  });

  it("an undefined current takes the candidate on the optional axes", () => {
    expect(tightenMinimumTier(undefined, "adequate")).toBe("adequate");
    expect(tightenVerificationDepth(undefined, "shallow")).toBe("shallow");
  });
});

describe("damping", () => {
  it("lowers cadence by at most one step and bottoms out at quiet", () => {
    expect(dampProactivityLevel("assertive")).toBe("balanced");
    expect(dampProactivityLevel("balanced")).toBe("quiet");
    expect(dampProactivityLevel("quiet")).toBe("quiet");
  });

  it("is the only reducing operation — it takes and returns a level only", () => {
    // Guards the design invariant structurally: damping cannot reach the action
    // boundary, tier floor or verification depth because it has no access to them.
    expect(dampProactivityLevel.length).toBe(1);
  });
});
