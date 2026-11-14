import { describe, expect, it } from "vitest";

import { checkVerificationDepthSatisfied } from "./verification-depth-requirement";
import { evaluateVerificationDepthShadow } from "./verification-depth-shadow";

// BI-4FF872FB. verificationOut is produced during the build phase, so at
// ideate->plan and plan->build it is structurally absent. Asserting on it
// there produced a guaranteed false block: 250 of 250 shadow records on the
// canonical runtime, every one at ideate->plan, every one blocking on a
// typecheck that could not yet exist.
//
// Decision DI-A940A9467E9E chose the phase-aware check (option B) over
// scoping the requirement to post-build transitions (option A), so a later
// phase can add earlier-transition evidence without re-scoping.

const green = { typecheckPassed: true, testsPassed: 1, testsFailed: 0,
  testsExecuted: true, testsApplicable: true, testCommandPassed: true, testSummariesComplete: true, testsQualified: true };

describe("BI-57AF5162: required test qualification", () => {
  it("does not treat unknown, unrun tests as satisfying shallow verification", () => {
    expect(checkVerificationDepthSatisfied({
      verificationDepth: "shallow", transition: "build->review",
      verificationOut: { typecheckPassed: true, testsPassed: 0, testsFailed: 0,
        scope: "none", testsExecuted: false, testsApplicable: null, testsQualified: false },
    })).toMatchObject({ allowed: false, evaluable: true });
  });

  it("does not clear a retained QA conflict merely because the deterministic counters are zero", () => {
    expect(checkVerificationDepthSatisfied({
      verificationDepth: "shallow", transition: "build->review",
      verificationOut: { typecheckPassed: true, testsPassed: 0, testsFailed: 0,
        testsExecuted: false, testsApplicable: false, testsQualified: false,
        testEvidenceConflict: true, reportedQa: { testsFailed: 3 } },
    })).toMatchObject({ allowed: false, evaluable: true });
  });

  it("keeps a positively established no-test exemption distinct from unknown scope", () => {
    expect(checkVerificationDepthSatisfied({
      verificationDepth: "shallow", transition: "build->review",
      verificationOut: { typecheckPassed: true, testsPassed: 0, testsFailed: 0,
        scope: "none", testsExecuted: false, testsApplicable: false, testsQualified: true },
    })).toEqual({ allowed: true, evaluable: true });
  });

  it("preserves the policy cells that do not require test depth", () => {
    expect(checkVerificationDepthSatisfied({
      verificationDepth: "none", transition: "build->review",
      verificationOut: { typecheckPassed: true, testsPassed: 0, testsFailed: 0,
        testsQualified: false, testEvidenceConflict: true },
    })).toMatchObject({ allowed: true });
  });
});

describe("verification depth is phase-aware", () => {
  describe("transitions where verificationOut cannot exist yet", () => {
    for (const transition of ["ideate->plan", "plan->build"] as const) {
      for (const verificationDepth of ["shallow", "deep"] as const) {
        it(`${transition} at ${verificationDepth} does not block on absent verification`, () => {
          expect(checkVerificationDepthSatisfied({ verificationDepth, transition }))
            .toEqual({ allowed: true, evaluable: false });
        });
      }
    }

    it("reports not-yet-evaluable rather than a pass, so the ledger can tell them apart", () => {
      const notYet = evaluateVerificationDepthShadow("ideate", "plan", {
        kind: "fix",
        processSize: "medium",
        verificationDepth: "deep",
      });
      expect(notYet).toMatchObject({
        transition: "ideate->plan",
        declaredDepth: "deep",
        wouldBlock: false,
        evaluable: false,
      });
    });
  });

  describe("transitions where verificationOut exists — the depth table still bites", () => {
    it("blocks at shallow on a failed typecheck", () => {
      expect(checkVerificationDepthSatisfied({
        verificationDepth: "shallow",
        transition: "build->review",
        verificationOut: { typecheckPassed: false, testsFailed: 0 },
      })).toMatchObject({ allowed: false, evaluable: true });
    });

    it("blocks at shallow on non-zero testsFailed", () => {
      expect(checkVerificationDepthSatisfied({
        verificationDepth: "shallow",
        transition: "review->ship",
        verificationOut: { typecheckPassed: true, testsFailed: 3 },
      })).toMatchObject({ allowed: false, evaluable: true });
    });

    it("blocks at shallow when verificationOut is absent at a transition that should have it", () => {
      expect(checkVerificationDepthSatisfied({
        verificationDepth: "shallow",
        transition: "build->review",
      })).toMatchObject({ allowed: false, evaluable: true });
    });

    it("allows at shallow on green verification", () => {
      expect(checkVerificationDepthSatisfied({
        verificationDepth: "shallow",
        transition: "build->review",
        verificationOut: green,
      })).toEqual({ allowed: true, evaluable: true });
    });

    it("still requires a mechanical real-path verdict at deep", () => {
      expect(checkVerificationDepthSatisfied({
        verificationDepth: "deep",
        transition: "review->ship",
        verificationOut: green,
      })).toMatchObject({ allowed: false, evaluable: true });

      expect(checkVerificationDepthSatisfied({
        verificationDepth: "deep",
        transition: "review->ship",
        verificationOut: green,
        goldenJourneyResult: { journeyId: "journey-1", passed: true },
      })).toEqual({ allowed: true, evaluable: true });
    });
  });

  describe("none and absent depth are untouched at every transition", () => {
    for (const transition of ["ideate->plan", "plan->build", "build->review", "review->ship"] as const) {
      for (const verificationDepth of [undefined, "none"] as const) {
        it(`${transition} with ${verificationDepth ?? "absent"} depth allows regardless of evidence`, () => {
          expect(checkVerificationDepthSatisfied({
            verificationDepth,
            transition,
            verificationOut: { typecheckPassed: false, testsFailed: 9 },
          })).toMatchObject({ allowed: true });
        });
      }
    }
  });

  it("an unknown or absent transition stays conservative and evaluates the full table", () => {
    expect(checkVerificationDepthSatisfied({
      verificationDepth: "shallow",
      verificationOut: { typecheckPassed: true, testsFailed: 1 },
    })).toMatchObject({ allowed: false, evaluable: true });
  });
});
