import { describe, expect, it } from "vitest";
import {
  warrantToRightsizingOpts,
  resolveWarrantedPolicy,
  warrantToModelTier,
} from "./warrant-rightsizing-bridge";
import { getProcessPolicy } from "@/lib/explore/build-process-matrix";
import type { WorkWarrant, GateProfile, ModelTier } from "./work-warrant";

// Minimal warrant fixture — only the fields the bridge reads matter; the rest are
// filled with defensible defaults so the type is satisfied.
function warrant(overrides: { gateProfile?: GateProfile; modelTier?: ModelTier }): WorkWarrant {
  return {
    altitude: "WSID",
    altitudeBasis: "structural",
    confidence: "high",
    needsOperatorConfirm: false,
    lane: "autonomous-bs",
    budget: {
      modelTier: overrides.modelTier ?? "standard",
      effortLevel: "medium",
      gateProfile: overrides.gateProfile ?? "standard",
      tokenCeiling: null,
    },
    evidenceProfile: "standard",
    reportingProfile: "one-line",
    contextScope: {},
    reasons: [],
  };
}

describe("warrantToRightsizingOpts", () => {
  it("collapsed → inert opts (qualityFirst off, low sensitivity) — base cell unchanged", () => {
    expect(warrantToRightsizingOpts(warrant({ gateProfile: "collapsed" }))).toEqual({
      qualityFirst: false,
      sensitivity: "low",
    });
  });

  it("standard → qualityFirst + elevated", () => {
    expect(warrantToRightsizingOpts(warrant({ gateProfile: "standard" }))).toEqual({
      qualityFirst: true,
      sensitivity: "elevated",
    });
  });

  it("full → qualityFirst + high (deepest policy for the type)", () => {
    expect(warrantToRightsizingOpts(warrant({ gateProfile: "full" }))).toEqual({
      qualityFirst: true,
      sensitivity: "high",
    });
  });
});

describe("resolveWarrantedPolicy — the warrant drives the ONE existing engine", () => {
  it("collapsed warrant returns the byte-identical base cell (no escalation)", () => {
    const base = getProcessPolicy("feature", "small");
    const warranted = resolveWarrantedPolicy("feature", "small", warrant({ gateProfile: "collapsed" }));
    expect(warranted).toBe(base); // getProcessPolicy returns the same object when opts are inert
  });

  it("a full-gate (WWMD/high-blast) warrant escalates a SMALL build to thorough review", () => {
    const warranted = resolveWarrantedPolicy("feature", "small", warrant({ gateProfile: "full" }));
    expect(warranted.reviewIntensity).toBe("thorough");
  });

  it("rigor is monotonic in gate profile: full ≥ standard ≥ collapsed", () => {
    const rank = { minimal: 0, standard: 1, thorough: 2 } as const;
    const collapsed = resolveWarrantedPolicy("feature", "small", warrant({ gateProfile: "collapsed" }));
    const standard = resolveWarrantedPolicy("feature", "small", warrant({ gateProfile: "standard" }));
    const full = resolveWarrantedPolicy("feature", "small", warrant({ gateProfile: "full" }));
    expect(rank[standard.reviewIntensity]).toBeGreaterThanOrEqual(rank[collapsed.reviewIntensity]);
    expect(rank[full.reviewIntensity]).toBeGreaterThanOrEqual(rank[standard.reviewIntensity]);
  });
});

describe("warrantToModelTier — reconcile 3-tier budget with 2-tier engine", () => {
  it("economical → local", () => {
    expect(warrantToModelTier(warrant({ modelTier: "economical" }))).toBe("local");
  });
  it("standard → robust", () => {
    expect(warrantToModelTier(warrant({ modelTier: "standard" }))).toBe("robust");
  });
  it("strong → robust", () => {
    expect(warrantToModelTier(warrant({ modelTier: "strong" }))).toBe("robust");
  });
});
