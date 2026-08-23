// apps/web/lib/build-pipeline.test.ts
// Tests for pure state machine functions in the build pipeline.

import { describe, it, expect } from "vitest";
import { getResumeStep, shouldRetry, nextStep, buildFailedState, executeStep } from "./build-pipeline";
import type { BuildExecutionState } from "./build-exec-types";

describe("getResumeStep", () => {
  it("returns 'pending' for null state", () => {
    expect(getResumeStep(null)).toBe("pending");
  });
  it("returns failedAt step for failed state", () => {
    const state: BuildExecutionState = {
      step: "failed", failedAt: "db_ready", retryCount: 3, startedAt: "2026-01-01T00:00:00Z",
    };
    expect(getResumeStep(state)).toBe("db_ready");
  });
  it("returns next step for in-progress state", () => {
    const state: BuildExecutionState = {
      step: "workspace_initialized", retryCount: 0, startedAt: "2026-01-01T00:00:00Z",
    };
    expect(getResumeStep(state)).toBe("db_ready");
  });
});

describe("shouldRetry", () => {
  it("allows retry when count is below max", () => {
    expect(shouldRetry("sandbox_created", 0)).toBe(true);
    expect(shouldRetry("sandbox_created", 2)).toBe(true);
  });
  it("denies retry when count equals max", () => {
    expect(shouldRetry("sandbox_created", 3)).toBe(false);
  });
  it("retries the stepComplete (diff/commit capture) dispatch up to its budget", () => {
    // The "tests_run" slot dispatches stepComplete, which now extracts the
    // sandbox diff and commit hashes back onto the FeatureBuild row. A
    // transient sandbox hiccup (index lock, mid-rebuild) shouldn't strand
    // an otherwise-complete build — give it retry budget like the other
    // sandbox-touching steps.
    expect(shouldRetry("tests_run", 0)).toBe(true);
    expect(shouldRetry("tests_run", 1)).toBe(true);
    expect(shouldRetry("tests_run", 2)).toBe(false);
  });
  it("never retries the terminal complete step", () => {
    expect(shouldRetry("complete", 0)).toBe(false);
  });
});

describe("nextStep", () => {
  it("returns the next step in order", () => {
    expect(nextStep("pending")).toBe("sandbox_created");
    expect(nextStep("sandbox_created")).toBe("workspace_initialized");
    expect(nextStep("workspace_initialized")).toBe("db_ready");
    expect(nextStep("tests_run")).toBe("complete");
  });
  it("returns null for complete or failed", () => {
    expect(nextStep("complete")).toBeNull();
    expect(nextStep("failed")).toBeNull();
  });
});

describe("buildFailedState", () => {
  it("sets step to failed with error details", () => {
    const base: BuildExecutionState = {
      step: "db_ready", retryCount: 2, startedAt: "2026-01-01T00:00:00Z", containerId: "abc",
    };
    const result = buildFailedState(base, "db_ready", "Connection refused");
    expect(result.step).toBe("failed");
    expect(result.failedAt).toBe("db_ready");
    expect(result.error).toBe("Connection refused");
    expect(result.containerId).toBe("abc");
  });

  it("strips completedAt so a prior success cannot leave a completed-yet-failed checkpoint", () => {
    const base: BuildExecutionState = {
      step: "complete",
      retryCount: 0,
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:05:00Z",
      containerId: "sb-1",
    };
    const result = buildFailedState(base, "deps_installed", "brief.targetRoles undefined");
    expect(result.step).toBe("failed");
    expect(result.failedAt).toBe("deps_installed");
    expect(result.error).toBe("brief.targetRoles undefined");
    // completedAt must be gone -- contradictory state was the FB-78E967D4 root
    expect(result.completedAt).toBeUndefined();
    expect(result.containerId).toBe("sb-1");
  });
});

describe("diff capture cannot silently succeed (BI-79176815)", () => {
  const noop = () => {};

  // The capture step used to open with `if (!state.containerId) return state;`.
  // A build whose container had been reaped therefore advanced to "complete"
  // with diffPatch, diffSummary and gitCommitHashes all empty and NOTHING
  // logged — indistinguishable from a build that legitimately changed nothing.
  // Observed live: Build Studio committed a real change to its build branch and
  // the FeatureBuild row recorded none of it.
  const stateWithoutContainer = {
    step: "tests_run",
    retryCount: 0,
  } as unknown as BuildExecutionState;

  it("fails the capture step instead of completing with an empty result", async () => {
    await expect(
      executeStep("tests_run", "FB-TEST", stateWithoutContainer, noop),
    ).rejects.toThrow(/no sandbox container/i);
  });

  it("names the build, so the failure is actionable from the log alone", async () => {
    await expect(
      executeStep("tests_run", "FB-TEST", stateWithoutContainer, noop),
    ).rejects.toThrow(/FB-TEST/);
  });

  it("says the work may still exist rather than implying it was lost", async () => {
    // The owner-facing distinction that matters: "we could not record this"
    // is not the same claim as "nothing changed".
    await expect(
      executeStep("tests_run", "FB-TEST", stateWithoutContainer, noop),
    ).rejects.toThrow(/cannot be recorded/i);
  });

  it("leaves other steps alone", async () => {
    const state = { step: "done", retryCount: 0 } as unknown as BuildExecutionState;
    await expect(
      executeStep("default" as never, "FB-TEST", state, noop),
    ).resolves.toBe(state);
  });
});
