import { describe, it, expect } from "vitest";
import {
  buildDesignReviewPrompt,
  buildPlanReviewPrompt,
  buildCodeReviewPrompt,
  buildArchitectureReviewPrompt,
  ARCHITECTURE_REVIEW_REFERENCES,
  parseReviewResponse,
  applyTestFirstLenienceForKind,
  relaxTestFirstAfterRounds,
  extractClaimsFromReview,
  buildReviewBranchArtifacts,
  collectReviewerVerdicts,
  deriveReviewRiskLevel,
  artifactTypeForPhase,
  mapCompactSummaryToBuildEntry,
  type ReviewBranchInput,
} from "./build-reviewers";
import { architectureAdvisoryFromReview } from "./architecture-advisory-ledger";
import type { ReviewResult, BuildDesignDoc } from "@/lib/feature-build-types";

describe("buildDesignReviewPrompt", () => {
  it("includes all design doc sections", () => {
    const prompt = buildDesignReviewPrompt({
      problemStatement: "Users need filtering",
      existingCodeAudit: "No existing filter",
      reusePlan: "Reuse OpsClient pattern",
      proposedApproach: "Add checkbox filter",
      acceptanceCriteria: ["Filter hides done items", "Count shown"],
    }, "Test project");
    expect(prompt).toContain("Users need filtering");
    expect(prompt).toContain("Reuse OpsClient pattern");
    expect(prompt).toContain("Filter hides done items");
    expect(prompt).toContain("JSON FORMAT");
  });

  // BI-699EA362 — reviewDesignDoc crashed with "Cannot read properties of
  // undefined (reading 'map')" when the loosely-typed designDoc JSON carried a
  // reusabilityAnalysis that was a string, or an object missing its
  // domainEntities array (an operator-saved / migrated / partial doc — the exact
  // shape that wedged FB-8F8E2CE6 in ideate). The prompt builder must degrade
  // gracefully instead of throwing and leaving the build with no review verdict.
  it("does not throw and degrades gracefully when reusabilityAnalysis is malformed (BI-699EA362)", () => {
    // Object present but missing the domainEntities array -> Entities=none.
    const objPrompt = buildDesignReviewPrompt({
      problemStatement: "x",
      proposedApproach: "y",
      acceptanceCriteria: ["z"],
      reusabilityAnalysis: { scope: "parameterizable" },
    } as unknown as BuildDesignDoc, "ctx");
    expect(objPrompt).toContain("Entities=none");

    // reusabilityAnalysis stored as a bare string -> section omitted, no crash.
    const strPrompt = buildDesignReviewPrompt({
      problemStatement: "x",
      proposedApproach: "y",
      acceptanceCriteria: ["z"],
      reusabilityAnalysis: "parameterizable",
    } as unknown as BuildDesignDoc, "ctx");
    expect(strPrompt).toContain("JSON FORMAT");
    expect(strPrompt).not.toContain("Reusability Analysis");
  });

  it("gates on whole-outcome alignment per the Optimize for the Whole commandment", () => {
    const prompt = buildDesignReviewPrompt({
      problemStatement: "Users need filtering",
      existingCodeAudit: "No existing filter",
      reusePlan: "Reuse OpsClient pattern",
      proposedApproach: "Add checkbox filter",
      acceptanceCriteria: ["Filter hides done items"],
    }, "Test project");
    // The design review must ask which end-to-end outcome the change serves —
    // local correctness alone is not "done".
    expect(prompt).toContain("WHOLE-OUTCOME ALIGNMENT");
    expect(prompt).toContain("Optimize for the Whole");
  });

  // BI-CE49D82E — Delta-aware design review prompt, mirror of the plan path
  // added in BI-4396EFEC (D38). Live repro that drove this fix: FB-5E20E793
  // (Voice Slice 1.6) looped on the same "missing accessibility section"
  // complaint round after round because the reviewer re-evaluated from
  // scratch each call. Injecting the prior issues breaks the loop.
  describe("delta-aware prior context (BI-CE49D82E)", () => {
    const minimalDoc = {
      problemStatement: "Users need filtering",
      existingCodeAudit: "No existing filter",
      reusePlan: "Reuse OpsClient pattern",
      proposedApproach: "Add checkbox filter",
      acceptanceCriteria: ["Filter hides done items"],
    };

    it("omits prior-context block on round 1 (no prior issues)", () => {
      const prompt = buildDesignReviewPrompt(minimalDoc, "");
      expect(prompt).not.toContain("PRIOR REVIEW CONTEXT");
      expect(prompt).not.toContain("Delta-aware review protocol");
    });

    it("omits prior-context block when prior arg is null", () => {
      const prompt = buildDesignReviewPrompt(minimalDoc, "", null);
      expect(prompt).not.toContain("PRIOR REVIEW CONTEXT");
    });

    it("omits prior-context block when prior issues array is empty", () => {
      const prompt = buildDesignReviewPrompt(minimalDoc, "", { round: 1, issues: [] });
      expect(prompt).not.toContain("PRIOR REVIEW CONTEXT");
    });

    it("includes prior issues verbatim on round 2+ so the reviewer can judge resolution", () => {
      const prompt = buildDesignReviewPrompt(minimalDoc, "", {
        round: 1,
        issues: [
          { severity: "critical", description: "Missing explicit Accessibility section" },
          { severity: "important", description: "No alternatives considered" },
        ],
      });
      expect(prompt).toContain("PRIOR REVIEW CONTEXT (this is review round 2)");
      expect(prompt).toContain("Missing explicit Accessibility section");
      expect(prompt).toContain("No alternatives considered");
      expect(prompt).toContain("[critical]");
      expect(prompt).toContain("[important]");
    });

    it("instructs the reviewer to honor addressed issues and avoid re-litigation", () => {
      const prompt = buildDesignReviewPrompt(minimalDoc, "", {
        round: 2,
        issues: [{ severity: "critical", description: "Some prior issue" }],
      });
      expect(prompt).toContain("Delta-aware review protocol");
      expect(prompt).toContain("convergence, not re-litigation");
    });
  });
});

describe("buildPlanReviewPrompt", () => {
  it("includes tasks and file structure", () => {
    const prompt = buildPlanReviewPrompt({
      fileStructure: [{ path: "lib/filter.ts", action: "create", purpose: "Filter logic" }],
      tasks: [{ title: "Add filter", testFirst: "test filter", implement: "write filter", verify: "run tests" }],
    });
    expect(prompt).toContain("lib/filter.ts");
    expect(prompt).toContain("Add filter");
  });

  it("includes comprehensive review instruction to prevent whack-a-mole feedback", () => {
    const prompt = buildPlanReviewPrompt({
      fileStructure: [],
      tasks: [{ title: "Task 1", testFirst: "t", implement: "i", verify: "v" }],
    });
    // PR #1573 reworded the anti-oscillation copy: the reviewer must not raise
    // the bar across rounds, and must converge rather than surface a fresh issue
    // each re-review. Same whack-a-mole requirement, bounded/size-aligned text.
    expect(prompt).toContain("do not escalate the bar across review rounds");
    expect(prompt).toContain("a short, converging review beats a long one");
  });

  it("exempts documentation-only changes from the test-first requirement (no test is never critical for a comment/doc task)", () => {
    const prompt = buildPlanReviewPrompt({
      fileStructure: [{ path: "lib/x.ts", action: "modify", purpose: "Add header comment" }],
      tasks: [{ title: "Add header comment", testFirst: "n/a — comment only", implement: "add comment", verify: "comment present" }],
    });
    expect(prompt).toContain("DOCUMENTATION-ONLY changes");
    expect(prompt).toContain("require NO test-first step");
  });
});

describe("applyTestFirstLenienceForKind", () => {
  const testFirstCritical = {
    decision: "fail" as const,
    issues: [
      { severity: "critical" as const, description: "Task 2 does not specify a real failing test to write first for the header comment addition." },
      { severity: "important" as const, description: "Task 1 omits the expected function signature." },
    ],
    summary: "two issues",
  };

  it("downgrades a test-first critical to non-blocking for a chore build → decision flips to pass", () => {
    const out = applyTestFirstLenienceForKind(testFirstCritical, "chore");
    expect(out.decision).toBe("pass");
    expect(out.issues.find((i) => i.description.includes("test to write first"))?.severity).toBe("minor");
    // the unrelated important issue is preserved as-is
    expect(out.issues.find((i) => i.description.includes("function signature"))?.severity).toBe("important");
  });

  it("applies to fix and docs kinds too", () => {
    expect(applyTestFirstLenienceForKind(testFirstCritical, "fix").decision).toBe("pass");
    expect(applyTestFirstLenienceForKind(testFirstCritical, "docs").decision).toBe("pass");
  });

  it("does NOT touch a feature build — test-first stays critical and blocking", () => {
    const out = applyTestFirstLenienceForKind(testFirstCritical, "feature");
    expect(out.decision).toBe("fail");
    expect(out.issues[0].severity).toBe("critical");
  });

  it("leaves a genuine (non-test-first) critical blocking even for a chore", () => {
    const realBlocker = {
      decision: "fail" as const,
      issues: [{ severity: "critical" as const, description: "Plan refers to a missing modify target: lib/gone.ts" }],
      summary: "missing file",
    };
    const out = applyTestFirstLenienceForKind(realBlocker, "chore");
    expect(out.decision).toBe("fail");
    expect(out.issues[0].severity).toBe("critical");
  });

  it("is a no-op when kind is null/undefined", () => {
    expect(applyTestFirstLenienceForKind(testFirstCritical, null).decision).toBe("fail");
    expect(applyTestFirstLenienceForKind(testFirstCritical, undefined).decision).toBe("fail");
  });

  it("downgrades test-first criticals worded by the 'test … before … implemented' ordering (regression)", () => {
    // These exact phrasings leaked through the original alternation and wedged a
    // chore at the plan gate (FB-69231490 / BI-4FF277BF) even though sibling
    // tasks with "real failing test" wording were correctly downgraded.
    const orderingWorded = {
      decision: "fail" as const,
      issues: [
        { severity: "critical" as const, description: "Task 4 does not specify an actual test that would verify the prefix mapping behavior before the mapping is implemented." },
        { severity: "critical" as const, description: "Task 5 does not include a test case verifying the null return for unrecognized prefixes before implementing that logic." },
        { severity: "critical" as const, description: "Task 6 lacks a test that would verify handling of empty strings or malformed inputs before such handling is coded." },
      ],
      summary: "test-first, ordering-worded",
    };
    const out = applyTestFirstLenienceForKind(orderingWorded, "chore");
    expect(out.decision).toBe("pass");
    expect(out.issues.every((i) => i.severity === "minor")).toBe(true);
  });

  it("still blocks a genuine non-test-first critical that mentions both 'test' and 'before' for a chore", () => {
    const realBlocker = {
      decision: "fail" as const,
      issues: [{ severity: "critical" as const, description: "Task 3 runs the full test suite before the sandbox branch is created, which will error out." }],
      summary: "ordering bug, not test-first",
    };
    const out = applyTestFirstLenienceForKind(realBlocker, "chore");
    expect(out.decision).toBe("fail");
    expect(out.issues[0].severity).toBe("critical");
  });
});

describe("relaxTestFirstAfterRounds (round-aware, kind-agnostic)", () => {
  const featureTestFirst = {
    decision: "fail" as const,
    issues: [
      { severity: "critical" as const, description: "Task 2 does not specify a real failing test to write first for the new counter." },
      { severity: "important" as const, description: "Task 1 omits the expected function signature." },
    ],
    summary: "test-first on a feature",
  };

  it("relaxes test-first criticals for a FEATURE plan once rounds are exhausted → decision flips to pass", () => {
    const out = relaxTestFirstAfterRounds(featureTestFirst, 3);
    expect(out.decision).toBe("pass");
    expect(out.issues.find((i) => i.description.includes("test to write first"))?.severity).toBe("minor");
    // unrelated non-test-first issues are preserved as-is
    expect(out.issues.find((i) => i.description.includes("function signature"))?.severity).toBe("important");
  });

  it("annotates the downgrade with the round so the review trail stays legible", () => {
    const out = relaxTestFirstAfterRounds(featureTestFirst, 4);
    expect(out.issues.find((i) => i.severity === "minor")?.description).toMatch(/after 4 plan-review rounds/);
  });

  it("does NOT relax a genuine non-test-first blocker — stays failing so the build still escalates", () => {
    const realBlocker = {
      decision: "fail" as const,
      issues: [{ severity: "critical" as const, description: "Plan refers to a missing modify target: lib/gone.ts" }],
      summary: "missing file",
    };
    const out = relaxTestFirstAfterRounds(realBlocker, 3);
    expect(out.decision).toBe("fail");
    expect(out.issues[0].severity).toBe("critical");
  });

  it("returns the same review unchanged when there are no test-first criticals", () => {
    const clean = { decision: "pass" as const, issues: [], summary: "ok" };
    expect(relaxTestFirstAfterRounds(clean, 5)).toBe(clean);
  });
});

describe("buildPlanReviewPrompt (task context + delta-aware)", () => {
  it("includes task count for reviewer context", () => {
    const prompt = buildPlanReviewPrompt({
      fileStructure: [],
      tasks: [
        { title: "T1", testFirst: "t", implement: "i", verify: "v" },
        { title: "T2", testFirst: "t", implement: "i", verify: "v" },
        { title: "T3", testFirst: "t", implement: "i", verify: "v" },
      ],
    });
    expect(prompt).toContain("TASKS (3 total)");
  });

  // BI-4396EFEC (D38) — Delta-aware review prompt extension. Round 1
  // looks unchanged; round 2+ injects a PRIOR REVIEW CONTEXT block that
  // tells the reviewer to judge resolution rather than re-evaluate from
  // scratch. This is the surgical lever against plan-iteration oscillation.
  describe("delta-aware prior context (BI-4396EFEC)", () => {
    const minimalPlan = {
      fileStructure: [],
      tasks: [{ title: "T1", testFirst: "t", implement: "i", verify: "v" }],
    };

    it("omits prior-context block on round 1 (no prior issues)", () => {
      const prompt = buildPlanReviewPrompt(minimalPlan);
      expect(prompt).not.toContain("PRIOR REVIEW CONTEXT");
      expect(prompt).not.toContain("Delta-aware review protocol");
    });

    it("omits prior-context block when prior arg is null", () => {
      const prompt = buildPlanReviewPrompt(minimalPlan, null);
      expect(prompt).not.toContain("PRIOR REVIEW CONTEXT");
    });

    it("omits prior-context block when prior issues array is empty", () => {
      const prompt = buildPlanReviewPrompt(minimalPlan, { round: 1, issues: [] });
      expect(prompt).not.toContain("PRIOR REVIEW CONTEXT");
    });

    it("includes prior issues verbatim on round 2+ so the reviewer can judge resolution", () => {
      const prompt = buildPlanReviewPrompt(minimalPlan, {
        round: 1,
        issues: [
          { severity: "critical", description: "Tasks 1-20 are implementation-first" },
          { severity: "important", description: "Migration onDelete semantics undefined" },
        ],
      });
      expect(prompt).toContain("PRIOR REVIEW CONTEXT (this is review round 2)");
      expect(prompt).toContain("Tasks 1-20 are implementation-first");
      expect(prompt).toContain("Migration onDelete semantics undefined");
      expect(prompt).toContain("[critical]");
      expect(prompt).toContain("[important]");
    });

    it("instructs the reviewer to honor addressed issues and avoid re-litigation", () => {
      const prompt = buildPlanReviewPrompt(minimalPlan, {
        round: 2,
        issues: [{ severity: "critical", description: "Some prior issue" }],
      });
      // The convergence-enforcing delta protocol must be present so the
      // reviewer can't fall back to re-evaluating from scratch and can't
      // trade one issue set for another across rounds (BI-ACC6A4A7).
      expect(prompt).toContain("do NOT re-surface it");
      expect(prompt).toContain("the SAME description");
      expect(prompt).toContain("CONVERGENCE-ENFORCING");
      expect(prompt).toContain("no CRITICAL issues remain");
    });

    it("computes the correct round label when prior round is 2", () => {
      const prompt = buildPlanReviewPrompt(minimalPlan, {
        round: 2,
        issues: [{ severity: "critical", description: "Persistent issue" }],
      });
      expect(prompt).toContain("this is review round 3");
    });
  });
});

describe("buildCodeReviewPrompt", () => {
  it("includes task, code, and test output", () => {
    const prompt = buildCodeReviewPrompt("Add filter", "const x = 1;", "PASS 1 test");
    expect(prompt).toContain("Add filter");
    expect(prompt).toContain("const x = 1;");
    expect(prompt).toContain("PASS 1 test");
  });
});

describe("parseReviewResponse", () => {
  it("parses valid pass response", () => {
    const result = parseReviewResponse('{"decision":"pass","issues":[],"summary":"Looks good"}');
    expect(result.decision).toBe("pass");
    expect(result.issues).toHaveLength(0);
    expect(result.summary).toBe("Looks good");
  });

  it("parses valid fail response with issues", () => {
    const result = parseReviewResponse('{"decision":"fail","issues":[{"severity":"critical","description":"Missing test"}],"summary":"Needs work"}');
    expect(result.decision).toBe("fail");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("critical");
  });

  it("handles markdown code fences", () => {
    const result = parseReviewResponse('```json\n{"decision":"pass","issues":[],"summary":"ok"}\n```');
    expect(result.decision).toBe("pass");
  });

  it("returns fail with parseError:true for unparseable response", () => {
    const result = parseReviewResponse("This is not JSON");
    expect(result.decision).toBe("fail");
    expect(result.issues[0].severity).toBe("critical");
    expect(result.parseError).toBe(true);
  });

  it("does not set parseError on a successfully parsed response", () => {
    const result = parseReviewResponse('{"decision":"pass","issues":[],"summary":"All good"}');
    expect(result.parseError).toBeUndefined();
  });

  it("defaults invalid severity to minor", () => {
    const result = parseReviewResponse('{"decision":"fail","issues":[{"severity":"unknown","description":"test"}],"summary":"ok"}');
    expect(result.issues[0].severity).toBe("minor");
  });

  it("overrides reviewer's 'fail' decision when only important/minor issues exist", () => {
    // Matches the real-world loop: reviewer lists 2 important issues and
    // decides fail, which contradicts its own severity calibration
    // ("important doesn't block implementation"). Severity-driven logic
    // returns pass because no critical issues exist — issues are still
    // surfaced for the author to address.
    const result = parseReviewResponse(JSON.stringify({
      decision: "fail",
      issues: [
        { severity: "important", description: "Race condition edge case" },
        { severity: "important", description: "Missing alternatives note" },
      ],
      summary: "Reviewer 2: state-consistency safeguards needed",
    }));
    expect(result.decision).toBe("pass");
    expect(result.issues).toHaveLength(2);
  });

  it("still fails when any issue is critical, regardless of reviewer's decision field", () => {
    const result = parseReviewResponse(JSON.stringify({
      decision: "pass",
      issues: [
        { severity: "critical", description: "Auth bypass" },
        { severity: "minor", description: "Naming nit" },
      ],
      summary: "technically fine but",
    }));
    expect(result.decision).toBe("fail");
    expect(result.issues).toHaveLength(2);
  });
});

// ─── Deliberation Integration (Task 8) ──────────────────────────────────────

describe("extractClaimsFromReview", () => {
  it("adds an affirmative assertion when the reviewer passes", () => {
    const review: ReviewResult = {
      decision: "pass",
      issues: [],
      summary: "Design is sound and complete.",
    };
    const { assertions, objections } = extractClaimsFromReview(review);
    expect(assertions).toHaveLength(1);
    expect(assertions[0].claimText).toContain("Design is sound");
    expect(assertions[0].evidenceGrade).toBe("C");
    expect(objections).toHaveLength(0);
  });

  it("maps each issue to an objection claim with severity in the text", () => {
    const review: ReviewResult = {
      decision: "fail",
      issues: [
        { severity: "critical", description: "Auth bypass", location: "lib/auth.ts" },
        { severity: "important", description: "Missing tests" },
        { severity: "minor", description: "Naming nit" },
      ],
      summary: "Needs work",
    };
    const { assertions, objections } = extractClaimsFromReview(review);
    // Fail decision → no affirmative assertion.
    expect(assertions).toHaveLength(0);
    expect(objections).toHaveLength(3);

    const critical = objections[0];
    expect(critical.claimText).toContain("[critical]");
    expect(critical.claimText).toContain("Auth bypass");
    expect(critical.claimText).toContain("(at lib/auth.ts)");
    // Location + critical → grade B.
    expect(critical.evidenceGrade).toBe("B");
    expect(critical.confidence).toBeCloseTo(0.85, 5);

    const important = objections[1];
    expect(important.claimText).toContain("[important]");
    expect(important.evidenceGrade).toBe("C");
    expect(important.confidence).toBeCloseTo(0.65, 5);

    const minor = objections[2];
    expect(minor.claimText).toContain("[minor]");
    expect(minor.confidence).toBeCloseTo(0.4, 5);
  });
});

describe("buildReviewBranchArtifacts", () => {
  const passReview: ReviewResult = {
    decision: "pass",
    issues: [],
    summary: "Looks good",
  };
  const failReview: ReviewResult = {
    decision: "fail",
    issues: [{ severity: "critical", description: "Data loss risk" }],
    summary: "Blocking issue",
  };

  it("produces one branch per reviewer with claims populated", () => {
    const inputs: ReviewBranchInput[] = [
      { branchNodeId: "reviewer-1", role: "reviewer", review: passReview },
      { branchNodeId: "reviewer-2", role: "reviewer", review: failReview },
    ];
    const branches = buildReviewBranchArtifacts(inputs);
    expect(branches).toHaveLength(2);

    expect(branches[0]).toMatchObject({
      branchNodeId: "reviewer-1",
      role: "reviewer",
      completed: true,
      recommendation: "pass",
      rationale: "Looks good",
    });
    expect(branches[0].assertions).toHaveLength(1);
    expect(branches[0].objections).toHaveLength(0);

    expect(branches[1]).toMatchObject({
      branchNodeId: "reviewer-2",
      role: "reviewer",
      completed: true,
      recommendation: "fail",
      rationale: "Blocking issue",
    });
    expect(branches[1].objections).toHaveLength(1);
  });

  it("marks a null-review branch as incomplete with a failure reason", () => {
    const inputs: ReviewBranchInput[] = [
      { branchNodeId: "reviewer-1", role: "reviewer", review: null, failureReason: "LLM timeout" },
    ];
    const branches = buildReviewBranchArtifacts(inputs);
    expect(branches).toHaveLength(1);
    expect(branches[0].completed).toBe(false);
    expect(branches[0].failureReason).toBe("LLM timeout");
    // Null-review branches have no recommendation or claim arrays.
    expect(branches[0].recommendation).toBeUndefined();
  });

  it("supplies a default failure reason when caller omits one", () => {
    const inputs: ReviewBranchInput[] = [
      { branchNodeId: "reviewer-1", role: "reviewer", review: null },
    ];
    const branches = buildReviewBranchArtifacts(inputs);
    expect(branches[0].failureReason).toMatch(/did not produce/i);
  });

  it("treats a parse-error review as incomplete, not as a dissenting vote", () => {
    // Reproduces the Codex rate-limit scenario: reviewer-2 response was not
    // parseable so parseReviewResponse returned parseError:true. The branch
    // must be marked completed:false so detectConsensusState sees only the
    // one passing reviewer and returns partial-consensus, not no-consensus.
    const parseErrorReview: ReviewResult = {
      decision: "fail",
      issues: [{ severity: "critical", description: "Review agent returned unparseable response" }],
      summary: "Review failed — could not parse agent response",
      parseError: true,
    };
    const inputs: ReviewBranchInput[] = [
      { branchNodeId: "reviewer-1", role: "reviewer", review: { decision: "pass", issues: [], summary: "Looks good" } },
      { branchNodeId: "reviewer-2", role: "reviewer", review: parseErrorReview },
    ];
    const branches = buildReviewBranchArtifacts(inputs);
    expect(branches).toHaveLength(2);
    expect(branches[0].completed).toBe(true);
    expect(branches[0].recommendation).toBe("pass");
    expect(branches[1].completed).toBe(false);
    expect(branches[1].failureReason).toMatch(/parse-error/i);
    expect(branches[1].recommendation).toBeUndefined();
  });
});

describe("deriveReviewRiskLevel", () => {
  it("returns low when all reviewers passed with no issues", () => {
    const reviews: Array<ReviewResult | null> = [
      { decision: "pass", issues: [], summary: "ok" },
      { decision: "pass", issues: [], summary: "ok" },
    ];
    expect(deriveReviewRiskLevel(reviews)).toBe("low");
  });

  it("returns medium when any reviewer raised an important (but no critical) issue", () => {
    const reviews: Array<ReviewResult | null> = [
      { decision: "pass", issues: [], summary: "ok" },
      {
        decision: "fail",
        issues: [{ severity: "important", description: "Missing alternatives" }],
        summary: "gap",
      },
    ];
    expect(deriveReviewRiskLevel(reviews)).toBe("medium");
  });

  it("returns high as soon as any reviewer raised a critical issue", () => {
    const reviews: Array<ReviewResult | null> = [
      { decision: "pass", issues: [], summary: "ok" },
      {
        decision: "fail",
        issues: [
          { severity: "important", description: "Docs" },
          { severity: "critical", description: "SQL injection" },
        ],
        summary: "broken",
      },
    ];
    expect(deriveReviewRiskLevel(reviews)).toBe("high");
  });

  it("ignores null (failed-to-respond) reviewers instead of counting them as risk", () => {
    const reviews: Array<ReviewResult | null> = [
      null,
      { decision: "pass", issues: [], summary: "ok" },
    ];
    expect(deriveReviewRiskLevel(reviews)).toBe("low");
  });
});

describe("artifactTypeForPhase", () => {
  it("maps ideate → spec, plan → plan, review → code-change", () => {
    expect(artifactTypeForPhase("ideate")).toBe("spec");
    expect(artifactTypeForPhase("plan")).toBe("plan");
    expect(artifactTypeForPhase("review")).toBe("code-change");
  });
});

describe("mapCompactSummaryToBuildEntry", () => {
  it("passes the synthesizer's fields through without re-deriving consensus", () => {
    const entry = mapCompactSummaryToBuildEntry({
      patternSlug: "review",
      compactSummary: {
        deliberationRunId: "run-1",
        consensusState: "consensus",
        confidence: 0.82,
        unresolvedCount: 0,
        branchesCompleted: 2,
        branchesTotal: 2,
        budgetHalted: false,
        degradedDiversity: false,
        evidenceBadge: "mixed",
      },
      rationaleSummary: "Both reviewers affirmed the design.",
      unresolvedRisks: [],
      diversityLabel: "peer-review",
    });
    expect(entry.patternSlug).toBe("review");
    expect(entry.deliberationRunId).toBe("run-1");
    expect(entry.consensusState).toBe("consensus");
    expect(entry.evidenceQuality).toBe("mixed");
    expect(entry.diversityLabel).toBe("peer-review");
    expect(entry.unresolvedRisks).toEqual([]);
  });
});

describe("buildArchitectureReviewPrompt", () => {
  it("frames the design review as advisory and includes the DPF reference standards", () => {
    const prompt = buildArchitectureReviewPrompt(
      {
        kind: "design",
        doc: {
          problemStatement: "Need to store architecture findings",
          reusePlan: "Considered reusing the ReviewResult JSON column",
          proposedApproach: "Add a new ArchitectureReview table",
          acceptanceCriteria: ["Findings persist"],
        },
      },
      "Test project",
    );
    expect(prompt).toContain("ADVISORY");
    expect(prompt).toContain("Enterprise Architect");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("docs/founder-kernel/wiki/principles/");
    expect(prompt).toContain("ArchitectureReview table");
    // The chief-architect lens must invite reference-doc feedback.
    expect(prompt).toContain("[reference-doc]");
    // Whole-over-local is a first-class architectural-alignment concern.
    expect(prompt).toContain("Optimize for the Whole");
    // Archetype/storefront designs are measured against their load-bearing stages.
    expect(prompt).toContain("LOAD-BEARING value-stream");
    expect(prompt).toContain("JSON FORMAT");
  });

  it("reviews the implementation plan's file structure for canonical placement", () => {
    const prompt = buildArchitectureReviewPrompt(
      {
        kind: "plan",
        plan: {
          fileStructure: [{ path: "apps/web/lib/new-thing.ts", action: "create", purpose: "logic" }],
          tasks: [{ title: "Add logic", testFirst: "t", implement: "write", verify: "tsc" }],
        },
      },
      "",
    );
    expect(prompt).toContain("implementation plan");
    expect(prompt).toContain("apps/web/lib/new-thing.ts");
    expect(prompt).toContain("canonical home");
  });

  it("exposes the reference standards as a non-empty, repo-relative list", () => {
    expect(ARCHITECTURE_REVIEW_REFERENCES.length).toBeGreaterThan(0);
    expect(ARCHITECTURE_REVIEW_REFERENCES.map((r) => r.path)).toContain("AGENTS.md");
    // The Optimize-for-the-Whole commandment is among the kernel principles the
    // architect lens measures a spec against.
    const kernel = ARCHITECTURE_REVIEW_REFERENCES.find(
      (r) => r.path === "docs/founder-kernel/wiki/principles/",
    );
    expect(kernel?.covers).toContain("optimize-for-the-whole");
    // Archetype designs are measured against their load-bearing value-stream
    // stages — the whole-outcome measure that survives portal rebuilds.
    expect(ARCHITECTURE_REVIEW_REFERENCES.map((r) => r.path))
      .toContain("docs/architecture/archetype-business-value-streams.md");
  });
});

describe("architectureAdvisoryFromReview", () => {
  it("returns the compact advisory for a parsed review", () => {
    const arch: ReviewResult = {
      decision: "fail",
      issues: [{ severity: "important", description: "Duplicates a canonical model", suggestion: "Extend it" }],
      summary: "Aligned with concerns",
    };
    expect(architectureAdvisoryFromReview(arch)).toEqual({
      summary: "Aligned with concerns",
      issues: arch.issues,
    });
  });

  it("treats an absent or parse-error reviewer as no advisory (never fabricates 'no concerns')", () => {
    expect(architectureAdvisoryFromReview(null)).toBeNull();
    expect(
      architectureAdvisoryFromReview({
        decision: "fail",
        issues: [],
        summary: "unparseable",
        parseError: true,
      }),
    ).toBeNull();
  });
});

describe("collectReviewerVerdicts", () => {
  function rev(overrides: Partial<ReviewResult> = {}): ReviewResult {
    return { decision: "pass", issues: [], summary: "", ...overrides };
  }

  it("maps r1/r2/archReview to named verdicts in deliberation-branch order", () => {
    const verdicts = collectReviewerVerdicts(
      rev({ decision: "pass" }),
      rev({ decision: "fail", issues: [{ severity: "critical", description: "x" }] }),
      rev({ decision: "pass", issues: [{ severity: "minor", description: "n" }] }),
    );
    expect(verdicts.map((v) => v.source)).toEqual(["reviewer-1", "reviewer-2", "architect"]);
    expect(verdicts.map((v) => v.label)).toEqual([
      "Primary review",
      "Independent review",
      "Architecture",
    ]);
    expect(verdicts[1]).toMatchObject({
      role: "reviewer",
      decision: "fail",
      issueCounts: { critical: 1, important: 0, minor: 0 },
    });
    expect(verdicts[2]).toMatchObject({ role: "architect", decision: "pass" });
  });

  it("omits reviewers that did not respond (null) rather than inventing a pass", () => {
    const verdicts = collectReviewerVerdicts(rev(), null, null);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.source).toBe("reviewer-1");
  });

  it("returns an empty array when no reviewer responded", () => {
    expect(collectReviewerVerdicts(null, null, null)).toEqual([]);
  });

  it("preserves the parseError flag so the UI can show 'unavailable' not a false pass", () => {
    const verdicts = collectReviewerVerdicts(
      rev({ parseError: true, decision: "fail" }),
      rev({ decision: "pass" }),
      null,
    );
    expect(verdicts[0]).toMatchObject({ source: "reviewer-1", parseError: true });
    expect(verdicts[1]).not.toHaveProperty("parseError");
  });

  it("counts issues by severity", () => {
    const verdicts = collectReviewerVerdicts(
      rev({
        issues: [
          { severity: "critical", description: "a" },
          { severity: "important", description: "b" },
          { severity: "important", description: "c" },
          { severity: "minor", description: "d" },
        ],
      }),
      null,
      null,
    );
    expect(verdicts[0]?.issueCounts).toEqual({ critical: 1, important: 2, minor: 1 });
  });
});
