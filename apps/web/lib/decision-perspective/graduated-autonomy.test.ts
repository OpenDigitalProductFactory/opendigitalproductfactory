import { describe, it, expect } from "vitest";
import {
  deriveTransitionRiskTier,
  graduatedGateOutcome,
  isAutonomyCandidate,
} from "./graduated-autonomy";

describe("deriveTransitionRiskTier", () => {
  it("low sensitivity graduates by transition consequence", () => {
    expect(deriveTransitionRiskTier({ sensitivity: "low", transition: "ideate-start" })).toBe("low");
    expect(deriveTransitionRiskTier({ sensitivity: "low", transition: "plan-advance" })).toBe("low");
    // ship floors at medium — shipping code is never low-risk
    expect(deriveTransitionRiskTier({ sensitivity: "low", transition: "ship" })).toBe("medium");
  });

  it("elevated sensitivity sits a tier higher and bumps for ship", () => {
    expect(deriveTransitionRiskTier({ sensitivity: "elevated", transition: "ideate-start" })).toBe("low");
    expect(deriveTransitionRiskTier({ sensitivity: "elevated", transition: "plan-advance" })).toBe("medium");
    expect(deriveTransitionRiskTier({ sensitivity: "elevated", transition: "ship" })).toBe("high");
  });

  it("high sensitivity never drops below high (always escalates), and ship pushes critical", () => {
    expect(deriveTransitionRiskTier({ sensitivity: "high", transition: "ideate-start" })).toBe("high");
    expect(deriveTransitionRiskTier({ sensitivity: "high", transition: "plan-advance" })).toBe("high");
    expect(deriveTransitionRiskTier({ sensitivity: "high", transition: "ship" })).toBe("critical");
  });

  it("plan-advance for elevated stays medium — byte-compatible with the old fixed-medium gate", () => {
    // The old gate hardcoded medium; an elevated-sensitivity plan advance keeps
    // medium under graduation, so the common case is unchanged.
    expect(deriveTransitionRiskTier({ sensitivity: "elevated", transition: "plan-advance" })).toBe("medium");
  });
});

describe("graduatedGateOutcome", () => {
  it("auto-proceeds on recommend and arbitrate", () => {
    expect(graduatedGateOutcome("recommend")).toEqual({ autoProceed: true, requiresHuman: false, reason: "recommend" });
    expect(graduatedGateOutcome("arbitrate")).toEqual({ autoProceed: true, requiresHuman: false, reason: "arbitrate" });
  });

  it("requires a human on escalate and defer", () => {
    expect(graduatedGateOutcome("escalate").requiresHuman).toBe(true);
    expect(graduatedGateOutcome("escalate").autoProceed).toBe(false);
    expect(graduatedGateOutcome("defer").requiresHuman).toBe(true);
  });
});

describe("isAutonomyCandidate", () => {
  it("is true only at or below medium risk", () => {
    expect(isAutonomyCandidate("low")).toBe(true);
    expect(isAutonomyCandidate("medium")).toBe(true);
    expect(isAutonomyCandidate("high")).toBe(false);
    expect(isAutonomyCandidate("critical")).toBe(false);
  });
});
