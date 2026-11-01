import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InferenceError } from "./inference-error";
import type { GoldenTest } from "./golden-tests";
import { getTestsForDimension } from "./golden-tests";

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/lib/ai-inference", async () => ({ ...(await import("./inference-error")), callProvider: dispatch }));
import { runGoldenTest } from "./eval-golden-test";

const fixture: GoldenTest = { id: "selected-fixture", version: 1, dimension: "reasoning", prompt: "Reply OK", scoring: "exact", expectedOutput: "OK", maxTokens: 32 };

describe("golden-test provenance", () => {
  beforeEach(() => {
    dispatch.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each(getTestsForDimension("conversational"))("keeps an unavailable grader unverified ($id)", async test => {
    dispatch.mockResolvedValue({ content: "A complete response.", truncated: false });
    const result = await runGoldenTest("local", "selected-model", test);
    expect(result.score).toBeNull();
    expect(result.error).toMatch(/grader|unverified/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("returns the dispatch trace without inventing a coworker thread or changing the target/budget", async () => {
    dispatch.mockResolvedValue({ content: "OK" });
    const result = await runGoldenTest("local", "selected-model", fixture);
    const args = dispatch.mock.calls[0]!;
    expect(args.slice(0, 2)).toEqual(["local", "selected-model"]);
    expect(args[5]).toMatchObject({ maxTokens: 32, contractFamily: "model-calibration.dimension" });
    expect(args[8]).toMatchObject({ traceId: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(args[8]).not.toHaveProperty("threadId");
    expect(result).toMatchObject({ traceId: args[8].traceId, score: 10 });
  });

  it("uses a commissioned dispatcher and leaves uncertain completion unscored", async () => {
    dispatch.mockResolvedValue({ content: "OK" });
    const commissioned = vi.fn().mockResolvedValue({ content: "OK" });
    const result = await runGoldenTest("chatgpt", "selected", fixture, { dispatch: commissioned, requireComplete: true });
    expect(commissioned).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.score).toBeNull();
  });

  it.each(["exact", "tool_call"] as const)("does not score a known-truncated %s match", async scoring => {
    const test = { ...fixture, scoring, expectedOutput: scoring === "exact" ? "OK" : "lookup" };
    dispatch.mockResolvedValue({ content: "OK", toolCalls: [{ name: "lookup", arguments: {} }], truncated: true });
    const result = await runGoldenTest("local", "selected-model", test);
    expect(result).toMatchObject({ score: null, truncated: true, response: "OK", traceId: dispatch.mock.calls[0]![8].traceId });
    expect(result.error).toMatch(/truncated.*unverified/i);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not turn a truncated mismatch into a measured failure", async () => {
    dispatch.mockResolvedValue({ content: "WRONG", truncated: true });
    const result = await runGoldenTest("local", "selected-model", fixture);
    expect(result).toMatchObject({ score: null, truncated: true, response: "WRONG" });
  });

  it.each([["OK", 10], ["WRONG", 0]])("retains measured scoring for a complete control (%s)", async (content, score) => {
    dispatch.mockResolvedValue({ content, truncated: false });
    const result = await runGoldenTest("local", "selected-model", fixture);
    expect(result).toMatchObject({ score, truncated: false });
    expect(result.error).toBeUndefined();
  });

  it("retains the dispatch trace for a terminal error", async () => {
    dispatch.mockRejectedValue(new Error("transport unavailable"));
    const result = await runGoldenTest("local", "selected-model", fixture);
    expect(result).toMatchObject({ traceId: expect.stringMatching(/^[a-f0-9]{32}$/), score: 0, error: "transport unavailable" });
    expect(result.traceId).toBe(dispatch.mock.calls[0]![8].traceId);
  });

  it.each([false, true])("correlates both bounded retry attempts with the stored result (terminal error=%s)", async terminalError => {
    vi.useFakeTimers();
    dispatch.mockRejectedValueOnce(new InferenceError("limited", "rate_limit", "local"));
    if (terminalError) dispatch.mockRejectedValueOnce(new Error("second attempt unavailable"));
    else dispatch.mockResolvedValueOnce({ content: "OK" });
    const pending = runGoldenTest("local", "selected-model", fixture);
    await vi.advanceTimersByTimeAsync(10_001);
    const result = await pending;
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(dispatch.mock.calls[0]![8].traceId).toBe(result.traceId);
    expect(dispatch.mock.calls[1]![8].traceId).toBe(result.traceId);
  });
});
