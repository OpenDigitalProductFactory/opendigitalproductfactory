import { describe, it, expect } from "vitest";
import { isOneShotEligible, oneShotLaneDecision, type OneShotLaneInput } from "./one-shot-lane";

const base: OneShotLaneInput = {
  workType: "feature",
  effortSize: "small",
  sensitivity: "low",
  gateOutcome: "recommend",
  oraclesGreen: true,
};

describe("isOneShotEligible", () => {
  it("is true for the ideal case (small low-sens feature, gate recommends, oracles green)", () => {
    expect(isOneShotEligible(base)).toBe(true);
    expect(isOneShotEligible({ ...base, effortSize: "medium" })).toBe(true);
    expect(isOneShotEligible({ ...base, workType: "fix" })).toBe(true);
    expect(isOneShotEligible({ ...base, gateOutcome: "arbitrate" })).toBe(true);
  });

  it("disqualifies large/xlarge sizes", () => {
    expect(isOneShotEligible({ ...base, effortSize: "large" })).toBe(false);
    expect(isOneShotEligible({ ...base, effortSize: "xlarge" })).toBe(false);
  });

  it("disqualifies non-feature/fix work", () => {
    expect(isOneShotEligible({ ...base, workType: "chore" })).toBe(false);
    expect(isOneShotEligible({ ...base, workType: "doc" })).toBe(false);
  });

  it("disqualifies any non-low sensitivity", () => {
    expect(isOneShotEligible({ ...base, sensitivity: "elevated" })).toBe(false);
    expect(isOneShotEligible({ ...base, sensitivity: "high" })).toBe(false);
  });

  it("disqualifies when oracles are not green", () => {
    expect(isOneShotEligible({ ...base, oraclesGreen: false })).toBe(false);
  });

  it("disqualifies when the gate does not auto-proceed", () => {
    expect(isOneShotEligible({ ...base, gateOutcome: "escalate" })).toBe(false);
    expect(isOneShotEligible({ ...base, gateOutcome: "defer" })).toBe(false);
  });

  it("is fail-safe on missing fields", () => {
    expect(isOneShotEligible({ ...base, workType: null })).toBe(false);
    expect(isOneShotEligible({ ...base, effortSize: null })).toBe(false);
  });
});

describe("oneShotLaneDecision", () => {
  it("selects one-shot with a reason for the ideal case", () => {
    const d = oneShotLaneDecision(base);
    expect(d.lane).toBe("one-shot");
    expect(d.reason).toContain("auto-proceeds");
  });

  it("names the first failing precondition", () => {
    expect(oneShotLaneDecision({ ...base, effortSize: "large" }).reason).toContain("size");
    expect(oneShotLaneDecision({ ...base, sensitivity: "high" }).reason).toContain("sensitivity");
    expect(oneShotLaneDecision({ ...base, oraclesGreen: false }).reason).toContain("oracles");
    expect(oneShotLaneDecision({ ...base, gateOutcome: "escalate" }).reason).toContain("auto-proceed");
    expect(oneShotLaneDecision({ ...base, workType: "chore" }).reason).toContain("work type");
  });

  it("defaults to the standard lane (never one-shot) when any precondition fails", () => {
    expect(oneShotLaneDecision({ ...base, oraclesGreen: false }).lane).toBe("standard");
  });
});
