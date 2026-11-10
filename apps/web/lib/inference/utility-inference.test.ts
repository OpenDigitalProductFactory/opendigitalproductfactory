import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentInferenceOrigin, currentInferenceSignal } from "./inference-admission";

const mocks = vi.hoisted(() => ({ routeAndCall: vi.fn(), inc: vi.fn(), observe: vi.fn() }));
vi.mock("@/lib/inference/routed-inference", () => ({ routeAndCall: mocks.routeAndCall }));
vi.mock("@/lib/tak/context-arbitrator", () => ({ countTokens: (text: string) => Math.ceil(text.length / 4) }));
vi.mock("@/lib/operate/metrics", () => ({
  utilityInferenceOps: { inc: mocks.inc }, utilityInferenceLatency: { observe: mocks.observe },
}));
import { utilityInfer } from "./utility-inference";

describe("utility inference execution boundaries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.routeAndCall.mockResolvedValue({ content: "A useful summary of the source.",
      providerId: "test-cloud", modelId: "test-model", inputTokens: 12, outputTokens: 8 });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("carries the caller's output allowance into the routed activity envelope", async () => {
    await utilityInfer({ task: "summarize", input: "Some source material.", maxOutputTokens: 128 });
    const options = mocks.routeAndCall.mock.calls[0]?.[3];
    expect(options?.activityContract?.tokenEnvelope.maxOutputTokens).toBe(128);
    expect(options?.activityContract?.activityClass).toBe("summarize");
  });

  it("uses autonomous admission rather than competing at interactive priority", async () => {
    let origin: string | undefined;
    mocks.routeAndCall.mockImplementation(async () => {
      origin = currentInferenceOrigin();
      return { content: "A useful summary of the source.", providerId: "test-cloud",
        modelId: "test-model", inputTokens: 12, outputTokens: 8 };
    });
    await utilityInfer({ task: "summarize", input: "Some source material." });
    expect(origin).toBe("autonomous");
    expect(currentInferenceOrigin()).toBe("interactive");
  });

  it("does not leave a deadline timer after successful completion", async () => {
    const result = await utilityInfer({ task: "summarize", input: "Some source material." });
    expect(result.fallback).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts supported execution at the deadline and returns one truthful fallback", async () => {
    let aborted = false;
    mocks.routeAndCall.mockImplementation(() => new Promise((_resolve, reject) => {
      const signal = currentInferenceSignal();
      signal?.addEventListener("abort", () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
    }));
    const pending = utilityInfer({ task: "summarize", input: "Some source material." });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ fallback: true, providerId: "none" });
    expect(aborted).toBe(true);
    expect(mocks.routeAndCall).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds unspecified output and refuses an invalid caller allowance before dispatch", async () => {
    await utilityInfer({ task: "summarize", input: "Some source material." });
    expect(mocks.routeAndCall.mock.calls[0]?.[3]?.activityContract?.tokenEnvelope.maxOutputTokens).toBe(512);
    mocks.routeAndCall.mockClear();
    const result = await utilityInfer({ task: "summarize", input: "Some source material.", maxOutputTokens: NaN });
    expect(result).toMatchObject({ fallback: true, providerId: "none" });
    expect(mocks.routeAndCall).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not accept a token-truncated answer as successful utility output", async () => {
    mocks.routeAndCall.mockResolvedValue({ content: "A partial summary that ended at the token limit.",
      providerId: "test-cloud", modelId: "test-model", inputTokens: 12, outputTokens: 128, truncated: true });
    expect(await utilityInfer({ task: "summarize", input: "Complete source material." }))
      .toMatchObject({ fallback: true, providerId: "test-cloud", output: "Complete source material." });
  });
});
