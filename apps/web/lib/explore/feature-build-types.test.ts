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
} from "./feature-build-types";

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

  describe("review → ship sandbox verification gate (#212)", () => {
    const baseReviewToShipEvidence = {
      designDoc: { problemStatement: "x" },
      buildPlan: { fileStructure: [], tasks: [] },
      verificationOut: { testsPassed: 5, testsFailed: 0, typecheckPassed: true, fullOutput: "", timestamp: "" },
      acceptanceMet: [{ criterion: "c", met: true, evidence: "e" }],
      uxVerificationStatus: "complete" as const,
      uxTestResults: [{ step: "s", passed: true }],
    };

    it("blocks when sandbox verification has never run", () => {
      const result = checkPhaseGate("review", "ship", baseReviewToShipEvidence);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Sandbox");
      expect(result.reason).toContain("not run");
    });

    it("blocks when sandbox verification is still running", () => {
      const result = checkPhaseGate("review", "ship", {
        ...baseReviewToShipEvidence,
        sandboxVerificationStatus: "running",
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("still running");
    });

    it("blocks when sandbox typecheck failed", () => {
      const result = checkPhaseGate("review", "ship", {
        ...baseReviewToShipEvidence,
        sandboxVerificationStatus: "failed",
        sandboxVerification: {
          typecheck: { passed: false },
          build: { passed: false, skipped: true },
        },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("typecheck");
    });

    it("blocks when sandbox build failed (typecheck green)", () => {
      const result = checkPhaseGate("review", "ship", {
        ...baseReviewToShipEvidence,
        sandboxVerificationStatus: "failed",
        sandboxVerification: {
          typecheck: { passed: true },
          build: { passed: false },
        },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("build");
    });

    it("allows review → ship when sandbox verification is complete and everything else passes", () => {
      const result = checkPhaseGate("review", "ship", {
        ...baseReviewToShipEvidence,
        sandboxVerificationStatus: "complete",
        sandboxVerification: {
          typecheck: { passed: true },
          build: { passed: true },
          allPassed: true,
        },
      });
      expect(result.allowed).toBe(true);
    });
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
