import { describe, expect, it } from "vitest";
import { deriveReviewLenses } from "@/lib/build/review-lenses";
import type {
  FeatureBuildRow,
  ReviewResult,
  TaskResult,
} from "@/lib/feature-build-types";

function review(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    decision: "pass",
    issues: [],
    summary: "",
    ...overrides,
  };
}

function task(title: string, codeReviewDecision: "pass" | "fail"): TaskResult {
  return {
    taskIndex: 0,
    title,
    testResult: { passed: true, output: "" },
    codeReview: review({ decision: codeReviewDecision }),
  };
}

function build(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    planReview: null,
    designReview: null,
    taskResults: null,
    uxTestResults: null,
    verificationOut: null,
    acceptanceMet: null,
    ...overrides,
  } as unknown as FeatureBuildRow;
}

function lensByKey(rows: ReturnType<typeof deriveReviewLenses>, key: string) {
  return rows.find((l) => l.key === key);
}

describe("deriveReviewLenses — checklist lens", () => {
  it("is pending with 'not yet reviewed' when no review exists", () => {
    const l = lensByKey(deriveReviewLenses(build()), "checklist");
    expect(l).toMatchObject({ state: "pending", detail: "not yet reviewed" });
  });

  it("is pending with 'review unavailable' on a parse error", () => {
    const l = lensByKey(
      deriveReviewLenses(build({ planReview: review({ parseError: true }) })),
      "checklist",
    );
    expect(l).toMatchObject({ state: "pending", detail: "review unavailable" });
  });

  it("fails with a severity summary when the review decision is fail", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          planReview: review({
            decision: "fail",
            issues: [
              { severity: "critical", description: "x" },
              { severity: "critical", description: "y" },
              { severity: "important", description: "z" },
            ],
          }),
        }),
      ),
      "checklist",
    );
    expect(l).toMatchObject({ state: "fail", detail: "2 critical · 1 important" });
  });

  it("passes as 'cleared' with no issues", () => {
    const l = lensByKey(
      deriveReviewLenses(build({ planReview: review({ decision: "pass" }) })),
      "checklist",
    );
    expect(l).toMatchObject({ state: "pass", detail: "cleared" });
  });

  it("passes as 'cleared · N minor' when minor issues remain on a pass", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          planReview: review({
            decision: "pass",
            issues: [{ severity: "minor", description: "nit" }],
          }),
        }),
      ),
      "checklist",
    );
    expect(l).toMatchObject({ state: "pass", detail: "cleared · 1 minor" });
  });

  it("appends a round suffix when the review iterated", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({ planReview: review({ decision: "pass", iteration: { round: 3 } }) }),
      ),
      "checklist",
    );
    expect(l?.detail).toBe("cleared · round 3");
  });

  it("marks an oscillating iteration with ↻", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          planReview: review({
            decision: "fail",
            issues: [{ severity: "critical", description: "x" }],
            iteration: { round: 4, oscillating: true },
          }),
        }),
      ),
      "checklist",
    );
    expect(l?.detail).toBe("1 critical · round 4 ↻");
  });

  it("falls back to designReview when planReview is absent", () => {
    const l = lensByKey(
      deriveReviewLenses(build({ designReview: review({ decision: "pass" }) })),
      "checklist",
    );
    expect(l?.state).toBe("pass");
  });
});

describe("deriveReviewLenses — architecture advisory lens", () => {
  it("is omitted when no architecture advisory ran", () => {
    expect(lensByKey(deriveReviewLenses(build()), "architecture")).toBeUndefined();
  });

  it("renders as advisory with a note count", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          planReview: review({
            architectureAdvisory: {
              summary: "s",
              issues: [
                { severity: "important", description: "a" },
                { severity: "minor", description: "b" },
              ],
            },
          }),
        }),
      ),
      "architecture",
    );
    expect(l).toMatchObject({ state: "advisory", detail: "2 notes" });
  });

  it("renders 'aligned' when the advisory has zero issues", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({ planReview: review({ architectureAdvisory: { summary: "s", issues: [] } }) }),
      ),
      "architecture",
    );
    expect(l).toMatchObject({ state: "advisory", detail: "aligned" });
  });
});

describe("deriveReviewLenses — code review lens", () => {
  it("is omitted when there are no task results", () => {
    expect(lensByKey(deriveReviewLenses(build()), "code-review")).toBeUndefined();
  });

  it("passes as 'N/N clean' when every task's code review passed", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({ taskResults: [task("a", "pass"), task("b", "pass")] }),
      ),
      "code-review",
    );
    expect(l).toMatchObject({ state: "pass", detail: "2/2 clean" });
  });

  it("fails with a flagged count when any task's code review failed", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({ taskResults: [task("a", "pass"), task("b", "fail"), task("c", "fail")] }),
      ),
      "code-review",
    );
    expect(l).toMatchObject({ state: "fail", detail: "2/3 tasks flagged" });
  });
});

describe("deriveReviewLenses — UX lens", () => {
  it("is omitted when no UX checks were recorded", () => {
    expect(lensByKey(deriveReviewLenses(build()), "ux")).toBeUndefined();
  });

  it("passes when all recorded checks passed", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          uxTestResults: [
            { step: "a", passed: true, screenshotUrl: null, error: null },
            { step: "b", passed: true, screenshotUrl: null, error: null },
          ],
        }),
      ),
      "ux",
    );
    expect(l).toMatchObject({ state: "pass", detail: "2/2 passed" });
  });

  it("fails when any check did not pass", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          uxTestResults: [
            { step: "a", passed: true, screenshotUrl: null, error: null },
            { step: "b", passed: false, screenshotUrl: null, error: "boom" },
          ],
        }),
      ),
      "ux",
    );
    expect(l).toMatchObject({ state: "fail", detail: "1/2 passed" });
  });
});

describe("deriveReviewLenses — verification lens", () => {
  it("is pending when verification has not run", () => {
    const l = lensByKey(deriveReviewLenses(build()), "verification");
    expect(l).toMatchObject({ state: "pending", detail: "not run" });
  });

  it("passes when typecheck passed and no tests failed", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          verificationOut: {
            testsPassed: 10,
            testsFailed: 0,
            typecheckPassed: true,
            fullOutput: "",
            timestamp: "",
          },
        }),
      ),
      "verification",
    );
    expect(l).toMatchObject({ state: "pass", detail: "typecheck ✓ · tests ✓" });
  });

  it("fails with 'typecheck ✗' when typecheck failed", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          verificationOut: {
            testsPassed: 0,
            testsFailed: 0,
            typecheckPassed: false,
            fullOutput: "",
            timestamp: "",
          },
        }),
      ),
      "verification",
    );
    expect(l).toMatchObject({ state: "fail", detail: "typecheck ✗" });
  });

  it("fails with a failing-test count when typecheck passed but tests failed", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          verificationOut: {
            testsPassed: 8,
            testsFailed: 2,
            typecheckPassed: true,
            fullOutput: "",
            timestamp: "",
          },
        }),
      ),
      "verification",
    );
    expect(l).toMatchObject({ state: "fail", detail: "2 tests failing" });
  });
});

describe("deriveReviewLenses — acceptance lens", () => {
  it("is omitted when no acceptance criteria are recorded", () => {
    expect(lensByKey(deriveReviewLenses(build()), "acceptance")).toBeUndefined();
  });

  it("passes when all criteria are met", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          acceptanceMet: [
            { criterion: "a", met: true, evidence: "" },
            { criterion: "b", met: true, evidence: "" },
          ],
        }),
      ),
      "acceptance",
    );
    expect(l).toMatchObject({ state: "pass", detail: "2/2 met" });
  });

  it("is partial when some criteria are unmet", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          acceptanceMet: [
            { criterion: "a", met: true, evidence: "" },
            { criterion: "b", met: false, evidence: "" },
          ],
        }),
      ),
      "acceptance",
    );
    expect(l).toMatchObject({ state: "partial", detail: "1/2 met" });
  });
});

describe("deriveReviewLenses — composition", () => {
  it("returns only the always-on spine (checklist + verification) for a bare build", () => {
    const keys = deriveReviewLenses(build()).map((l) => l.key);
    expect(keys).toEqual(["checklist", "verification"]);
  });

  it("orders lenses by review-gate lineage", () => {
    const keys = deriveReviewLenses(
      build({
        planReview: review({
          decision: "pass",
          architectureAdvisory: { summary: "s", issues: [] },
        }),
        taskResults: [task("a", "pass")],
        uxTestResults: [{ step: "a", passed: true, screenshotUrl: null, error: null }],
        verificationOut: {
          testsPassed: 1,
          testsFailed: 0,
          typecheckPassed: true,
          fullOutput: "",
          timestamp: "",
        },
        acceptanceMet: [{ criterion: "a", met: true, evidence: "" }],
      }),
    ).map((l) => l.key);
    expect(keys).toEqual([
      "checklist",
      "architecture",
      "code-review",
      "ux",
      "verification",
      "acceptance",
    ]);
  });
});

describe("deriveReviewLenses — per-reviewer graduation", () => {
  const reviewers = [
    {
      source: "reviewer-1" as const,
      label: "Primary review",
      role: "reviewer" as const,
      decision: "pass" as const,
      issueCounts: { critical: 0, important: 0, minor: 0 },
    },
    {
      source: "reviewer-2" as const,
      label: "Independent review",
      role: "reviewer" as const,
      decision: "fail" as const,
      issueCounts: { critical: 1, important: 0, minor: 1 },
    },
    {
      source: "architect" as const,
      label: "Architecture",
      role: "architect" as const,
      decision: "pass" as const,
      issueCounts: { critical: 0, important: 2, minor: 0 },
    },
  ];

  it("expands the merged checklist chip into one chip per named reviewer", () => {
    const keys = deriveReviewLenses(build({ planReview: review({ reviewers }) })).map((l) => l.key);
    expect(keys).toEqual([
      "reviewer:reviewer-1",
      "reviewer:reviewer-2",
      "reviewer:architect",
      "verification",
    ]);
    // The merged checklist + architectureAdvisory lenses are replaced, not added.
    expect(keys).not.toContain("checklist");
    expect(keys).not.toContain("architecture");
  });

  it("maps reviewer decision + severity to chip state and detail", () => {
    const lenses = deriveReviewLenses(build({ planReview: review({ reviewers }) }));
    expect(lensByKey(lenses, "reviewer:reviewer-1")).toMatchObject({ state: "pass", detail: "cleared" });
    expect(lensByKey(lenses, "reviewer:reviewer-2")).toMatchObject({
      state: "fail",
      detail: "1 critical · 1 minor",
    });
    // architect role is always advisory, never gating, regardless of decision
    expect(lensByKey(lenses, "reviewer:architect")).toMatchObject({ state: "advisory", detail: "2 notes" });
  });

  it("shows 'review unavailable' for a parse-error reviewer verdict", () => {
    const l = lensByKey(
      deriveReviewLenses(
        build({
          planReview: review({
            reviewers: [
              {
                source: "reviewer-1",
                label: "Primary review",
                role: "reviewer",
                decision: "fail",
                issueCounts: { critical: 0, important: 0, minor: 0 },
                parseError: true,
              },
            ],
          }),
        }),
      ),
      "reviewer:reviewer-1",
    );
    expect(l).toMatchObject({ state: "pending", detail: "review unavailable" });
  });

  it("falls back to the merged checklist lens when reviewers[] is absent (older rows)", () => {
    const keys = deriveReviewLenses(build({ planReview: review({ decision: "pass" }) })).map((l) => l.key);
    expect(keys).toContain("checklist");
    expect(keys).not.toContain("reviewer:reviewer-1");
  });
});
