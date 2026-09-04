import { describe, expect, it, vi } from "vitest";

import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import {
  createDurableAsyncProviderDependencies,
  parseDurableAsyncProviderContext,
} from "./async-operation-provider";
import { AsyncProviderStartError } from "./async-operation-worker";

const now = new Date("2026-09-04T12:00:00.000Z");

function operation(context: Record<string, unknown>): AsyncOperationRecord {
  return {
    id: "op-1",
    authorityScopeKey: "task-run:tr-1",
    requestKey: "request-1",
    requestDigest: "a".repeat(64),
    bindingDigest: "b".repeat(64),
    providerId: "gemini",
    modelId: "deep-research-pro-preview-12-2025",
    contractFamily: "research",
    screenedRequestContext: context,
    taskRunId: "tr-1",
    workroomId: null,
    status: "pending",
    providerOperationId: null,
    checkpointSequence: 0,
    transitionSequence: 0,
    startClaimFence: 1,
    startAttemptedAt: null,
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date(now.getTime() + 30_000),
    cancelRequestedAt: null,
    nextPollAt: null,
    resultText: null,
    resultData: null,
    errorMessage: null,
    progressPct: null,
    progressMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt: new Date(now.getTime() + 60_000),
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    messages: [{ role: "user", content: "Research durable workflows" }],
    systemPrompt: "Use immutable evidence.",
    tools: [],
    executionPlan: {
      providerId: "gemini",
      modelId: "deep-research-pro-preview-12-2025",
      recipeId: "recipe-1",
      contractFamily: "research",
      executionAdapter: "async",
      maxTokens: 4096,
      providerSettings: {},
      toolPolicy: {},
      responsePolicy: {},
    },
    attribution: { traceId: "trace-1", agentId: "agent-1" },
    ...overrides,
  };
}

describe("durable async provider boundary", () => {
  it("accepts only a screened async plan bound to the persisted provider identity", () => {
    expect(parseDurableAsyncProviderContext(operation(context()))).toMatchObject({
      version: 1,
      messages: [{ role: "user", content: "Research durable workflows" }],
      executionPlan: {
        providerId: "gemini",
        modelId: "deep-research-pro-preview-12-2025",
        executionAdapter: "async",
      },
    });
    expect(() => parseDurableAsyncProviderContext(operation(context({
      executionPlan: { ...context().executionPlan as object, providerId: "other" },
    })))).toThrow("ASYNC_OPERATION_CONTEXT_PROVIDER_MISMATCH");
  });

  it("rejects persisted credentials and non-async execution plans", () => {
    expect(() => parseDurableAsyncProviderContext(operation(context({
      authorization: "Bearer secret",
    })))).toThrow("ASYNC_OPERATION_CONTEXT_CONTAINS_CREDENTIALS");
    expect(() => parseDurableAsyncProviderContext(operation(context({
      executionPlan: { ...context().executionPlan as object, executionAdapter: "chat" },
    })))).toThrow("ASYNC_OPERATION_CONTEXT_ADAPTER_INVALID");
  });

  it.each([
    "api_key",
    "access_token",
    "refresh_token",
    "client_secret",
    "accessToken",
    "clientSecret",
    "auth",
    "bearer",
  ])("rejects nested credential alias %s before durable persistence", (fieldName) => {
    expect(() => parseDurableAsyncProviderContext(operation(context({
      metadata: {
        safe: "retained",
        nested: { [fieldName]: "credential-value" },
      },
    })))).toThrow("ASYNC_OPERATION_CONTEXT_CONTAINS_CREDENTIALS");
  });

  it("screens the exact JSON value produced by custom toJSON hooks", () => {
    const hiddenCredential = {
      harmless: true,
      toJSON: () => ({ access_token: "Bearer hidden-secret" }),
    };

    expect(() => parseDurableAsyncProviderContext(operation(context({
      messages: [{ role: "user", content: hiddenCredential }],
    })))).toThrow("ASYNC_OPERATION_CONTEXT_CONTAINS_CREDENTIALS");
  });

  it("returns only the typed accepted handle and classifies crossed network starts as ambiguous", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      content: "",
      asyncOperation: { status: "accepted", providerOperationId: "interaction-1" },
    });
    const dependencies = createDurableAsyncProviderDependencies({
      dispatch,
      poll: vi.fn(),
      reconcile: vi.fn(),
    });

    await expect(dependencies.startProvider(operation(context())))
      .resolves.toEqual({ providerOperationId: "interaction-1" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "gemini",
      modelId: "deep-research-pro-preview-12-2025",
    }));

    dispatch.mockRejectedValueOnce(Object.assign(new Error("socket closed"), { code: "network" }));
    await expect(dependencies.startProvider(operation(context())))
      .rejects.toMatchObject({ boundary: "ambiguous" } satisfies Partial<AsyncProviderStartError>);
  });

  it("fails closed when dispatch returns no typed accepted handle", async () => {
    const dependencies = createDurableAsyncProviderDependencies({
      dispatch: vi.fn().mockResolvedValue({ raw: { operationId: "raw-is-not-authority" } }),
      poll: vi.fn(),
      reconcile: vi.fn(),
    });

    await expect(dependencies.startProvider(operation(context())))
      .rejects.toMatchObject({ boundary: "ambiguous" } satisfies Partial<AsyncProviderStartError>);
  });

  it("never treats a server-side start failure as proof that POST did not cross", async () => {
    const dispatch = vi.fn();
    const dependencies = createDurableAsyncProviderDependencies({
      dispatch,
      poll: vi.fn(),
      reconcile: vi.fn(),
    });

    dispatch.mockRejectedValueOnce(Object.assign(new Error("upstream unavailable"), {
      statusCode: 503,
    }));
    await expect(dependencies.startProvider(operation(context())))
      .rejects.toMatchObject({ boundary: "ambiguous" } satisfies Partial<AsyncProviderStartError>);

    dispatch.mockRejectedValueOnce(Object.assign(new Error("invalid request"), {
      statusCode: 400,
    }));
    await expect(dependencies.startProvider(operation(context())))
      .rejects.toMatchObject({ boundary: "definite-rejection" } satisfies Partial<AsyncProviderStartError>);
  });
});
