import { describe, it, expect } from "vitest";
import {
  buildDesignReviewPrompt,
  buildPlanReviewPrompt,
  buildCodeReviewPrompt,
  parseReviewResponse,
  extractClaimsFromReview,
  buildReviewBranchArtifacts,
  deriveReviewRiskLevel,
  artifactTypeForPhase,
  mapCompactSummaryToBuildEntry,
  type ReviewBranchInput,
} from "./build-reviewers";
import type { ReviewResult } from "@/lib/feature-build-types";

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
    expect(prompt).toContain("MUST report ALL issues in a SINGLE response");
    expect(prompt).toContain("ZERO surprise issues on a re-review");
  });

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

  it("returns fail for unparseable response", () => {
    const result = parseReviewResponse("This is not JSON");
    expect(result.decision).toBe("fail");
    expect(result.issues[0].severity).toBe("critical");
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
