import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOVERNED_LOCAL_REVIEWER,
  LOCAL_INFERENCE_TIMEOUT_CEILING_MS,
  createInferenceTimeoutSignal,
  resolveInferenceRuntimePolicy,
  resolveLocalReviewerRuntimeDiagnostics,
} from "./local-inference-runtime-policy";

describe("local inference runtime policy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives the governed Qwen3.8 27B reviewer a 600000ms timeout by default", () => {
    expect(resolveInferenceRuntimePolicy("local", GOVERNED_LOCAL_REVIEWER.modelId, {})).toEqual({
      effectiveTimeoutMs: 600_000,
      timeoutCeilingMs: 600_000,
      source: "governed-reviewer-policy",
      role: "high-trust-reviewer",
    });
  });

  it("keeps an explicit 600000ms local timeout observable and bounded", () => {
    expect(resolveInferenceRuntimePolicy("local", "ai/qwen3:8B-Q4_K_M", {
      localTimeoutMs: "600000",
    })).toEqual({
      effectiveTimeoutMs: 600_000,
      timeoutCeilingMs: 600_000,
      source: "operator-local-timeout",
      role: "general-local",
    });
    expect(resolveInferenceRuntimePolicy("local", "ai/qwen3:8B-Q4_K_M", {
      localTimeoutMs: "900000",
    }).effectiveTimeoutMs).toBe(LOCAL_INFERENCE_TIMEOUT_CEILING_MS);
  });

  it("does not abort a governed reviewer response after the old 120000ms ceiling", async () => {
    vi.useFakeTimers();
    const factory = vi.fn((timeoutMs: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), timeoutMs);
      return controller.signal;
    });
    const policy = resolveInferenceRuntimePolicy("local", GOVERNED_LOCAL_REVIEWER.modelId, {});
    const signal = createInferenceTimeoutSignal(policy.effectiveTimeoutMs, factory);

    await vi.advanceTimersByTimeAsync(120_001);

    expect(signal.aborted).toBe(false);
    expect(factory).toHaveBeenCalledWith(600_000);
  });

  it("exposes the effective governed reviewer configuration", () => {
    expect(resolveLocalReviewerRuntimeDiagnostics({ localTimeoutMs: "600000" })).toEqual({
      modelId: GOVERNED_LOCAL_REVIEWER.modelId,
      role: "high-trust-reviewer",
      effectiveTimeoutMs: 600_000,
      timeoutCeilingMs: 600_000,
      timeoutSource: "governed-reviewer-policy",
    });
  });
});
