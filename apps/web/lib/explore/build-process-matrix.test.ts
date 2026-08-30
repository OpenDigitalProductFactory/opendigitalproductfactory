import { describe, expect, it } from "vitest";
import {
  BUILD_PROCESS_TYPE_VALUES,
  BUILD_PROCESS_SIZES,
  GATE_REQUIREMENTS,
  checkRequirement,
  DELIVERABLE_SENSITIVITIES,
  deriveBuildProcessSize,
  deriveBuildProcessType,
  deriveDeliverableSensitivity,
  mapBuildDeliverableToRoutingSensitivity,
  describePolicy,
  getModelTier,
  getProcessPolicy,
  normalizeSize,
  normalizeType,
  type BuildProcessSize,
  type BuildProcessType,
} from "./build-process-matrix";
import { evaluateVerificationDepthShadow } from "./verification-depth-shadow";
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

describe("verification-depth-satisfied — shadow requirement", () => {
  const greenVerification = {
    testsPassed: 12,
    testsFailed: 0,
    typecheckPassed: true,
    fullOutput: "green",
    timestamp: "2026-08-29T00:00:00.000Z",
  };

  it("keeps absent and none byte-identical across absent, present, and failed evidence", () => {
    const failedVerification = { ...greenVerification, testsFailed: 2, typecheckPassed: false };
    for (const verificationDepth of [undefined, "none"] as const) {
      expect(checkRequirement("verification-depth-satisfied", { verificationDepth })).toEqual({ allowed: true });
      expect(checkRequirement("verification-depth-satisfied", {
        verificationDepth,
        verificationOut: greenVerification,
      })).toEqual({ allowed: true });
      expect(checkRequirement("verification-depth-satisfied", {
        verificationDepth,
        verificationOut: failedVerification,
        uxVerificationStatus: "failed",
      })).toEqual({ allowed: true });
    }
  });

  it("requires a green typecheck and zero failed tests at shallow depth", () => {
    expect(checkRequirement("verification-depth-satisfied", {
      verificationDepth: "shallow",
      verificationOut: greenVerification,
    })).toEqual({ allowed: true });
    expect(checkRequirement("verification-depth-satisfied", { verificationDepth: "shallow" })).toMatchObject({ allowed: false });
    expect(checkRequirement("verification-depth-satisfied", {
      verificationDepth: "shallow",
      verificationOut: { typecheckPassed: true },
    })).toMatchObject({ allowed: false });
    expect(checkRequirement("verification-depth-satisfied", {
      verificationDepth: "shallow",
      verificationOut: { ...greenVerification, testsFailed: 1 },
    })).toMatchObject({ allowed: false });
    expect(checkRequirement("verification-depth-satisfied", {
      verificationDepth: "shallow",
      verificationOut: { ...greenVerification, typecheckPassed: false },
    })).toMatchObject({ allowed: false });
  });

  it("requires shallow evidence plus a mechanical real-path verdict at deep depth", () => {
    expect(checkRequirement("verification-depth-satisfied", {
      verificationDepth: "deep",
      verificationOut: greenVerification,
      uxVerificationStatus: "complete",
      uxTestResults: [{ step: "Open the affected route", passed: true }],
    })).toEqual({ allowed: true });
    expect(checkRequirement("verification-depth-satisfied", {
      verificationDepth: "deep",
      verificationOut: greenVerification,
    })).toMatchObject({ allowed: false });
    expect(checkRequirement("verification-depth-satisfied", {
      verificationDepth: "deep",
      verificationOut: greenVerification,
      uxVerificationStatus: "failed",
      uxTestResults: [{ step: "Open the affected route", passed: false }],
    })).toMatchObject({ allowed: false });
  });

  it("accepts a passing golden-journey result as deep real-path evidence", () => {
    expect(checkRequirement("verification-depth-satisfied", {
      verificationDepth: "deep",
      verificationOut: greenVerification,
      goldenJourneyResult: { journeyId: "journey-1", passed: true },
    })).toEqual({ allowed: true });
  });

  it("evaluates every transition in shadow without adding the requirement to a policy", () => {
    for (const type of BUILD_PROCESS_TYPE_VALUES) {
      for (const size of BUILD_PROCESS_SIZES) {
        const policy = getProcessPolicy(type, size);
        for (const requirements of Object.values(policy.gates)) {
          expect(requirements).not.toContain("verification-depth-satisfied");
        }
      }
    }
    expect(GATE_REQUIREMENTS).toContain("verification-depth-satisfied");

    const decision = evaluateVerificationDepthShadow("review", "ship", {
      kind: "feature",
      processSize: "medium",
      verificationDepth: "shallow",
      verificationOut: { ...greenVerification, testsFailed: 3 },
    });
    expect(decision).toMatchObject({
      transition: "review->ship",
      kind: "feature",
      processSize: "medium",
      declaredDepth: "shallow",
      wouldBlock: true,
    });
  });

  it("does not alter the default gate verdict for absent or none depth", () => {
    const evidence = {
      designDoc: { problemStatement: "x" },
      buildPlan: { tasks: [] },
      acceptanceMet: true,
      verificationOut: { ...greenVerification, testsFailed: 4 },
      uxVerificationStatus: "failed",
    };
    const today = checkPhaseGate("review", "ship", evidence);
    for (const kind of [undefined, "feature"] as const) {
      for (const processSize of [undefined, "medium"] as const) {
        for (const verificationDepth of [undefined, "none"] as const) {
          const result = checkPhaseGate("review", "ship", {
            ...evidence,
            kind,
            processSize,
            verificationDepth,
          });
          expect(JSON.stringify(result)).toBe(JSON.stringify(today));
        }
      }
    }
    expect(today).toEqual({ allowed: true });
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

describe("getModelTier (EP-MODEL-TIER-ROUTING)", () => {
  it("routes small + medium work to the local tier", () => {
    expect(getModelTier("feature", "small")).toBe("local");
    expect(getModelTier("feature", "medium")).toBe("local");
    expect(getModelTier("fix", "small")).toBe("local");
    expect(getModelTier("doc", "medium")).toBe("local");
  });
  it("routes large + xlarge work to the robust tier", () => {
    expect(getModelTier("feature", "large")).toBe("robust");
    expect(getModelTier("feature", "xlarge")).toBe("robust");
    expect(getModelTier("fix", "large")).toBe("robust");
    expect(getModelTier("chore", "xlarge")).toBe("robust");
  });
  it("defaults absent/unknown size to medium → local (back-compat)", () => {
    expect(getModelTier("feature", null)).toBe("local");
    expect(getModelTier("feature", undefined)).toBe("local");
    expect(getModelTier(null, "bogus")).toBe("local");
  });
});

// ─── EP-QUALITY-RIGHTSIZING: quality-first + sensitivity axis ────────────────

describe("DELIVERABLE_SENSITIVITIES", () => {
  it("is a closed low/elevated/high ordinal", () => {
    expect(DELIVERABLE_SENSITIVITIES).toEqual(["low", "elevated", "high"]);
  });
});

describe("deriveDeliverableSensitivity", () => {
  it("flags auth/billing/security/kernel keywords as high", () => {
    expect(deriveDeliverableSensitivity({ text: "Add OAuth login + password reset" })).toBe("high");
    expect(deriveDeliverableSensitivity({ text: "Fix the billing invoice charge bug" })).toBe("high");
    expect(deriveDeliverableSensitivity({ text: "Harden the decision kernel governance gate" })).toBe("high");
    expect(deriveDeliverableSensitivity({ text: "Encrypt customer PII at rest" })).toBe("high");
  });
  it("flags integration/schema keywords as elevated", () => {
    expect(deriveDeliverableSensitivity({ text: "Add a Prisma migration for the new schema" })).toBe("elevated");
    expect(deriveDeliverableSensitivity({ text: "Wire an outbound webhook integration" })).toBe("elevated");
  });
  it("defaults benign copy to low", () => {
    expect(deriveDeliverableSensitivity({ text: "Tweak the dashboard card spacing" })).toBe("low");
    expect(deriveDeliverableSensitivity({ text: "" })).toBe("low");
  });
  it("treats a conservative org posture as a floor (low → elevated) but never lowers", () => {
    expect(deriveDeliverableSensitivity({ text: "spacing tweak" }, "conservative")).toBe("elevated");
    expect(deriveDeliverableSensitivity({ text: "OAuth token" }, "conservative")).toBe("high");
    expect(deriveDeliverableSensitivity({ text: "spacing tweak" }, "balanced")).toBe("low");
    expect(deriveDeliverableSensitivity({ text: "spacing tweak" }, "progressive")).toBe("low");
  });
});

describe("getModelTier — quality-first opts (byte-identical without)", () => {
  it("is unchanged (size-based) when no opts are supplied", () => {
    expect(getModelTier("feature", "small")).toBe("local");
    expect(getModelTier("feature", "medium")).toBe("local");
    expect(getModelTier("feature", "large")).toBe("robust");
  });
  it("inert opts (qualityFirst off, no sensitivity) stay size-based", () => {
    expect(getModelTier("feature", "small", { qualityFirst: false })).toBe("local");
  });
  it("quality-first routes substantive work to robust, trivial tail stays local", () => {
    expect(getModelTier("feature", "small", { qualityFirst: true })).toBe("robust");
    expect(getModelTier("feature", "medium", { qualityFirst: true })).toBe("robust");
    expect(getModelTier("doc", "small", { qualityFirst: true })).toBe("local"); // trivial tail
    expect(getModelTier("chore", "small", { qualityFirst: true })).toBe("local"); // trivial tail
    expect(getModelTier("doc", "medium", { qualityFirst: true })).toBe("robust"); // not trivial
  });
  it("a HIGH-sensitivity deliverable is always robust regardless of size/type", () => {
    expect(getModelTier("doc", "small", { sensitivity: "high" })).toBe("robust");
    expect(getModelTier("feature", "small", { qualityFirst: false, sensitivity: "high" })).toBe("robust");
  });
});

describe("getProcessPolicy — monotonic escalation (byte-identical without)", () => {
  it("returns the exact base cell with no/inert opts", () => {
    const base = getProcessPolicy("feature", "medium");
    expect(getProcessPolicy("feature", "medium", undefined)).toBe(base);
    expect(getProcessPolicy("feature", "medium", { sensitivity: "low" })).toBe(base);
    expect(getProcessPolicy("feature", "medium", { qualityFirst: false })).toBe(base);
  });
  it("quality-first bumps the substantive cell's review (standard → thorough), trivial tail stays light", () => {
    expect(getProcessPolicy("feature", "medium").reviewIntensity).toBe("standard");
    expect(getProcessPolicy("feature", "medium", { qualityFirst: true }).reviewIntensity).toBe("thorough");
    // doc/small is minimal — quality-first leaves the trivial tail alone.
    expect(getProcessPolicy("doc", "small", { qualityFirst: true }).reviewIntensity).toBe("minimal");
  });
  it("HIGH sensitivity escalates to full phases + thorough review, monotonically", () => {
    const escalated = getProcessPolicy("chore", "small", { sensitivity: "high" });
    expect(escalated.phases).toEqual(["ideate", "plan", "build", "review", "ship"]);
    expect(escalated.reviewIntensity).toBe("thorough");
    // Union of gates — the chore/small ideate->plan (empty) gains the feature-full set.
    expect(escalated.gates["ideate->plan"]).toContain("designDoc-present");
  });
  it("never lowers a base that is already thorough/full (monotonic)", () => {
    const base = getProcessPolicy("feature", "large"); // already thorough
    const escalated = getProcessPolicy("feature", "large", { qualityFirst: true });
    expect(escalated.reviewIntensity).toBe("thorough");
    expect(escalated.phases).toEqual(base.phases);
  });
});

describe("checkPhaseGate — honors threaded sensitivity (byte-identical without)", () => {
  it("a chore/small ideate->plan auto-passes today (no rightsizing evidence)", () => {
    expect(checkPhaseGate("ideate", "plan", { kind: "chore", processSize: "small" }).allowed).toBe(true);
  });
  it("a HIGH-sensitivity chore/small ideate->plan now demands the escalated gates", () => {
    const result = checkPhaseGate("ideate", "plan", {
      kind: "chore",
      processSize: "small",
      deliverableSensitivity: "high",
    });
    expect(result.allowed).toBe(false); // designDoc-present now required
  });
});

// Static type checks — these don't run at runtime but force compilation
// errors if BuildProcessType / BuildProcessSize drift.
const _typeCheck = (): BuildProcessType => "feature";
const _sizeCheck = (): BuildProcessSize => "medium";
void _typeCheck;
void _sizeCheck;

describe("mapBuildDeliverableToRoutingSensitivity", () => {
  // Founder ruling (2026-08-12): platform source-code generation is development
  // work, not internal business data. Ordinary builds route at the least-
  // sensitive `development` tier so connected frontier cloud dev tools (cleared for
  // public, never internal business data) are eligible; builds whose brief
  // signals real business-data sensitivity keep the internal/confidential gates.
  it("maps low deliverable sensitivity to development (unblocks cloud dev tools)", () => {
    expect(mapBuildDeliverableToRoutingSensitivity("low")).toBe("development");
  });
  it("escalates elevated to internal and high to confidential", () => {
    expect(mapBuildDeliverableToRoutingSensitivity("elevated")).toBe("internal");
    expect(mapBuildDeliverableToRoutingSensitivity("high")).toBe("confidential");
  });
});

// BI-B24D4C84: the Build Studio dispatch callers (ideate-on-approval,
// plan-on-approval) used to call getModelTier WITHOUT opts, so they took the
// legacy size-only branch and pinned every small/medium build to the `local`
// tier. That forces residencyPolicy=local_only downstream, which excluded every
// cloud engine — and on an install whose only active local model missed the
// code-gen quality floor, NO small or medium build could dispatch at all.
// These assertions pin the distinction the callers depend on.
describe("getModelTier rightsizing opts (BI-B24D4C84)", () => {
  it("legacy call (no opts) still routes small/medium to local — byte-identical contract", () => {
    expect(getModelTier("bug", "small")).toBe("local");
    expect(getModelTier("feature", "medium")).toBe("local");
    expect(getModelTier("feature", "large")).toBe("robust");
  });

  it("quality-first routes substantive small/medium work to robust", () => {
    expect(getModelTier("bug", "small", { qualityFirst: true, sensitivity: "low" })).toBe("robust");
    expect(getModelTier("feature", "medium", { qualityFirst: true, sensitivity: "low" })).toBe("robust");
  });

  it("keeps the trivial doc/chore tail local so cheap work stays cheap", () => {
    expect(getModelTier("doc", "small", { qualityFirst: true, sensitivity: "low" })).toBe("local");
    expect(getModelTier("chore", "small", { qualityFirst: true, sensitivity: "low" })).toBe("local");
  });

  it("high sensitivity escalates to robust regardless of size", () => {
    expect(getModelTier("doc", "small", { qualityFirst: true, sensitivity: "high" })).toBe("robust");
  });
});
