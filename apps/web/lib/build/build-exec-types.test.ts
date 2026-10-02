import { describe, it, expect } from "vitest";
import {
  planExecStateRecovery,
  classifyContradictoryExecState,
  isInfrastructureFailure,
  isContradictoryExecState,
  type BuildExecutionState,
} from "./build-exec-types";

// Pure classification + recovery for the Build Studio engine-reliability fixes
// (spec §3.1 engine-first / FB-78E967D4 / FB-F0476EF3). Single source of truth
// reused by the UI affordance and the boot reconciler — verified here.

describe("classifyContradictoryExecState", () => {
  it("returns null for a null/undefined state (no exec state = not contradictory)", () => {
    expect(classifyContradictoryExecState(null)).toBeNull();
    expect(classifyContradictoryExecState(undefined)).toBeNull();
  });

  it("returns null for a healthy in-flight step with no error breadcrumb", () => {
    expect(classifyContradictoryExecState({ step: "deps_installed" })).toBeNull();
  });

  it("returns null for a legitimate `failed` step (retryBuildExecution handles it)", () => {
    expect(
      classifyContradictoryExecState({ step: "failed", failedAt: "db_ready", error: "boom" }),
    ).toBeNull();
  });

  it("flags missing-step when state has content but no step (restart before step 1)", () => {
    expect(
      classifyContradictoryExecState({ sourceCurrency: { x: 1 }, retryCount: 0 } as never),
    ).toBe("missing-step");
  });

  it("flags error-without-fail for a non-failed step carrying an error breadcrumb", () => {
    expect(
      classifyContradictoryExecState({ step: "complete", error: "threw mid-run" }),
    ).toBe("error-without-fail");
    expect(
      classifyContradictoryExecState({ step: "code_generated", failedAt: "code_generated" }),
    ).toBe("error-without-fail");
  });

  it("error-without-fail takes precedence over complete-no-verify on a complete+error row", () => {
    // FB-F0476EF3 canonical relic: step=complete AND error, verificationOut null.
    expect(
      classifyContradictoryExecState({ step: "complete", error: "x" }, null),
    ).toBe("error-without-fail");
  });

  it("flags complete-no-verify when step=complete but verificationOut is null", () => {
    expect(classifyContradictoryExecState({ step: "complete" }, null)).toBe(
      "complete-no-verify",
    );
    expect(classifyContradictoryExecState({ step: "complete" }, undefined)).toBe(
      "complete-no-verify",
    );
  });

  it("returns null for a genuinely complete build with verification present", () => {
    expect(
      classifyContradictoryExecState({ step: "complete" }, { typecheckPassed: true }),
    ).toBeNull();
  });
});

describe("isContradictoryExecState", () => {
  it("mirrors classifyContradictoryExecState as a boolean", () => {
    expect(isContradictoryExecState(null)).toBe(false);
    expect(isContradictoryExecState({ step: "complete" }, null)).toBe(true);
    expect(isContradictoryExecState({ step: "deps_installed" })).toBe(false);
  });
});

describe("planExecStateRecovery", () => {
  it("plans `none` for a healthy / non-contradictory state (idempotent on reruns)", () => {
    expect(planExecStateRecovery({ step: "deps_installed" })).toEqual({ action: "none" });
    expect(planExecStateRecovery({ step: "failed", failedAt: "db_ready" })).toEqual({
      action: "none",
    });
    expect(planExecStateRecovery(null)).toEqual({ action: "none" });
  });

  it("coerces an error-without-fail row to `failed`, preserving pointers + diagnosis", () => {
    const state = {
      step: "complete",
      error: "threw mid-run",
      containerId: "c-123",
      hostPort: 3035,
      retryCount: 1,
      startedAt: "2026-06-05T00:00:00.000Z",
    } as unknown as BuildExecutionState;

    const plan = planExecStateRecovery(state, null);
    expect(plan.action).toBe("to-failed");
    if (plan.action !== "to-failed") throw new Error("expected to-failed");
    expect(plan.reason).toBe("error-without-fail");
    expect(plan.state.step).toBe("failed");
    // failedAt falls back to the prior step when no explicit failedAt existed.
    expect(plan.state.failedAt).toBe("complete");
    expect(plan.state.error).toBe("threw mid-run");
    // Live container/port pointers are preserved so retry reuses the sandbox.
    expect(plan.state.containerId).toBe("c-123");
    expect(plan.state.hostPort).toBe(3035);
  });

  it("uses an explicit failedAt over the current step when coercing to failed", () => {
    const plan = planExecStateRecovery(
      { step: "code_generated", failedAt: "db_ready", error: "x" } as unknown as BuildExecutionState,
    );
    expect(plan.action).toBe("to-failed");
    if (plan.action !== "to-failed") throw new Error("expected to-failed");
    expect(plan.state.failedAt).toBe("db_ready");
  });

  it("clears a missing-step row for a clean restart", () => {
    const plan = planExecStateRecovery({ sourceCurrency: { x: 1 } } as never);
    expect(plan).toEqual({ action: "clear", reason: "missing-step" });
  });

  it("clears a complete-no-verify row for a clean restart", () => {
    const plan = planExecStateRecovery({ step: "complete" } as unknown as BuildExecutionState, null);
    expect(plan).toEqual({ action: "clear", reason: "complete-no-verify" });
  });

  it("is idempotent: re-running the plan on the coerced state yields `none`", () => {
    const first = planExecStateRecovery(
      { step: "complete", error: "x" } as unknown as BuildExecutionState,
      null,
    );
    if (first.action !== "to-failed") throw new Error("expected to-failed");
    // The coerced `failed` state is no longer contradictory → none.
    expect(planExecStateRecovery(first.state, null)).toEqual({ action: "none" });
  });
});

describe("infrastructure-failed checkpoints restart on their own (AGENTS.md §4: fail open on infrastructure)", () => {
  const infra = {
    step: "failed" as const,
    failedAt: "pending",
    error: "Command failed: docker exec 'dpf-sandbox-1' sh -c 'git config --global --add safe.directory \"/workspace\" ... fatal: detected dubious ownership in repository at '/workspace'",
  };

  it("classifies a failed step whose error names the sandbox git plumbing as infrastructure-failed and clears it", () => {
    expect(classifyContradictoryExecState(infra)).toBe("infrastructure-failed");
    expect(planExecStateRecovery(infra)).toEqual({ action: "clear", reason: "infrastructure-failed" });
  });

  it("recognises the missing-container and not-a-repository faults too", () => {
    expect(isInfrastructureFailure("Error response from daemon: No such container: dpf-sandbox-2")).toBe(true);
    expect(isInfrastructureFailure("fatal: not a git repository: (null)")).toBe(true);
  });

  it("leaves a failed step whose error is about the build's own work for Retry", () => {
    const product = { step: "failed" as const, failedAt: "tests_run", error: "2 tests failed: expected 200, received 500" };
    expect(classifyContradictoryExecState(product)).toBeNull();
    expect(planExecStateRecovery(product)).toEqual({ action: "none" });
    expect(isInfrastructureFailure(null)).toBe(false);
  });
});
