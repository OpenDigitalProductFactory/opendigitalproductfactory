import { describe, expect, it } from "vitest";

import { compileGoldenTrianglePolicy } from "./compile";
import type { GoldenTrianglePreference } from "./types";

const BALANCED: GoldenTrianglePreference = {
  costWeight: 1 / 3,
  qualityWeight: 1 / 3,
  timeWeight: 1 / 3,
  preset: "balanced",
};

const FRUGAL: GoldenTrianglePreference = {
  costWeight: 0.8,
  qualityWeight: 0.1,
  timeWeight: 0.1,
  preset: "frugal",
};

function compile(taskClass: string, preference = BALANCED) {
  return compileGoldenTrianglePolicy({
    preference,
    taskClass,
    authorityScope: { kind: "wwmd" },
  });
}

// EP-WORK-POSTURE (BI-B32E8C32). `taskClass` was a REQUIRED field on
// CompileInput, threaded through every caller, and never read — compiling with
// different task classes returned byte-identical policy, and every live caller
// passed the literal "conversation". These tests are the difference between a
// contract field and an input.

describe("taskClass is a live input", () => {
  it("different task classes no longer compile identically", () => {
    const conversation = compile("conversation");
    const outward = compile("outward-review");
    expect(JSON.stringify(outward)).not.toBe(JSON.stringify(conversation));
  });

  it("outward-facing work raises the tier floor and demands deep verification", () => {
    const decoded = compile("outward-review");
    expect(decoded.postureOverride.minimumTier).toBe("strong");
    expect(decoded.orchestrationBudget.verificationDepth).toBe("deep");
    expect(decoded.adjustments.map((a) => a.reasonCode)).toContain("task_class_tier_floor");
  });

  it("a sign-off gate demands verification, at shallow depth", () => {
    const decoded = compile("approval-sign-off");
    expect(decoded.orchestrationBudget.verificationDepth).toBe("shallow");
  });

  it("a consequential change raises the tier floor without demanding verification", () => {
    const decoded = compile("change-consequential");
    expect(decoded.postureOverride.minimumTier).toBe("strong");
    expect(decoded.orchestrationBudget.verificationDepth).toBeUndefined();
  });
});

describe("taskClass can only tighten", () => {
  it("does not lower a floor the preset already set higher", () => {
    // Assured already asks for frontier; outward-review must not drop it to strong.
    const assured = compileGoldenTrianglePolicy({
      preference: { costWeight: 0.1, qualityWeight: 0.8, timeWeight: 0.1, preset: "assured" },
      taskClass: "outward-review",
      authorityScope: { kind: "wwmd" },
    });
    expect(assured.postureOverride.minimumTier).toBe("frontier");
    expect(assured.orchestrationBudget.verificationDepth).toBe("deep");
  });

  it("raises a frugal posture rather than letting it run cheap on outward work", () => {
    // The point of the floor: a cost-first operator cannot buy a cheaper run for
    // work that leaves the business.
    const frugal = compile("outward-review", FRUGAL);
    expect(frugal.postureOverride.minimumTier).toBe("strong");
    expect(frugal.orchestrationBudget.verificationDepth).toBe("deep");
  });
});

describe("Balanced-inert is preserved", () => {
  it("an unrecognised task class contributes nothing", () => {
    const decoded = compile("conversation");
    expect(decoded.postureOverride).toEqual({});
    expect(decoded.orchestrationBudget).toEqual({});
    expect(decoded.adjustments).toEqual([]);
  });

  it("every unmapped class compiles exactly as the default does", () => {
    const baseline = JSON.stringify(compile("conversation"));
    for (const taskClass of ["code-gen", "specialist-alignment", "escalation", "", "unknown"]) {
      expect(JSON.stringify(compile(taskClass)), `${taskClass} drifted`).toBe(baseline);
    }
  });
});
