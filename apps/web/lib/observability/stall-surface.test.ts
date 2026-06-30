import { describe, expect, it } from "vitest";
import {
  buildStallSurface,
  mergeVerificationPatch,
  stallReasonToFailureAxis,
} from "./stall-surface";

describe("stallReasonToFailureAxis", () => {
  it("maps every stall reason to the timeout axis", () => {
    expect(stallReasonToFailureAxis("heartbeat_timeout")).toBe("timeout");
    expect(stallReasonToFailureAxis("total_timeout")).toBe("timeout");
    expect(stallReasonToFailureAxis("never_started")).toBe("timeout");
  });
});

describe("buildStallSurface", () => {
  it("flips an in-flight step to a failed checkpoint that resumes from it", () => {
    const surface = buildStallSurface({
      reason: "heartbeat_timeout",
      phase: "build",
      heartbeatTimeoutSeconds: 180,
      totalPhaseTimeoutSeconds: 3600,
      priorExecState: { step: "code_generated", retryCount: 0, containerId: "dpf-sandbox-1" },
      now: "2026-06-16T01:00:00.000Z",
    });

    expect(surface.failureAxis).toBe("timeout");
    expect(surface.execState.step).toBe("failed");
    expect(surface.execState.failedAt).toBe("code_generated");
    expect(surface.execState.stalledByWatchdog).toBe(true);
    expect(surface.execState.containerId).toBe("dpf-sandbox-1"); // prior fields preserved
    expect(surface.error).toMatch(/stalled \(heartbeat_timeout\)/);
    expect(surface.proactivityPlan).toMatchObject({
      resolvedLevel: "assertive",
      escalationTarget: "platform-operator",
      actionBoundary: "propose",
    });
    expect(surface.verificationPatch).toEqual({
      failureAxis: "timeout",
      stalledByWatchdog: true,
      proactivity: surface.proactivityPlan,
      observedAt: "2026-06-16T01:00:00.000Z",
    });
  });

  it("falls back to code_generated when there is no usable prior step", () => {
    const surface = buildStallSurface({
      reason: "total_timeout",
      phase: "build",
      heartbeatTimeoutSeconds: 180,
      totalPhaseTimeoutSeconds: 3600,
      priorExecState: null,
      now: "2026-06-16T01:00:00.000Z",
    });
    expect(surface.execState.failedAt).toBe("code_generated");
  });

  it("does not treat a terminal step as the resume point", () => {
    const surface = buildStallSurface({
      reason: "heartbeat_timeout",
      phase: "build",
      heartbeatTimeoutSeconds: 180,
      totalPhaseTimeoutSeconds: 3600,
      priorExecState: { step: "complete", failedAt: "tests_run" },
      now: "2026-06-16T01:00:00.000Z",
    });
    expect(surface.execState.failedAt).toBe("tests_run");
  });
});

describe("mergeVerificationPatch", () => {
  const proactivity = buildStallSurface({
    reason: "heartbeat_timeout",
    phase: "build",
    heartbeatTimeoutSeconds: 180,
    totalPhaseTimeoutSeconds: 3600,
    priorExecState: null,
    now: "2026-06-16T01:00:00.000Z",
  }).proactivityPlan;

  it("merges over an existing verificationOut, preserving prior fields", () => {
    const merged = mergeVerificationPatch(
      { testsPassed: 3, fullOutput: "ok" },
      {
        failureAxis: "timeout",
        stalledByWatchdog: true,
        observedAt: "2026-06-16T01:00:00.000Z",
        proactivity,
      },
    );
    expect(merged.testsPassed).toBe(3);
    expect(merged.failureAxis).toBe("timeout");
    expect(merged.stalledByWatchdog).toBe(true);
    expect(merged.proactivity).toMatchObject({
      resolvedLevel: "assertive",
      policyId: "proactivity:build-studio-custodian:assertive",
    });
  });

  it("tolerates a null/non-object existing value", () => {
    const merged = mergeVerificationPatch(null, {
      failureAxis: "timeout",
      stalledByWatchdog: true,
      observedAt: "2026-06-16T01:00:00.000Z",
      proactivity,
    });
    expect(merged.failureAxis).toBe("timeout");
  });
});
