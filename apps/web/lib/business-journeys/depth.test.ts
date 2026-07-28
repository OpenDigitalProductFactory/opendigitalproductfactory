import { describe, expect, it } from "vitest";
import {
  achievedDepth,
  checkedSentence,
  isSupportedDepth,
  uncheckedDepths,
  uncheckedSentence,
} from "./depth";
import type { JourneyStepResult, StepOutcome, VerificationDepth } from "./types";

function step(
  depth: VerificationDepth,
  outcome: StepOutcome,
  stepId = `${depth}-${outcome}`,
): JourneyStepResult {
  return { stepId, label: stepId, depth, outcome, detail: "", durationMs: 1 };
}

describe("achievedDepth — rule 1: weakest passing step caps the journey", () => {
  it("caps at reachability when a reachability step passed alongside deeper ones", () => {
    const steps = [
      step("reachability", "passed"),
      step("contract", "passed"),
      step("data-path", "passed"),
    ];
    // The deepest step passing does NOT make the journey data-path verified —
    // this is the whole point of the rule.
    expect(achievedDepth(steps)).toBe("reachability");
  });

  it("reports data-path only when every passing step reached data-path", () => {
    expect(achievedDepth([step("data-path", "passed"), step("data-path", "passed", "b")])).toBe(
      "data-path",
    );
  });

  it("ignores failed and skipped steps when computing the weakest depth", () => {
    const steps = [
      step("reachability", "failed"),
      step("contract", "skipped"),
      step("data-path", "passed"),
    ];
    expect(achievedDepth(steps)).toBe("data-path");
  });

  it("returns null when nothing passed — a failed run established nothing", () => {
    expect(achievedDepth([step("reachability", "failed")])).toBeNull();
    expect(achievedDepth([])).toBeNull();
  });
});

describe("uncheckedDepths — rule 2: everything above achieved is unchecked", () => {
  it("always leaves interaction unchecked, because P1 never drives a browser", () => {
    expect(uncheckedDepths("data-path")).toEqual(["interaction"]);
  });

  it("lists every deeper depth for a reachability-only journey", () => {
    expect(uncheckedDepths("reachability")).toEqual(["contract", "data-path", "interaction"]);
  });

  it("treats a run that established nothing as having checked nothing", () => {
    expect(uncheckedDepths(null)).toEqual([
      "reachability",
      "contract",
      "data-path",
      "interaction",
    ]);
  });
});

describe("owner-facing sentences", () => {
  it("never presents a reachability-only journey as functionally verified", () => {
    const achieved = achievedDepth([step("reachability", "passed")]);
    const checked = checkedSentence(achieved);
    const unchecked = uncheckedSentence(achieved);

    expect(checked).toBe("Checked: the page loads.");
    expect(unchecked).toContain("a real record can be created");
    expect(unchecked).toContain("a customer completing this in a browser");
    // The word "healthy" must never stand alone for a shallow verdict.
    expect(checked).not.toMatch(/healthy|verified|working/i);
  });

  it("still names the browser gap for the deepest supported journey", () => {
    expect(uncheckedSentence("data-path")).toBe(
      "Not checked: a customer completing this in a browser.",
    );
  });

  it("has no checked sentence when nothing passed", () => {
    expect(checkedSentence(null)).toBeNull();
  });
});

describe("isSupportedDepth", () => {
  it("marks interaction as beyond this slice", () => {
    expect(isSupportedDepth("interaction")).toBe(false);
    expect(isSupportedDepth("data-path")).toBe(true);
    expect(isSupportedDepth("reachability")).toBe(true);
  });
});
