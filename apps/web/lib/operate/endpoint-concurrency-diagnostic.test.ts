import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ai-inference", () => ({ callProvider: vi.fn() }));
import { runEndpointConcurrencyDiagnostic } from "./endpoint-concurrency-diagnostic";
import { acquireInferenceSlot, __resetInferenceAdmissionForTest, currentInferenceSignal, withInferenceCancellation,
  currentInferenceOrigin, withInferenceOrigin } from "@/lib/inference/inference-admission";
import { LocalProviderCapacityDeferredError } from "@/lib/routing/local-provider-capacity";

const answer = { content: "READY", inputTokens: 2, outputTokens: 1, inferenceMs: 1,
  truncated: false, raw: { choices: [{ finish_reason: "stop" }] } };
beforeEach(() => { __resetInferenceAdmissionForTest(); vi.stubEnv("DPF_INFERENCE_MAX_CONCURRENCY_LOCAL", "1"); });
afterEach(() => { __resetInferenceAdmissionForTest(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("two ordinary caller evidence", () => {
  it("passes only actual queued/handoff/release events and two complete answers", async () => {
    const call = vi.fn(async () => {
      const release = await acquireInferenceSlot("local", "interactive");
      try { await new Promise(resolve => setTimeout(resolve, 5)); return answer; }
      finally { release(); }
    });
    const result = await runEndpointConcurrencyDiagnostic("local", "test-model", call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe("passed");
    expect(result.contentionObserved).toBe(true);
    expect(result.callers.map(c => c.content)).toEqual(["READY", "READY"]);
    expect(result.callers.map(c => c.finishReason)).toEqual(["stop", "stop"]);
    expect(result.callers.every(c => c.released)).toBe(true);
    expect(result.events.filter(e => e.phase === "queued")).toHaveLength(1);
  });

  it("does not infer contention from two successful promises without actual admission events", async () => {
    const result = await runEndpointConcurrencyDiagnostic("local", "test-model", async () => answer);
    expect(result.outcome).toBe("deferred");
    expect(result.contentionObserved).toBe(false);
  });

  it.each([
    { ...answer, truncated: true },
    { ...answer, raw: { choices: [{ finish_reason: "length" }] } },
    { ...answer, raw: undefined },
  ])("preserves incomplete answer evidence without passing it", async incomplete => {
    const result = await runEndpointConcurrencyDiagnostic("local", "test-model", async () => incomplete);
    expect(result.outcome).toBe("deferred");
    expect(result.callers[0]?.content).toBe("READY");
    expect(result.callers[0]?.outputTokens).toBe(1);
  });

  it("rejects reasoning-only output even if the provider reports stop", async () => {
    const result = await runEndpointConcurrencyDiagnostic("local", "test-model", async () => ({
      ...answer, content: "", raw: { choices: [{ finish_reason: "stop", message: { reasoning_content: "READY" } }] },
    }));
    expect(result.outcome).toBe("failed");
    expect(result.callers[0]?.content).toBe("");
  });

  it("keeps capacity deferral neutral", async () => {
    const result = await runEndpointConcurrencyDiagnostic("local", "test-model", async () => {
      throw new LocalProviderCapacityDeferredError("local-ci-active-capacity-reservation");
    });
    expect(result.outcome).toBe("deferred");
    expect(result.callers).toHaveLength(2);
  });

  it("bounds the whole observation and stops both callers through cancellation", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const running = runEndpointConcurrencyDiagnostic("local", "test-model", async () => {
      const signal = currentInferenceSignal()!;
      signals.push(signal);
      return await new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await running;
    expect(result.outcome).toBe("deferred");
    expect(signals).toHaveLength(2);
    expect(signals.every(s => s.aborted)).toBe(true);
  });

  it("rejects remote or unspecified targets before any call", async () => {
    const call = vi.fn();
    await expect(runEndpointConcurrencyDiagnostic("openai", "test-model", call)).rejects.toThrow();
    await expect(runEndpointConcurrencyDiagnostic("local", "", call)).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  it("does not start either caller when the inherited parent is already canceled", async () => {
    const parent = new AbortController();
    parent.abort(new Error("parent stopped"));
    const call = vi.fn().mockResolvedValue(answer);
    const result = await withInferenceCancellation(parent.signal, () =>
      runEndpointConcurrencyDiagnostic("local", "test-model", call));
    expect(result.outcome).toBe("deferred");
    expect(call).not.toHaveBeenCalled();
  });

  it("preserves background priority while observing both callers", async () => {
    const origins: string[] = [];
    const result = await withInferenceOrigin("autonomous", () =>
      runEndpointConcurrencyDiagnostic("local", "test-model", async () => {
        const origin = currentInferenceOrigin();
        origins.push(origin);
        const release = await acquireInferenceSlot("local", origin);
        try { await new Promise(resolve => setTimeout(resolve, 5)); return answer; }
        finally { release(); }
      }));
    expect(origins).toEqual(["autonomous", "autonomous"]);
    expect(result.outcome).toBe("passed");
  });
});
