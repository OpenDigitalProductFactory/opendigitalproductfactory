import { describe, expect, it } from "vitest";

import { reconcileWorktreeBinding } from "./worktree-binding-recovery";

describe("adversarial worktree binding recovery", () => {
  it("AC-FEAF-001: makes partial create cleanup idempotent and path-verified", () => {
    const unverified = reconcileWorktreeBinding({
      operation: "create",
      resourceState: "partial",
      pathVerified: false,
      oldWriterFenced: true,
      cleanupState: "not-started",
      gitEvidencePreserved: true,
    });
    expect(unverified).toMatchObject({
      state: "recovery-required",
      cleanupAllowed: false,
      mayActivateReplacement: false,
      metrics: { duplicateExecutionCount: 0 },
    });

    const cleaned = reconcileWorktreeBinding({
      operation: "create",
      resourceState: "absent",
      pathVerified: true,
      oldWriterFenced: false,
      cleanupState: "succeeded",
      gitEvidencePreserved: true,
    });
    expect(cleaned).toMatchObject({
      state: "retryable",
      cleanupAllowed: true,
      mayActivateReplacement: true,
      metrics: { recoveryOutcome: "compensated", duplicateExecutionCount: 0 },
    });
  });

  it.each(["delete", "loss"] as const)(
    "AC-FEAF-002: fences the old writer before replacement after %s",
    (operation) => {
      const beforeFence = reconcileWorktreeBinding({
        operation,
        resourceState: operation === "delete" ? "partial" : "absent",
        pathVerified: true,
        oldWriterFenced: false,
        cleanupState: "not-started",
        gitEvidencePreserved: true,
      });
      expect(beforeFence).toMatchObject({
        state: "recovery-required",
        cleanupAllowed: false,
        mayActivateReplacement: false,
        metrics: { duplicateExecutionCount: 0 },
      });

      const afterFence = reconcileWorktreeBinding({
        operation,
        resourceState: "absent",
        pathVerified: true,
        oldWriterFenced: true,
        cleanupState: "succeeded",
        gitEvidencePreserved: true,
      });
      expect(afterFence).toMatchObject({
        state: "retryable",
        mayActivateReplacement: true,
        metrics: { recoveryOutcome: "fenced", duplicateExecutionCount: 0 },
      });
    },
  );

  it("fails terminally when cleanup would discard unpreserved Git evidence", () => {
    expect(reconcileWorktreeBinding({
      operation: "delete",
      resourceState: "partial",
      pathVerified: true,
      oldWriterFenced: true,
      cleanupState: "failed",
      gitEvidencePreserved: false,
    })).toMatchObject({
      state: "terminal",
      cleanupAllowed: false,
      mayActivateReplacement: false,
    });

    expect(reconcileWorktreeBinding({
      operation: "loss",
      resourceState: "absent",
      pathVerified: true,
      oldWriterFenced: true,
      cleanupState: "succeeded",
      gitEvidencePreserved: false,
    })).toMatchObject({
      state: "terminal",
      cleanupAllowed: false,
      mayActivateReplacement: false,
      metrics: { recoveryOutcome: "evidence-at-risk" },
    });
  });
});
