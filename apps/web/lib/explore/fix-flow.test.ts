import { describe, expect, it } from "vitest";
import {
  FEATURE_BUILD_KIND_VALUES,
  isFixContextComplete,
  checkPhaseGate,
  type FixContext,
} from "./feature-build-types";
import { getBuildPhasePrompt } from "@/lib/integrate/build-agent-prompts";

// The fix flow is the kind="fix" branch of the Build Studio pipeline. These
// tests pin the behavior the spec requires: a complete diagnosis substitutes
// for the feature design doc, taxonomy/epic anchors are not required for fixes,
// and the fix-phase prompts are distinct from the feature prompts while
// terminal phases keep their empty-prompt behavior.

const completeFix: FixContext = {
  reproSteps: "Submit the form on /portal/contact",
  expected: "Form submits and shows a success toast",
  actual: "500 error",
  rootCause: "Null deref in submitContact when phone is empty",
  fixApproach: "Guard the optional phone field before formatting",
};

describe("FEATURE_BUILD_KIND_VALUES", () => {
  it("is a closed two-value enum", () => {
    expect(FEATURE_BUILD_KIND_VALUES).toEqual(["feature", "fix"]);
  });
});

describe("isFixContextComplete", () => {
  it("requires repro, root cause, and fix approach", () => {
    expect(isFixContextComplete(completeFix)).toBe(true);
    expect(isFixContextComplete(null)).toBe(false);
    expect(isFixContextComplete(undefined)).toBe(false);
    expect(isFixContextComplete({ ...completeFix, rootCause: "" })).toBe(false);
    expect(isFixContextComplete({ reproSteps: "x" })).toBe(false);
  });
});

describe("checkPhaseGate — fix flow", () => {
  it("ideate→plan advances on a complete fixContext (no design doc, no taxonomy/epic)", () => {
    const result = checkPhaseGate("ideate", "plan", { kind: "fix", fixContext: completeFix });
    expect(result.allowed).toBe(true);
  });

  it("ideate→plan blocks when the fix diagnosis is incomplete", () => {
    const result = checkPhaseGate("ideate", "plan", {
      kind: "fix",
      fixContext: { ...completeFix, fixApproach: "" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/diagnosis/i);
  });

  it("ideate→plan blocks a fix when an explicit review failed", () => {
    const result = checkPhaseGate("ideate", "plan", {
      kind: "fix",
      fixContext: completeFix,
      designReview: { decision: "fail" },
    });
    expect(result.allowed).toBe(false);
  });

  it("feature ideate→plan still requires a design doc (no regression)", () => {
    expect(checkPhaseGate("ideate", "plan", { kind: "feature" }).allowed).toBe(false);
    // Absent kind defaults to feature behavior.
    expect(checkPhaseGate("ideate", "plan", {}).allowed).toBe(false);
  });

  it("plan→build does not require taxonomy/epic anchors for a fix", () => {
    const result = checkPhaseGate("plan", "build", {
      kind: "fix",
      buildPlan: { fileStructure: [], tasks: [] },
      planReview: { decision: "pass" },
      // intentionally no happyPathState anchors
    });
    expect(result.allowed).toBe(true);
  });

  it("review→ship accepts fixContext in place of a design doc for a fix", () => {
    const result = checkPhaseGate("review", "ship", {
      kind: "fix",
      fixContext: completeFix,
      buildPlan: { fileStructure: [], tasks: [] },
      verificationOut: { typecheckPassed: true },
      acceptanceMet: "verified",
      uxVerificationStatus: "skipped",
    });
    expect(result.allowed).toBe(true);
  });

  it("review→ship still blocks a feature with no design doc", () => {
    const result = checkPhaseGate("review", "ship", {
      kind: "feature",
      buildPlan: { fileStructure: [], tasks: [] },
      verificationOut: { typecheckPassed: true },
      acceptanceMet: "verified",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/design document/i);
  });
});

describe("getBuildPhasePrompt — fix variants", () => {
  it("returns a distinct, non-empty fix prompt for ideate/plan/review", async () => {
    for (const phase of ["ideate", "plan", "review"] as const) {
      const fix = await getBuildPhasePrompt(phase, "fix");
      const feature = await getBuildPhasePrompt(phase, "feature");
      expect(fix.length).toBeGreaterThan(0);
      expect(fix).not.toBe(feature);
    }
  });

  it("ideate-fix prompt frames the work as a defect, not a feature", async () => {
    const fix = await getBuildPhasePrompt("ideate", "fix");
    expect(fix.toLowerCase()).toContain("defect");
    expect(fix.toLowerCase()).not.toContain("design a new feature");
  });

  it("build phase falls through to the shared prompt for a fix", async () => {
    const fix = await getBuildPhasePrompt("build", "fix");
    const feature = await getBuildPhasePrompt("build", "feature");
    expect(fix).toBe(feature);
    expect(fix.length).toBeGreaterThan(0);
  });

  it("terminal phases keep empty-prompt behavior for both kinds", async () => {
    expect(await getBuildPhasePrompt("complete", "fix")).toBe("");
    expect(await getBuildPhasePrompt("failed", "fix")).toBe("");
  });
});
