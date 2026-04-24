import { describe, it, expect } from "vitest";
import { checkPhaseGate, canTransitionPhase } from "@/lib/feature-build-types";
import { parseReviewResponse, buildDesignReviewPrompt, buildPlanReviewPrompt } from "./build-reviewers";

/**
 * Integration test: Full Build Disciplines flow validation.
 * Tests the complete gate enforcement chain without needing a running server.
 */
describe("Build Disciplines — Full Flow Integration", () => {
  const happyPathState = {
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

  // ─── Gate 1: Ideate → Plan ───────────────────────────────────────────────

  describe("Gate 1: Ideate → Plan (Design Approval)", () => {
    it("BLOCKS without design document", () => {
      const result = checkPhaseGate("ideate", "plan", {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("design document");
    });

    it("BLOCKS with design doc but no review", () => {
      const result = checkPhaseGate("ideate", "plan", {
        designDoc: { problemStatement: "Need a search filter" },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Design review");
    });

    it("BLOCKS with design doc and failing review (failed review requires revision before advancing)", () => {
      const result = checkPhaseGate("ideate", "plan", {
        designDoc: { problemStatement: "Need a search filter" },
        designReview: { decision: "fail", issues: [{ severity: "critical", description: "Missing alternatives" }], summary: "Rejected" },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Design review failed");
    });

    it("PASSES with design doc and passing review", () => {
      const result = checkPhaseGate("ideate", "plan", {
        designDoc: {
          problemStatement: "Users need a search filter",
          existingCodeAudit: "Checked OpsClient — no filter exists",
          reusePlan: "Reuse the Hide Done pattern from backlog",
          proposedApproach: "Add text input with debounced filter",
          acceptanceCriteria: ["Filter narrows results", "Debounced at 300ms"],
        },
        designReview: { decision: "pass", issues: [], summary: "Design is sound" },
        happyPathState,
      });
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Gate 2: Plan → Build ────────────────────────────────────────────────

  describe("Gate 2: Plan → Build (Implementation Planning)", () => {
    it("BLOCKS without implementation plan", () => {
      const result = checkPhaseGate("plan", "build", {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("implementation plan");
    });

    it("PASSES with plan and passing review", () => {
      const result = checkPhaseGate("plan", "build", {
        buildPlan: {
          fileStructure: [
            { path: "components/SearchFilter.tsx", action: "create", purpose: "Search filter component" },
          ],
          tasks: [
            { title: "Write filter test", testFirst: "test renders input", implement: "create component", verify: "pnpm test" },
          ],
        },
        planReview: { decision: "pass", issues: [], summary: "Plan is executable" },
        happyPathState,
      });
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Gate 3: Build → Review ──────────────────────────────────────────────

  describe("Gate 3: Build → Review (Verification)", () => {
    it("BLOCKS without verification output", () => {
      const result = checkPhaseGate("build", "review", {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("verification");
    });

    it("ALLOWS when tests fail (test failures are informational — pre-existing suite failures must not block feature builds)", () => {
      const result = checkPhaseGate("build", "review", {
        verificationOut: { testsPassed: 9, testsFailed: 1, typecheckPassed: true, fullOutput: "1 failed", timestamp: "2026-03-17T10:00:00Z" },
      });
      expect(result.allowed).toBe(true);
    });

    it("BLOCKS when typecheck fails", () => {
      const result = checkPhaseGate("build", "review", {
        verificationOut: { testsPassed: 10, testsFailed: 0, typecheckPassed: false, fullOutput: "type error", timestamp: "2026-03-17T10:00:00Z" },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Typecheck");
    });

    it("PASSES when all tests and typecheck pass", () => {
      const result = checkPhaseGate("build", "review", {
        verificationOut: { testsPassed: 10, testsFailed: 0, typecheckPassed: true, fullOutput: "all pass", timestamp: "2026-03-17T10:00:00Z" },
      });
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Gate 4: Review → Ship ───────────────────────────────────────────────

  describe("Gate 4: Review → Ship (Full Evidence)", () => {
    const fullEvidence = {
      designDoc: { problemStatement: "test" },
      buildPlan: { fileStructure: [], tasks: [] },
      verificationOut: { testsPassed: 10, testsFailed: 0, typecheckPassed: true, fullOutput: "", timestamp: "" },
      acceptanceMet: [
        { criterion: "Filter works", met: true, evidence: "Test passes" },
        { criterion: "Debounced", met: true, evidence: "300ms delay verified" },
      ],
      // Sandbox typecheck + build gate (#212).
      sandboxVerificationStatus: "complete" as const,
      sandboxVerification: {
        typecheck: { passed: true },
        build: { passed: true },
        allPassed: true,
      },
    };

    it("BLOCKS without any evidence", () => {
      const result = checkPhaseGate("review", "ship", {});
      expect(result.allowed).toBe(false);
    });

    it("BLOCKS when acceptance criteria not all met", () => {
      const result = checkPhaseGate("review", "ship", {
        ...fullEvidence,
        acceptanceMet: [
          { criterion: "Filter works", met: true, evidence: "passes" },
          { criterion: "Debounced", met: false, evidence: "not implemented" },
        ],
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("acceptance criteria");
    });

    it("PASSES with complete evidence chain", () => {
      const result = checkPhaseGate("review", "ship", fullEvidence);
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Escape Hatches ──────────────────────────────────────────────────────

  describe("Escape hatches", () => {
    it("always allows transition to failed (no gate)", () => {
      expect(checkPhaseGate("ideate", "failed", {}).allowed).toBe(true);
      expect(checkPhaseGate("build", "failed", {}).allowed).toBe(true);
      expect(checkPhaseGate("review", "failed", {}).allowed).toBe(true);
    });

    it("allows review → build backward transition (no gate)", () => {
      expect(canTransitionPhase("review", "build")).toBe(true);
      expect(checkPhaseGate("review", "build", {}).allowed).toBe(true);
    });
  });

  // ─── Reviewer Response Parsing ───────────────────────────────────────────

  describe("Reviewer response parsing", () => {
    it("parses a real-world pass response", () => {
      const raw = `Here's my review:

\`\`\`json
{
  "decision": "pass",
  "issues": [],
  "summary": "The design document thoroughly audits existing functionality and provides clear acceptance criteria."
}
\`\`\``;
      const result = parseReviewResponse(raw);
      expect(result.decision).toBe("pass");
      expect(result.issues).toHaveLength(0);
    });

    it("parses a real-world fail response with issues", () => {
      const raw = `{
        "decision": "fail",
        "issues": [
          {"severity": "critical", "description": "No existing functionality audit — the design jumps straight to implementation."},
          {"severity": "important", "description": "Acceptance criteria are not testable — 'works well' is subjective."}
        ],
        "summary": "Design needs more rigor before planning can begin."
      }`;
      const result = parseReviewResponse(raw);
      expect(result.decision).toBe("fail");
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].severity).toBe("critical");
      expect(result.issues[1].severity).toBe("important");
    });

    it("gracefully handles LLM hallucination (non-JSON response)", () => {
      const raw = "I think this design looks great! The problem statement is clear and the approach is solid. I would recommend proceeding.";
      const result = parseReviewResponse(raw);
      expect(result.decision).toBe("fail");
      expect(result.issues[0].description).toContain("unparseable");
    });
  });

  // ─── Prompt Quality ──────────────────────────────────────────────────────

  describe("Reviewer prompts enforce development principles", () => {
    it("design review prompt checks for existing functionality audit", () => {
      const prompt = buildDesignReviewPrompt({
        problemStatement: "test",
        existingCodeAudit: "nothing found",
        reusePlan: "none",
        proposedApproach: "build it",
        acceptanceCriteria: ["it works"],
      }, "test project");
      expect(prompt).toContain("Existing Code Audit");
      expect(prompt).toContain("reuse");
    });

    it("plan review prompt checks for test-first structure", () => {
      const prompt = buildPlanReviewPrompt({
        fileStructure: [{ path: "test.ts", action: "create", purpose: "test" }],
        tasks: [{ title: "task 1", testFirst: "write test", implement: "code", verify: "run" }],
      });
      expect(prompt).toContain("test-first");
      expect(prompt).toContain("bite-sized");
    });
  });
});
