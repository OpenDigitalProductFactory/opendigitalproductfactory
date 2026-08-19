// BI-89030C9B Phase 1 — unit tests for the pure decision logic behind the
// durable build-execution path. Side-effect helpers (ensureBuildTaskRun,
// runPipelineStepDurable, finalizeDurableBuild) are exercised by the
// functional kill-test on the live install (plan Phase-1 verification);
// these tests pin the pure contracts the Inngest function relies on.

import { describe, expect, it } from "vitest";
import type { BuildExecutionState } from "@/lib/build-exec-types";
import {
  BUILD_DURABLE_EXECUTION_FLAG,
  buildExecuteSendId,
  isBuildDurableExecutionEnabled,
  shouldRunPipelineStep,
} from "./build-execute-helpers";

function state(partial: Partial<BuildExecutionState>): BuildExecutionState {
  return {
    step: "pending",
    retryCount: 0,
    startedAt: "2026-06-10T00:00:00.000Z",
    ...partial,
  };
}

describe("isBuildDurableExecutionEnabled", () => {
  it("is off by default (legacy path untouched without the flag)", () => {
    expect(isBuildDurableExecutionEnabled({})).toBe(false);
    expect(isBuildDurableExecutionEnabled({ [BUILD_DURABLE_EXECUTION_FLAG]: "" })).toBe(false);
    expect(isBuildDurableExecutionEnabled({ [BUILD_DURABLE_EXECUTION_FLAG]: "0" })).toBe(false);
    expect(isBuildDurableExecutionEnabled({ [BUILD_DURABLE_EXECUTION_FLAG]: "off" })).toBe(false);
  });

  it("accepts the standard truthy spellings", () => {
    for (const v of ["1", "true", "yes", "on", " TRUE "]) {
      expect(isBuildDurableExecutionEnabled({ [BUILD_DURABLE_EXECUTION_FLAG]: v })).toBe(true);
    }
  });
});

describe("buildExecuteSendId", () => {
  it("is stable for the same logical attempt (dedup across the four call sites)", () => {
    const s = state({ step: "deps_installed" });
    expect(buildExecuteSendId("b1", s)).toBe(buildExecuteSendId("b1", s));
  });

  it("differs across builds, checkpoints, and retry counts (new attempts get new runs)", () => {
    const atDeps = state({ step: "deps_installed" });
    expect(buildExecuteSendId("b1", atDeps)).not.toBe(buildExecuteSendId("b2", atDeps));
    expect(buildExecuteSendId("b1", atDeps)).not.toBe(
      buildExecuteSendId("b1", state({ step: "code_generated" })),
    );
    expect(buildExecuteSendId("b1", atDeps)).not.toBe(
      buildExecuteSendId("b1", state({ step: "deps_installed", retryCount: 1 })),
    );
  });

  it("treats a fresh build (no checkpoint) distinctly", () => {
    expect(buildExecuteSendId("b1", null)).toBe("build-execute:b1:fresh:r0");
  });
});

describe("shouldRunPipelineStep", () => {
  it("runs every step on a fresh build", () => {
    expect(shouldRunPipelineStep(null, "pending")).toBe("run");
    expect(shouldRunPipelineStep(null, "deps_installed")).toBe("run");
  });

  it("runs the step the checkpoint is at (state.step names the reached milestone)", () => {
    expect(shouldRunPipelineStep(state({ step: "pending" }), "pending")).toBe("run");
    expect(shouldRunPipelineStep(state({ step: "deps_installed" }), "deps_installed")).toBe("run");
  });

  it("skips steps the checkpoint is already past (resume semantics)", () => {
    const atCodeGen = state({ step: "code_generated" });
    expect(shouldRunPipelineStep(atCodeGen, "pending")).toBe("skip-completed");
    expect(shouldRunPipelineStep(atCodeGen, "deps_installed")).toBe("skip-completed");
    expect(shouldRunPipelineStep(atCodeGen, "code_generated")).toBe("run");
  });

  it("halts on a failed checkpoint — failure is a journaled outcome, not a re-run", () => {
    const failed = state({ step: "failed", failedAt: "deps_installed", error: "boom" });
    expect(shouldRunPipelineStep(failed, "pending")).toBe("halt-failed");
    expect(shouldRunPipelineStep(failed, "deps_installed")).toBe("halt-failed");
    expect(shouldRunPipelineStep(failed, "tests_run")).toBe("halt-failed");
  });

  it("skips everything once complete", () => {
    const complete = state({ step: "complete", completedAt: "2026-06-10T01:00:00.000Z" });
    expect(shouldRunPipelineStep(complete, "pending")).toBe("skip-completed");
    expect(shouldRunPipelineStep(complete, "tests_run")).toBe("skip-completed");
  });
});
