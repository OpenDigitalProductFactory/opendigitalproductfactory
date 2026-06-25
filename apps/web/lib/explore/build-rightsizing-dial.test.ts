import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle/types";

import {
  DEFAULT_BUILD_POSTURE,
  coerceBuildPosture,
  resolveBuildSizing,
  sensitivityToTierFloor,
} from "./build-rightsizing-dial";

const QUALITY = DEFAULT_BUILD_POSTURE; // assured / quality-weighted
const COST: GoldenTrianglePreference = { preset: "frugal", costWeight: 0.8, qualityWeight: 0.1, timeWeight: 0.1 };
const SPEED: GoldenTrianglePreference = { preset: "fast", timeWeight: 0.8, costWeight: 0.1, qualityWeight: 0.1 };

describe("DEFAULT_BUILD_POSTURE", () => {
  it("is pinned to Quality (BI-9AF9595A)", () => {
    expect(DEFAULT_BUILD_POSTURE.preset).toBe("assured");
    expect(DEFAULT_BUILD_POSTURE.qualityWeight).toBeGreaterThan(DEFAULT_BUILD_POSTURE.costWeight);
    expect(DEFAULT_BUILD_POSTURE.qualityWeight).toBeGreaterThan(DEFAULT_BUILD_POSTURE.timeWeight);
  });
});

describe("sensitivityToTierFloor", () => {
  it("maps sensitivity to a compiler tier floor", () => {
    expect(sensitivityToTierFloor("high")).toBe("frontier");
    expect(sensitivityToTierFloor("elevated")).toBe("strong");
    expect(sensitivityToTierFloor("low")).toBeUndefined();
  });
});

describe("coerceBuildPosture", () => {
  it("accepts a well-formed preference", () => {
    expect(coerceBuildPosture(COST)).toEqual(COST);
  });
  it("rejects malformed input", () => {
    expect(coerceBuildPosture(null)).toBeNull();
    expect(coerceBuildPosture({ preset: "frugal" })).toBeNull(); // missing weights
    expect(coerceBuildPosture("frugal")).toBeNull();
    expect(coerceBuildPosture({ costWeight: 1, qualityWeight: 0, timeWeight: 0 })).toBeNull(); // missing preset
  });
});

describe("resolveBuildSizing — dial composes with the risk axis", () => {
  it("a Quality posture lifts a feature/medium build to robust + thorough", () => {
    const r = resolveBuildSizing({ type: "feature", size: "medium", posture: QUALITY, sensitivity: "low" });
    expect(r.modelTier).toBe("robust");
    expect(r.policy.reviewIntensity).toBe("thorough");
  });

  it("a Cost posture keeps a benign small build cheap (local)", () => {
    const r = resolveBuildSizing({ type: "feature", size: "small", posture: COST, sensitivity: "low" });
    expect(r.modelTier).toBe("local");
  });

  it("a Speed posture keeps a benign small build cheap (local)", () => {
    const r = resolveBuildSizing({ type: "feature", size: "small", posture: SPEED, sensitivity: "low" });
    expect(r.modelTier).toBe("local");
  });

  it("the risk axis FLOORS a Cost posture — a HIGH-sensitivity build can't be cheaped out", () => {
    const r = resolveBuildSizing({ type: "feature", size: "small", posture: COST, sensitivity: "high" });
    // Even with the cheapest dial, sensitivity forces robust + the deepest process.
    expect(r.modelTier).toBe("robust");
    expect(r.policy.reviewIntensity).toBe("thorough");
    expect(r.policy.phases).toEqual(["ideate", "plan", "build", "review", "ship"]);
  });

  it("an ELEVATED-sensitivity build is floored to robust even under a Cost dial", () => {
    const r = resolveBuildSizing({ type: "feature", size: "small", posture: COST, sensitivity: "elevated" });
    expect(r.modelTier).toBe("robust"); // strong floor → robust
  });

  it("is monotonic — never below the matrix/sensitivity baseline", () => {
    // A large feature is already thorough in the matrix; a Cost dial can't lower it.
    const r = resolveBuildSizing({ type: "feature", size: "large", posture: COST, sensitivity: "low" });
    expect(r.policy.reviewIntensity).toBe("thorough");
  });

  it("surfaces a plain-language posture explanation", () => {
    const r = resolveBuildSizing({ type: "feature", size: "medium", posture: QUALITY, sensitivity: "low" });
    expect(typeof r.postureExplanation).toBe("string");
    expect(r.postureExplanation.length).toBeGreaterThan(0);
  });
});
