import { describe, expect, it, vi } from "vitest";
import {
  FEATURE_BUILD_KIND_VALUES,
  isFixContextComplete,
  checkPhaseGate,
  deriveFixUxTestCases,
  type FixContext,
} from "./feature-build-types";
import { getBuildPhasePrompt } from "@/lib/integrate/build-agent-prompts";

vi.mock("@/lib/tak/prompt-loader", () => ({
  loadPrompt: vi.fn(
    async (
      _category: string,
      _slug: string,
      fallback?: string,
    ): Promise<string> => fallback ?? "",
  ),
}));

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
  it("is a closed enum that still contains feature and fix (extended for right-sizing)", () => {
    // The 2026-05-30 right-sizing matrix extends this enum with `chore` and
    // `doc`. The closed-enum guarantee is preserved — adding values still
    // requires updating mcp-tools.ts mirrors and the matrix at the same time.
    expect(FEATURE_BUILD_KIND_VALUES).toContain("feature");
    expect(FEATURE_BUILD_KIND_VALUES).toContain("fix");
    expect(FEATURE_BUILD_KIND_VALUES).toContain("chore");
    expect(FEATURE_BUILD_KIND_VALUES).toContain("doc");
    expect(FEATURE_BUILD_KIND_VALUES).toHaveLength(4);
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

describe("deriveFixUxTestCases — fix UX verification source (BI-AC5CFDB0)", () => {
  it("navigates to the affected route and asserts the defect is gone", () => {
    const cases = deriveFixUxTestCases({
      routeContext: "/admin/diagnostics",
      expected: "the diagnostics table renders",
      actual: "the page throws a runtime error",
    });
    expect(cases).toHaveLength(1);
    const assertion = cases[0]!;
    expect(assertion).toContain("Navigate to /admin/diagnostics");
    expect(assertion).toContain("the diagnostics table renders");
    expect(assertion).toContain("the page throws a runtime error");
    // Never emits a fixContext field name as a literal URL — that was the bug
    // (browser-use tried to visit `https://fixContext.reproSteps`).
    expect(assertion).not.toContain("fixContext");
    expect(assertion).not.toContain("https://");
  });

  it("works from expected-only context with no route", () => {
    const cases = deriveFixUxTestCases({ expected: "the form submits successfully" });
    expect(cases).toHaveLength(1);
    expect(cases[0]).not.toContain("Navigate to");
    expect(cases[0]).toContain("the form submits successfully");
  });

  it("returns [] when there's nothing browser-verifiable (caller skips UX)", () => {
    expect(deriveFixUxTestCases(null)).toEqual([]);
    expect(deriveFixUxTestCases(undefined)).toEqual([]);
    // a pure server/tool fix with diagnosis but no route or expected behavior
    expect(deriveFixUxTestCases({ rootCause: "off-by-one in parser", reproSteps: "call parse('')" })).toEqual([]);
  });

  it("does not leak the polluted feature acceptanceCriteria shape", () => {
    // Even with an empty/whitespace route, it must not produce a bare URL nav.
    const cases = deriveFixUxTestCases({ routeContext: "   ", expected: "ok" });
    expect(cases[0]).not.toContain("Navigate to    ");
  });
});
