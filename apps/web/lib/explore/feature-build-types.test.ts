import { describe, it, expect } from "vitest";
import {
  validateFeatureBrief,
  PHASE_ORDER,
  canTransitionPhase,
  PHASE_LABELS,
  CODING_CAPABILITY_COLOURS,
  generateBuildId,
  generatePackId,
  normalizeHappyPathState,
  isHappyPathIntakeReady,
  normalizeIssueKey,
  computeReviewDelta,
  isOscillating,
  describePlanReviewFailure,
} from "./feature-build-types";
import type { ReviewResult } from "./feature-build-types";

const readyHappyPath = {
  intake: {
    status: "ready" as const,
    taxonomyNodeId: "tax-1",
    backlogItemId: "BI-1",
    epicId: "epic-1",
    constrainedGoal: "Capture one version value from Prometheus",
    failureReason: null,
  },
  execution: {
    engine: null,
    source: null,
    status: "pending" as const,
    failureStage: null,
  },
  verification: {
    status: "pending" as const,
    checks: [],
  },
};

describe("validateFeatureBrief", () => {
  it("accepts a valid brief", () => {
    const result = validateFeatureBrief({
      title: "Customer Feedback Form",
      description: "A form for collecting customer feedback",
      portfolioContext: "products_and_services_sold",
      targetRoles: ["HR-200"],
      inputs: [],
      dataNeeds: "Stores feedback text and rating",
      acceptanceCriteria: ["Form submits successfully"],
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects empty title", () => {
    const result = validateFeatureBrief({
      title: "",
      description: "desc",
      portfolioContext: "foundational",
      targetRoles: [],
      inputs: [],
      dataNeeds: "",
      acceptanceCriteria: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("title is required");
  });

  it("rejects missing description", () => {
    const result = validateFeatureBrief({
      title: "Test",
      description: "",
      portfolioContext: "foundational",
      targetRoles: [],
      inputs: [],
      dataNeeds: "",
      acceptanceCriteria: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("description is required");
  });
});

describe("PHASE_ORDER", () => {
  it("has 7 phases in correct order", () => {
    expect(PHASE_ORDER).toEqual([
      "ideate", "plan", "build", "review", "ship", "complete", "failed",
    ]);
  });
});

describe("canTransitionPhase", () => {
  it("allows ideate → plan", () => {
    expect(canTransitionPhase("ideate", "plan")).toBe(true);
  });

  it("allows plan → build", () => {
    expect(canTransitionPhase("plan", "build")).toBe(true);
  });

  it("allows build → review", () => {
    expect(canTransitionPhase("build", "review")).toBe(true);
  });

  it("allows review → ship", () => {
    expect(canTransitionPhase("review", "ship")).toBe(true);
  });

  it("allows ship → complete", () => {
    expect(canTransitionPhase("ship", "complete")).toBe(true);
  });

  it("allows any phase → failed", () => {
    expect(canTransitionPhase("ideate", "failed")).toBe(true);
    expect(canTransitionPhase("build", "failed")).toBe(true);
  });

  it("blocks skipping phases", () => {
    expect(canTransitionPhase("ideate", "build")).toBe(false);
    expect(canTransitionPhase("plan", "review")).toBe(false);
  });

  it("blocks backward transitions", () => {
    expect(canTransitionPhase("build", "ideate")).toBe(false);
    expect(canTransitionPhase("review", "plan")).toBe(false);
  });

  it("blocks transitions from terminal states", () => {
    expect(canTransitionPhase("complete", "ideate")).toBe(false);
    expect(canTransitionPhase("failed", "ideate")).toBe(false);
  });
});

describe("PHASE_LABELS", () => {
  it("has a label for every phase", () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_LABELS[phase]).toBeTruthy();
    }
  });
});

describe("CODING_CAPABILITY_COLOURS", () => {
  it("maps all three tiers", () => {
    expect(CODING_CAPABILITY_COLOURS["excellent"]).toBeTruthy();
    expect(CODING_CAPABILITY_COLOURS["adequate"]).toBeTruthy();
    expect(CODING_CAPABILITY_COLOURS["insufficient"]).toBeTruthy();
  });
});

describe("generateBuildId", () => {
  it("starts with FB-", () => {
    expect(generateBuildId()).toMatch(/^FB-[A-Z0-9]{8}$/);
  });

  it("generates unique IDs", () => {
    const a = generateBuildId();
    const b = generateBuildId();
    expect(a).not.toBe(b);
  });
});

describe("generatePackId", () => {
  it("starts with FP-", () => {
    expect(generatePackId()).toMatch(/^FP-[A-Z0-9]{8}$/);
  });
});

// ─── Phase Gate Tests (Build Disciplines) ────────────────────────────────────

import { checkPhaseGate } from "./feature-build-types";

describe("canTransitionPhase — review→build backward transition", () => {
  it("allows review to build (backward transition for changes)", () => {
    expect(canTransitionPhase("review", "build")).toBe(true);
  });
});

describe("checkPhaseGate", () => {
  it("blocks ideate to plan without designDoc", () => {
    const result = checkPhaseGate("ideate", "plan", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("design document");
  });

  it("blocks ideate to plan without designReview", () => {
    const result = checkPhaseGate("ideate", "plan", {
      designDoc: { problemStatement: "test" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Design review is required");
  });

  it("blocks ideate to plan when design review failed", () => {
    const result = checkPhaseGate("ideate", "plan", {
      designDoc: { problemStatement: "test" },
      designReview: { decision: "fail", issues: [{ severity: "critical", description: "Missing reuse audit" }], summary: "Needs revision" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Design review failed");
  });

  it("allows ideate to plan with designDoc and passing review", () => {
    const result = checkPhaseGate("ideate", "plan", {
      designDoc: { problemStatement: "test" },
      designReview: { decision: "pass", issues: [], summary: "ok" },
      happyPathState: readyHappyPath,
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks ideate to plan without happy-path intake readiness", () => {
    const result = checkPhaseGate("ideate", "plan", {
      designDoc: { problemStatement: "test" },
      designReview: { decision: "pass", issues: [], summary: "ok" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("taxonomy");
  });

  it("blocks plan to build without buildPlan", () => {
    const result = checkPhaseGate("plan", "build", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("implementation plan");
  });

  it("blocks plan to build without planReview", () => {
    const result = checkPhaseGate("plan", "build", {
      buildPlan: { fileStructure: [], tasks: [] },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Plan review is required");
  });

  it("blocks plan to build when plan review failed", () => {
    const result = checkPhaseGate("plan", "build", {
      buildPlan: { fileStructure: [], tasks: [] },
      planReview: { decision: "fail", issues: [{ severity: "critical", description: "No test-first steps" }], summary: "Needs revision" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Plan review failed");
  });

  it("allows plan to build with buildPlan and passing review", () => {
    const result = checkPhaseGate("plan", "build", {
      buildPlan: { fileStructure: [], tasks: [] },
      planReview: { decision: "pass", issues: [], summary: "ok" },
      happyPathState: readyHappyPath,
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks plan to build when happy-path intake is incomplete", () => {
    const result = checkPhaseGate("plan", "build", {
      buildPlan: { fileStructure: [], tasks: [] },
      planReview: { decision: "pass", issues: [], summary: "ok" },
      happyPathState: normalizeHappyPathState(null),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("backlog");
  });

  it("blocks build to review without passing verification", () => {
    const result = checkPhaseGate("build", "review", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("verification");
  });

  it("allows build to review with passing verification", () => {
    const result = checkPhaseGate("build", "review", {
      verificationOut: { testsPassed: 5, testsFailed: 0, typecheckPassed: true, fullOutput: "", timestamp: "" },
    });
    expect(result.allowed).toBe(true);
  });

  it("allows build to review with test failures (informational — typecheck is the hard gate)", () => {
    const result = checkPhaseGate("build", "review", {
      verificationOut: { testsPassed: 4, testsFailed: 1, typecheckPassed: true, fullOutput: "", timestamp: "" },
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks build to review when typecheck fails", () => {
    const result = checkPhaseGate("build", "review", {
      verificationOut: { testsPassed: 5, testsFailed: 0, typecheckPassed: false, fullOutput: "", timestamp: "" },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Typecheck");
  });

  it("blocks review to ship without all evidence", () => {
    const result = checkPhaseGate("review", "ship", {});
    expect(result.allowed).toBe(false);
  });

  it("allows any phase to failed (no gate)", () => {
    const result = checkPhaseGate("build", "failed", {});
    expect(result.allowed).toBe(true);
  });

  it("allows review to build (backward, no gate)", () => {
    const result = checkPhaseGate("review", "build", {});
    expect(result.allowed).toBe(true);
  });
});

describe("normalizeHappyPathState", () => {
  it("returns safe defaults for null input", () => {
    expect(normalizeHappyPathState(null)).toEqual({
      intake: {
        status: "pending",
        taxonomyNodeId: null,
        backlogItemId: null,
        epicId: null,
        constrainedGoal: null,
        failureReason: null,
      },
      execution: {
        engine: null,
        source: null,
        status: "pending",
        failureStage: null,
      },
      verification: {
        status: "pending",
        checks: [],
      },
    });
  });
});

describe("isHappyPathIntakeReady", () => {
  it("returns false when any anchor is missing", () => {
    const state = normalizeHappyPathState({
      intake: {
        status: "ready",
        taxonomyNodeId: "tax-1",
        backlogItemId: null,
        epicId: "epic-1",
        constrainedGoal: "Capture one version value",
      },
    });
    expect(isHappyPathIntakeReady(state)).toBe(false);
  });

  it("returns true when taxonomy, backlog, epic, and constrained goal are present", () => {
    expect(isHappyPathIntakeReady(readyHappyPath)).toBe(true);
  });
});

// ─── Plan-review iteration helpers (BI-4396EFEC / D38) ──────────────────────
//
// These four helpers are the substrate for the Plan-iteration referee: they
// let reviewBuildPlan track cross-round trajectory without storing review
// history in its own table. computeReviewDelta + isOscillating drive the
// agent-facing "21 → 13 → 15 issues, oscillating" signal; describePlanReview-
// Failure surfaces the same trajectory in the operator-facing phase-gate
// reason string. Pure functions — easy to pin behavior.

describe("normalizeIssueKey (BI-4396EFEC)", () => {
  it("lowercases the description", () => {
    expect(normalizeIssueKey("CRITICAL: missing test")).toBe("critical: missing test");
  });

  it("truncates to first 80 chars to match mergeReviews dedup key", () => {
    const long = "A".repeat(120);
    expect(normalizeIssueKey(long)).toHaveLength(80);
  });

  it("returns the same key for descriptions that only differ in suffix > 80 chars", () => {
    const base = "Tasks 1-20 implementation-first lacking test-first steps for schema migration";
    const a = `${base} (variant A)`;
    const b = `${base} (variant B)`;
    // Both share the first 80 chars, so the dedup key collapses them.
    expect(normalizeIssueKey(a)).toBe(normalizeIssueKey(b));
  });
});

describe("computeReviewDelta (BI-4396EFEC)", () => {
  it("counts everything as newly-surfaced when prior is empty", () => {
    const delta = computeReviewDelta([], [
      { description: "issue A" },
      { description: "issue B" },
    ]);
    expect(delta).toEqual({
      issueCount: 0,
      addressed: 0,
      persisted: 0,
      newlySurfaced: 2,
    });
  });

  it("counts everything as addressed when current is empty", () => {
    const delta = computeReviewDelta(
      [{ description: "issue A" }, { description: "issue B" }],
      [],
    );
    expect(delta).toEqual({
      issueCount: 2,
      addressed: 2,
      persisted: 0,
      newlySurfaced: 0,
    });
  });

  it("identifies persisted issues by normalized description match", () => {
    const delta = computeReviewDelta(
      [{ description: "Tasks 1-20 are implementation-first" }, { description: "Migration onDelete undefined" }],
      [{ description: "tasks 1-20 are IMPLEMENTATION-first" }, { description: "Brand new issue" }],
    );
    expect(delta.persisted).toBe(1);
    expect(delta.addressed).toBe(1);
    expect(delta.newlySurfaced).toBe(1);
    expect(delta.issueCount).toBe(2);
  });

  it("handles full match (every prior issue persists, none added)", () => {
    const issues = [{ description: "A" }, { description: "B" }, { description: "C" }];
    const delta = computeReviewDelta(issues, issues);
    expect(delta).toEqual({
      issueCount: 3,
      addressed: 0,
      persisted: 3,
      newlySurfaced: 0,
    });
  });
});

describe("isOscillating (BI-4396EFEC)", () => {
  // The oscillation signal is what triggers the "consider splitting scope"
  // recommendation. Definition: current count >= prior count AND the review
  // both addressed some prior issues AND surfaced new ones. Pure progress
  // (everything addressed, no new) is NOT oscillation. Pure regression
  // (only new issues, none addressed) is NOT oscillation either — that's
  // a fresh failure mode. Oscillation is the "swap one set for another" case.

  it("returns false when issue count strictly decreased", () => {
    const delta = { issueCount: 10, addressed: 7, persisted: 3, newlySurfaced: 2 };
    expect(isOscillating(delta, 5)).toBe(false);
  });

  it("returns true when count flat AND both addressed and newly-surfaced > 0", () => {
    const delta = { issueCount: 10, addressed: 4, persisted: 6, newlySurfaced: 4 };
    expect(isOscillating(delta, 10)).toBe(true);
  });

  it("returns true when count increased AND review traded issues", () => {
    const delta = { issueCount: 10, addressed: 3, persisted: 7, newlySurfaced: 5 };
    expect(isOscillating(delta, 12)).toBe(true);
  });

  it("returns false when count flat but nothing was addressed (no trade, just persistence)", () => {
    const delta = { issueCount: 10, addressed: 0, persisted: 10, newlySurfaced: 0 };
    expect(isOscillating(delta, 10)).toBe(false);
  });

  it("returns false when nothing newly surfaced (pure progress on subset)", () => {
    const delta = { issueCount: 10, addressed: 5, persisted: 5, newlySurfaced: 0 };
    expect(isOscillating(delta, 5)).toBe(false);
  });
});

describe("describePlanReviewFailure (BI-4396EFEC)", () => {
  function review(overrides: Partial<ReviewResult> = {}): ReviewResult {
    return {
      decision: "fail",
      issues: [{ severity: "critical", description: "x" }],
      summary: "fail",
      ...overrides,
    };
  }

  it("returns base reason when no iteration metadata is attached", () => {
    const reason = describePlanReviewFailure(review());
    expect(reason).toContain("Plan review failed");
    expect(reason).toContain("re-run plan review");
    expect(reason).not.toContain("Round");
  });

  it("includes round label when iteration is present but no prior delta", () => {
    const reason = describePlanReviewFailure(review({ iteration: { round: 1 } }));
    expect(reason).toContain("(Round 1)");
    expect(reason).not.toContain("addressed");
  });

  it("includes addressed/persist/new breakdown when prior delta exists", () => {
    const reason = describePlanReviewFailure(review({
      iteration: {
        round: 2,
        prior: { issueCount: 21, addressed: 8, persisted: 13, newlySurfaced: 2 },
      },
    }));
    expect(reason).toContain("Round 2");
    expect(reason).toContain("8 addressed");
    expect(reason).toContain("13 persist");
    expect(reason).toContain("2 new");
  });

  it("recommends scope-splitting when oscillating flag is set", () => {
    const reason = describePlanReviewFailure(review({
      iteration: {
        round: 3,
        prior: { issueCount: 13, addressed: 5, persisted: 8, newlySurfaced: 7 },
        oscillating: true,
      },
    }));
    // Dale-class operators need to see "this won't converge — split it"
    // in plain English at the gate, not buried in the agent's chat.
    expect(reason).toContain("not decreasing across rounds");
    expect(reason).toContain("splitting this feature into smaller scopes");
  });

  it("omits the scope-split recommendation when not oscillating", () => {
    const reason = describePlanReviewFailure(review({
      iteration: {
        round: 2,
        prior: { issueCount: 21, addressed: 10, persisted: 11, newlySurfaced: 0 },
        oscillating: false,
      },
    }));
    expect(reason).not.toContain("splitting this feature");
  });
});
