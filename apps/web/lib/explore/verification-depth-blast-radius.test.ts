import { describe, expect, it } from "vitest";

import {
  BUILD_PROCESS_SIZES,
  BUILD_PROCESS_TYPE_VALUES,
  getProcessPolicy,
  type BuildProcessSize,
  type BuildProcessType,
} from "./build-process-matrix";
import { checkVerificationDepthSatisfied } from "./verification-depth-requirement";
import { checkPhaseGate, normalizeHappyPathState, type BuildPhase } from "./feature-build-types";

/**
 * BLAST RADIUS OF THE VERIFICATION-DEPTH BINDING.
 *
 * Phase 2 of the verification-first workroom gates plan exists to size this
 * before Phase 3 binds anything. The live shadow ledger cannot supply it — the
 * build pipeline is dormant and has never recorded a decision at build->review
 * or review->ship — so the measurement is taken exhaustively instead: every
 * (kind x processSize x transition x declared depth) cell, against the
 * verificationOut shapes that actually occur in the canonical runtime.
 *
 * "Newly blocks" means the cell's gate ALLOWS today and the depth requirement
 * would refuse it. That is exactly the set Phase 3 would be turning on.
 *
 * This test pins the result. If the depth check changes, the numbers move here
 * first and the diff says which cells moved.
 */

const TRANSITIONS: Array<[BuildPhase, BuildPhase]> = [
  ["ideate", "plan"],
  ["plan", "build"],
  ["build", "review"],
  ["review", "ship"],
];

const DEPTHS = ["none", "shallow", "deep"] as const;

/** verificationOut shapes observed on live builds (BI-397F87A9 documents the
 *  producer divergence: four key sets across six builds, only typecheckPassed
 *  common to all). */
const EVIDENCE_PROFILES = {
  "canonical-green": { typecheckPassed: true, testsFailed: 0 },
  "canonical-typecheck-failed": { typecheckPassed: false, testsFailed: 0 },
  "canonical-tests-failed": { typecheckPassed: true, testsFailed: 1185 },
  "nested-tests-green": { typecheckPassed: true, typecheck: "pass", tests: { failed: 0, passed: 7 } },
  "contradictory-not-run": { typecheckPassed: true, typecheck: "not_run", tests: { failed: 0, passed: 0 } },
  absent: undefined,
} as const;

type ProfileName = keyof typeof EVIDENCE_PROFILES;

/** Everything else satisfied, so the only thing under test is the depth check. */
function greenEvidence(kind: BuildProcessType, processSize: BuildProcessSize, profile: ProfileName) {
  return {
    kind,
    processSize,
    designDoc: { problemStatement: "x" },
    designReview: { decision: "pass" },
    buildPlan: { tasks: [] },
    planReview: { decision: "pass" },
    fixContext: {
      reproSteps: "Submit /contact",
      expected: "Success toast",
      actual: "500 error",
      rootCause: "Null deref",
      fixApproach: "Guard the optional field",
    },
    acceptanceMet: true,
    uxVerificationStatus: "complete",
    uxTestResults: [{ step: "open the page", passed: true }],
    happyPathState: normalizeHappyPathState({
      intake: {
        status: "ready",
        taxonomyNodeId: "tax-1",
        backlogItemId: "BI-1",
        epicId: "EP-1",
        constrainedGoal: "Ship a thing",
      },
    }),
    verificationOut: EVIDENCE_PROFILES[profile],
  };
}

type Cell = {
  kind: BuildProcessType;
  processSize: BuildProcessSize;
  transition: string;
  depth: (typeof DEPTHS)[number];
  profile: ProfileName;
  allowedToday: boolean;
  newlyBlocks: boolean;
  notYetEvaluable: boolean;
};

function enumerateCells(): Cell[] {
  const cells: Cell[] = [];
  for (const kind of BUILD_PROCESS_TYPE_VALUES) {
    for (const processSize of BUILD_PROCESS_SIZES) {
      for (const [from, to] of TRANSITIONS) {
        const transition = `${from}->${to}`;
        for (const depth of DEPTHS) {
          for (const profile of Object.keys(EVIDENCE_PROFILES) as ProfileName[]) {
            const evidence = greenEvidence(kind, processSize, profile);
            const today = checkPhaseGate(from, to, evidence);
            const depthResult = checkVerificationDepthSatisfied({
              ...evidence,
              verificationDepth: depth,
              transition,
            });
            cells.push({
              kind,
              processSize,
              transition,
              depth,
              profile,
              allowedToday: today.allowed,
              newlyBlocks: today.allowed && !depthResult.allowed,
              notYetEvaluable: !depthResult.evaluable,
            });
          }
        }
      }
    }
  }
  return cells;
}

describe("verification-depth binding — blast radius", () => {
  const cells = enumerateCells();

  it("covers the whole matrix", () => {
    // 4 kinds x 4 sizes x 4 transitions x 3 depths x 6 evidence profiles
    expect(cells).toHaveLength(4 * 4 * 4 * 3 * 6);
  });

  it("shows where today's gate already refuses, so 'newly' means newly", () => {
    const refusedToday = cells.filter((c) => !c.allowedToday);
    // Only build->review refuses today, and only for the two shapes whose
    // typecheckPassed is false or absent — that is verification-typecheck-passed
    // doing its job. 16 (kind,size) x 3 depths x 2 profiles.
    expect(refusedToday).toHaveLength(16 * 3 * 2);
    expect([...new Set(refusedToday.map((c) => c.transition))]).toEqual(["build->review"]);
    expect([...new Set(refusedToday.map((c) => c.profile))].sort())
      .toEqual(["absent", "canonical-typecheck-failed"]);
    // review->ship has NO typecheck requirement today. That asymmetry is why
    // the depth binding tightens more at ship than at review.
  });

  it("never newly blocks at depth none — the back-compat floor", () => {
    expect(cells.filter((c) => c.depth === "none" && c.newlyBlocks)).toEqual([]);
  });

  it("never newly blocks before the build phase produces verification evidence", () => {
    const early = cells.filter((c) =>
      c.transition === "ideate->plan" || c.transition === "plan->build");
    expect(early.filter((c) => c.newlyBlocks)).toEqual([]);
    // and those cells are reported not-yet-evaluable rather than as passes
    expect(early.filter((c) => c.depth !== "none").every((c) => c.notYetEvaluable)).toBe(true);
  });

  it("is insensitive to kind and processSize — the matrix gives no leverage over it", () => {
    const byCell = new Map<string, Set<boolean>>();
    for (const c of cells) {
      const key = `${c.transition}|${c.depth}|${c.profile}`;
      if (!byCell.has(key)) byCell.set(key, new Set());
      byCell.get(key)!.add(c.newlyBlocks);
    }
    // Every (transition, depth, profile) resolves the same way for all 16
    // (kind, size) cells: the depth check reads neither axis.
    expect([...byCell.values()].every((s) => s.size === 1)).toBe(true);
  });

  it("pins which evidence profiles newly block at the post-build transitions", () => {
    const post = cells.filter((c) =>
      (c.transition === "build->review" || c.transition === "review->ship") && c.depth !== "none");
    const blocking = new Set(post.filter((c) => c.newlyBlocks).map((c) => c.profile));
    expect([...blocking].sort()).toEqual([
      "absent",
      "canonical-tests-failed",
      "canonical-typecheck-failed",
      "contradictory-not-run",
      "nested-tests-green",
    ]);
    // canonical-green is the ONLY production shape that clears the bar, at
    // either depth. Three of the five blocked shapes are spurious or
    // contradictory rather than genuine quality failures — BI-397F87A9,
    // BI-E4E70B9A.
    const clears = new Set(post.filter((c) => !c.newlyBlocks && c.allowedToday).map((c) => c.profile));
    expect([...clears]).toEqual(["canonical-green"]);
  });

  it("quantifies how much of the new blocking is spurious", () => {
    const newly = cells.filter((c) => c.newlyBlocks);
    const byProfile = (name: ProfileName) => newly.filter((c) => c.profile === name).length;

    // Genuine quality refusals — the binding working as designed.
    expect(byProfile("canonical-tests-failed")).toBe(64); // 1185 tests failed
    expect(byProfile("canonical-typecheck-failed")).toBe(32); // already refused at build->review
    expect(byProfile("absent")).toBe(32); // no verification evidence at all

    // SPURIOUS: zero failed tests and a passing typecheck, refused only because
    // the count lives under `tests.failed` instead of `testsFailed`
    // (BI-397F87A9).
    expect(byProfile("nested-tests-green")).toBe(64);

    // Refused for the right outcome but the wrong reason: nothing ran, yet
    // typecheckPassed reads true (BI-E4E70B9A). The depth check catches it by
    // accident, via the tests arm, not the typecheck arm.
    expect(byProfile("contradictory-not-run")).toBe(64);

    // A quarter of everything Phase 3 would turn on is a false positive.
    expect(byProfile("nested-tests-green") / newly.length).toBeCloseTo(0.25, 5);
  });

  it("reports the headline blast radius", () => {
    const newly = cells.filter((c) => c.newlyBlocks);
    expect(newly).toHaveLength(256);
    expect(cells).toHaveLength(1152);
    // Every one of them is post-build; none at ideate->plan or plan->build.
    expect([...new Set(newly.map((c) => c.transition))].sort())
      .toEqual(["build->review", "review->ship"]);
    expect([...new Set(newly.map((c) => c.depth))].sort()).toEqual(["deep", "shallow"]);
  });

  it("every policy cell still omits the requirement — this remains shadow-only", () => {
    for (const kind of BUILD_PROCESS_TYPE_VALUES) {
      for (const size of BUILD_PROCESS_SIZES) {
        for (const required of Object.values(getProcessPolicy(kind, size).gates)) {
          expect(required).not.toContain("verification-depth-satisfied");
        }
      }
    }
  });
});
