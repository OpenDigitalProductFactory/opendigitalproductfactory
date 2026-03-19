// apps/web/lib/build-pipeline.test.ts
// Tests for pure state machine functions in the build pipeline.

import { describe, it, expect } from "vitest";
import { getResumeStep, shouldRetry, nextStep, buildFailedState } from "./build-pipeline";
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
  it("never retries tests_run or complete", () => {
    expect(shouldRetry("tests_run", 0)).toBe(false);
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
});
