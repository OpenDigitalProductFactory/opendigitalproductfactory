import { describe, expect, it } from "vitest";
import {
  BUILD_PROCESS_TYPE_VALUES,
  BUILD_PROCESS_SIZES,
  deriveBuildProcessSize,
  deriveBuildProcessType,
  describePolicy,
  getProcessPolicy,
  normalizeSize,
  normalizeType,
  type BuildProcessSize,
  type BuildProcessType,
} from "./build-process-matrix";
import { checkPhaseGate, normalizeHappyPathState, type FixContext } from "./feature-build-types";

// The right-sizing matrix maps (type, size) -> a LifecyclePolicy. These tests
// pin three contracts the spec calls out:
//   1. The default cell (feature, medium) is byte-identical to today's
//      checkPhaseGate behavior.
//   2. Small fixes / chores / docs get *less* ceremony, not different
//      ceremony, than the default cell.
//   3. derive* functions are the single read site for the parallel unified-BI
//      work-type branch; today they read source/effortSize fields.

const readyHappyPath = normalizeHappyPathState({
  intake: {
    status: "ready",
    taxonomyNodeId: "tax-1",
    backlogItemId: "BI-1",
    epicId: "EP-1",
    constrainedGoal: "Ship a thing",
  },
});

const completeFixContext: FixContext = {
  reproSteps: "Submit /contact",
  expected: "Success toast",
  actual: "500 error",
  rootCause: "Null deref",
  fixApproach: "Guard the optional field",
};

describe("BUILD_PROCESS_TYPE_VALUES", () => {
  it("is a closed enum of four canonical work types", () => {
    expect(BUILD_PROCESS_TYPE_VALUES).toEqual(["feature", "fix", "chore", "doc"]);
  });
});

describe("BUILD_PROCESS_SIZES", () => {
  it("mirrors the BacklogItem effortSize ordinal", () => {
    expect(BUILD_PROCESS_SIZES).toEqual(["small", "medium", "large", "xlarge"]);
  });
});

describe("normalizeType / normalizeSize", () => {
  it("normalizes absent/unknown type to feature", () => {
    expect(normalizeType(null)).toBe("feature");
    expect(normalizeType(undefined)).toBe("feature");
    expect(normalizeType("")).toBe("feature");
    expect(normalizeType("gibberish")).toBe("feature");
    expect(normalizeType("feature")).toBe("feature");
    expect(normalizeType("fix")).toBe("fix");
    expect(normalizeType("chore")).toBe("chore");
    expect(normalizeType("doc")).toBe("doc");
  });

  it("normalizes absent/unknown size to medium", () => {
    expect(normalizeSize(null)).toBe("medium");
    expect(normalizeSize(undefined)).toBe("medium");
    expect(normalizeSize("")).toBe("medium");
    expect(normalizeSize("xxl")).toBe("medium");
    expect(normalizeSize("small")).toBe("small");
    expect(normalizeSize("xlarge")).toBe("xlarge");
  });
});

describe("deriveBuildProcessType — workType-to-kind mapping", () => {
  it("maps workType=bug to fix", () => {
    expect(deriveBuildProcessType({ workType: "bug", body: null })).toBe("fix");
  });

  it("maps workType=doc to doc", () => {
    expect(deriveBuildProcessType({ workType: "doc", body: null })).toBe("doc");
  });

  it("maps workType=chore to chore", () => {
    expect(deriveBuildProcessType({ workType: "chore", body: null })).toBe("chore");
  });

  it("maps the feature-shaped workTypes to feature (feature | tool | skill | refactor)", () => {
    expect(deriveBuildProcessType({ workType: "feature", body: null })).toBe("feature");
    expect(deriveBuildProcessType({ workType: "tool", body: null })).toBe("feature");
    expect(deriveBuildProcessType({ workType: "skill", body: null })).toBe("feature");
    expect(deriveBuildProcessType({ workType: "refactor", body: null })).toBe("feature");
  });

  it("legacy unclassified-row fallback: body-line chore marker still detected when workType is NULL", () => {
    expect(deriveBuildProcessType({ workType: null, body: "chore: bump react to 18.4" })).toBe("chore");
    expect(deriveBuildProcessType({ workType: null, body: "Chore: rename internal helpers" })).toBe("chore");
  });

  it("defaults to feature when workType is NULL and no body marker matches (back-compat)", () => {
    expect(deriveBuildProcessType({ workType: null, body: null })).toBe("feature");
    expect(deriveBuildProcessType({ workType: null, body: "Some unrelated body" })).toBe("feature");
  });
});

describe("deriveBuildProcessSize", () => {
  it("reads effortSize verbatim when known", () => {
    expect(deriveBuildProcessSize({ effortSize: "small" })).toBe("small");
    expect(deriveBuildProcessSize({ effortSize: "xlarge" })).toBe("xlarge");
  });

  it("defaults to medium for null / unknown", () => {
    expect(deriveBuildProcessSize({ effortSize: null })).toBe("medium");
    expect(deriveBuildProcessSize({ effortSize: "huge" })).toBe("medium");
  });
});

describe("getProcessPolicy — matrix coverage", () => {
  it("returns a policy for every (type, size) combination", () => {
    for (const type of BUILD_PROCESS_TYPE_VALUES) {
      for (const size of BUILD_PROCESS_SIZES) {
        const policy = getProcessPolicy(type, size);
        expect(policy.label).toBeTruthy();
        expect(policy.phases.length).toBeGreaterThan(0);
        expect(policy.promptVariant).toBeTruthy();
      }
    }
  });

  it("default (feature, medium) is the byte-identical baseline cell", () => {
    const policy = getProcessPolicy("feature", "medium");
    expect(policy.phases).toEqual(["ideate", "plan", "build", "review", "ship"]);
    expect(policy.promptVariant).toBe("feature");
    expect(policy.reviewIntensity).toBe("standard");
    // ideate->plan requires designDoc + designReview + intake
    expect(policy.gates["ideate->plan"]).toEqual([
      "designDoc-present",
      "designReview-passed",
      "happyPathIntake-ready",
    ]);
  });

  it("fix-small merges ideate+plan ceremony (no portfolio intake)", () => {
    const policy = getProcessPolicy("fix", "small");
    // ideate->plan only needs fixContext + non-failed review
    expect(policy.gates["ideate->plan"]).toEqual([
      "fixContext-complete",
      "designReview-not-failed-if-present",
    ]);
    // plan->build does not require planReview (merged)
    expect(policy.gates["plan->build"]).toEqual(["buildPlan-present"]);
    // review->ship skips acceptance evaluation for small fixes
    expect(policy.gates["review->ship"]?.includes("acceptance-evaluated")).toBe(false);
  });

  it("chore-small drops ideate entirely and skips review-phase acceptance ceremony", () => {
    const policy = getProcessPolicy("chore", "small");
    expect(policy.phases).not.toContain("ideate");
    expect(policy.phases).not.toContain("review");
    expect(policy.promptVariant).toBe("chore");
    expect(policy.gates["ideate->plan"]).toEqual([]);
    expect(policy.gates["review->ship"]?.includes("acceptance-evaluated")).toBe(false);
  });

  it("doc-small drops ideate and runs plan->build->ship without acceptance/UX", () => {
    const policy = getProcessPolicy("doc", "small");
    expect(policy.phases).not.toContain("ideate");
    expect(policy.promptVariant).toBe("doc");
    expect(policy.gates["review->ship"]?.includes("acceptance-evaluated")).toBe(false);
  });

  it("xlarge routes everything to the decomposition gate", () => {
    for (const type of BUILD_PROCESS_TYPE_VALUES) {
      const policy = getProcessPolicy(type, "xlarge");
      // The xlarge cell is feature-shaped (full lifecycle) and demands the
      // same evidence as a thorough feature — the operator-facing label and
      // the design-time decomposition gate carry the "decompose first" intent.
      expect(policy.phases).toContain("ideate");
      expect(policy.phases).toContain("plan");
    }
  });
});

describe("checkPhaseGate via the matrix — back-compat invariant", () => {
  // These cases mirror feature-build-types.test.ts cases line-for-line. The
  // contract: with kind/processSize absent or set to feature/medium, the
  // matrix-driven gate returns the same decisions as the pre-matrix gate.

  it("blocks ideate->plan without designDoc (default cell)", () => {
    const result = checkPhaseGate("ideate", "plan", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("design document");
  });

  it("blocks ideate->plan when design review failed (default cell)", () => {
    const result = checkPhaseGate("ideate", "plan", {
      designDoc: { problemStatement: "x" },
      designReview: { decision: "fail" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Design review failed");
  });

  it("allows ideate->plan with all default-cell evidence present", () => {
    const result = checkPhaseGate("ideate", "plan", {
      designDoc: { problemStatement: "x" },
      designReview: { decision: "pass" },
      happyPathState: readyHappyPath,
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks build->review when typecheck fails (default cell)", () => {
    const result = checkPhaseGate("build", "review", {
      verificationOut: { testsPassed: 0, testsFailed: 0, typecheckPassed: false, fullOutput: "", timestamp: "" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Typecheck");
  });

  it("allows any phase to failed (no gate)", () => {
    expect(checkPhaseGate("build", "failed", {}).allowed).toBe(true);
  });

  it("allows review->build backward transition (no gate)", () => {
    expect(checkPhaseGate("review", "build", {}).allowed).toBe(true);
  });
});

describe("checkPhaseGate via the matrix — right-sizing deltas", () => {
  it("fix-small ideate->plan allows on fixContext alone (no design doc, no intake)", () => {
    const result = checkPhaseGate("ideate", "plan", {
      kind: "fix",
      processSize: "small",
      fixContext: completeFixContext,
    });
    expect(result.allowed).toBe(true);
  });

  it("fix-medium ideate->plan still allows on fixContext (designReview optional)", () => {
    const result = checkPhaseGate("ideate", "plan", {
      kind: "fix",
      processSize: "medium",
      fixContext: completeFixContext,
    });
    expect(result.allowed).toBe(true);
  });

  it("chore-small plan->build allows on buildPlan alone (no planReview required)", () => {
    const result = checkPhaseGate("plan", "build", {
      kind: "chore",
      processSize: "small",
      buildPlan: { fileStructure: [], tasks: [] },
    });
    expect(result.allowed).toBe(true);
  });

  it("doc-small plan->build allows on buildPlan alone", () => {
    const result = checkPhaseGate("plan", "build", {
      kind: "doc",
      processSize: "small",
      buildPlan: { fileStructure: [], tasks: [] },
    });
    expect(result.allowed).toBe(true);
  });

  it("chore-small review->ship does not require acceptance evaluation", () => {
    const result = checkPhaseGate("review", "ship", {
      kind: "chore",
      processSize: "small",
      buildPlan: { fileStructure: [], tasks: [] },
      // intentionally no acceptanceMet / acceptanceCriteria
    });
    expect(result.allowed).toBe(true);
  });

  it("fix-small review->ship does not require acceptance evaluation", () => {
    const result = checkPhaseGate("review", "ship", {
      kind: "fix",
      processSize: "small",
      fixContext: completeFixContext,
      buildPlan: { fileStructure: [], tasks: [] },
    });
    expect(result.allowed).toBe(true);
  });

  it("feature-medium review->ship still requires acceptanceMet (no regression)", () => {
    const result = checkPhaseGate("review", "ship", {
      kind: "feature",
      processSize: "medium",
      designDoc: { problemStatement: "x" },
      buildPlan: { fileStructure: [], tasks: [] },
      verificationOut: { testsPassed: 0, testsFailed: 0, typecheckPassed: true, fullOutput: "", timestamp: "" },
      // intentionally no acceptanceMet
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Acceptance criteria");
  });

  it("chore-small build->review still requires typecheck (defense in depth)", () => {
    const result = checkPhaseGate("build", "review", {
      kind: "chore",
      processSize: "small",
      verificationOut: { testsPassed: 0, testsFailed: 0, typecheckPassed: false, fullOutput: "", timestamp: "" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Typecheck");
  });
});

describe("describePolicy", () => {
  it("renders a human-readable summary of the default cell", () => {
    const summary = describePolicy("feature", "medium");
    expect(summary).toContain("Feature · standard");
    expect(summary).toContain("standard review");
    expect(summary).toContain("ideate");
  });

  it("renders a human-readable summary of fix-small (merged ceremony)", () => {
    const summary = describePolicy("fix", "small");
    expect(summary).toContain("Fix · merged");
    expect(summary).toContain("minimal review");
  });

  it("renders a human-readable summary of chore-small (no ideate, no review in phases)", () => {
    const summary = describePolicy("chore", "small");
    expect(summary).toContain("Chore · minimal");
    // "ideate" / "review" must not appear in the phases list. The
    // reviewIntensity label still includes the literal word "review"
    // (as in "minimal review"), so we assert against the phases portion.
    const phasesPortion = summary.split("phases:")[1] ?? "";
    expect(phasesPortion).not.toContain("ideate");
    expect(phasesPortion).not.toContain("review");
  });
});

// Static type checks — these don't run at runtime but force compilation
// errors if BuildProcessType / BuildProcessSize drift.
const _typeCheck = (): BuildProcessType => "feature";
const _sizeCheck = (): BuildProcessSize => "medium";
void _typeCheck;
void _sizeCheck;
