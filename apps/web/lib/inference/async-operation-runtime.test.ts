import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./ai-inference", () => ({ callProvider: vi.fn() }));
vi.mock("./async-inference", () => ({ pollAsyncProviderOperation: vi.fn() }));
vi.mock("@/lib/execution/adapters/async-operation-events", () => ({
  enqueueAsyncOperationWake: vi.fn(),
  publishAsyncOperationTransitionEvent: vi.fn(),
}));

import { normalizeDurableAsyncProviderPoll } from "./async-operation-runtime";

describe("durable provider poll normalization", () => {
  it("projects a supported provider terminal failure without retry", () => {
    expect(normalizeDurableAsyncProviderPoll({
      done: true,
      terminalStatus: "failed",
      errorMessage: "Gemini interaction budget_exceeded",
      progressMessage: "Failed",
      raw: { status: "budget_exceeded" },
    })).toEqual({
      kind: "failed",
      error: "ASYNC_PROVIDER_REPORTED_FAILURE",
    });
  });

  it("projects a provider incomplete outcome as a durable non-retryable failure", () => {
    expect(normalizeDurableAsyncProviderPoll({
      done: true,
      terminalStatus: "failed",
      errorMessage: "Gemini interaction was incomplete",
      progressMessage: "Failed",
    })).toEqual({
      kind: "failed",
      error: "ASYNC_PROVIDER_REPORTED_FAILURE",
    });
  });

  it("drops provider-controlled diagnostics before the durable worker boundary", () => {
    const normalized = normalizeDurableAsyncProviderPoll({
      done: true,
      terminalStatus: "failed",
      errorMessage: "Bearer secret-token customer prompt text",
      progressMessage: "Failed",
      raw: { error: "Bearer secret-token" },
    });

    expect(normalized).toEqual({
      kind: "failed",
      error: "ASYNC_PROVIDER_REPORTED_FAILURE",
    });
    expect(JSON.stringify(normalized)).not.toContain("secret-token");
    expect(JSON.stringify(normalized)).not.toContain("customer prompt text");
  });

  it("keeps cancellation, progress, and completion distinct", () => {
    expect(normalizeDurableAsyncProviderPoll({
      done: true,
      terminalStatus: "cancelled",
      progressMessage: "Provider cancelled",
    })).toEqual({ kind: "cancelled", reason: "Provider cancelled" });
    expect(normalizeDurableAsyncProviderPoll({
      done: false,
      progressPct: 25,
      progressMessage: "running",
    })).toEqual({
      kind: "running",
      progressPct: 25,
      progressMessage: "Provider operation in progress",
    });
    expect(normalizeDurableAsyncProviderPoll({
      done: true,
      terminalStatus: "completed",
      text: "result",
      raw: { usage: {} },
    })).toEqual({ kind: "completed", text: "result", data: { usage: {} } });
  });
});
