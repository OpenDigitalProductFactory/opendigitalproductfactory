import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./ai-inference", () => ({ callProvider: vi.fn() }));
vi.mock("./async-inference", () => ({ pollAsyncProviderOperation: vi.fn() }));
vi.mock("@/lib/execution/adapters/async-operation-events", () => ({
  enqueueAsyncOperationWake: vi.fn(),
  publishAsyncOperationTransitionEvent: vi.fn(),
}));

import {
  durableMcpTaskWakeDisposition,
  normalizeDurableAsyncProviderPoll,
} from "./async-operation-runtime";

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

describe("durable MCP TaskRun provider-wake gate", () => {
  it("waits until the TaskRun durably projects the exact operation", () => {
    expect(durableMcpTaskWakeDisposition({
      operationId: "async-op-1",
      progressPayload: { durableInference: { state: "admitting" } },
    })).toBe("wait");
  });

  it("propagates pre-admission cancellation before provider work can start", () => {
    expect(durableMcpTaskWakeDisposition({
      operationId: "async-op-1",
      progressPayload: {
        durableInference: {
          state: "admitting",
          cancellationRequestedAt: "2026-09-04T12:00:00.000Z",
        },
      },
    })).toBe("cancel");
  });

  it("accepts only the exact TaskRun-projected operation id", () => {
    expect(durableMcpTaskWakeDisposition({
      operationId: "async-op-1",
      progressPayload: {
        durableInference: { state: "admitted", asyncOperationId: "async-op-1" },
      },
    })).toBe("ready");
    expect(() => durableMcpTaskWakeDisposition({
      operationId: "async-op-1",
      progressPayload: {
        durableInference: { state: "admitted", asyncOperationId: "other-op" },
      },
    })).toThrow("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
  });
});
