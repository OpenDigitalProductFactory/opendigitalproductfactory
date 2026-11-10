import { describe, expect, it, vi } from "vitest";

import type { AsyncOperationRecord } from "./async-operation-lifecycle";
import {
  createDurableAsyncProviderDependencies,
  parseDurableAsyncProviderContext,
} from "./async-operation-provider";
import { AsyncProviderStartError } from "./async-operation-worker";
import { screenInferencePayload } from "./data-screening/screen-inference-payload";
import { assertDurableDispatchScreen } from "./durable-dispatch-screen";

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
  const messages = [{ role: "user" as const, content: "Research durable workflows" }];
  const systemPrompt = "Use immutable evidence.";
  const screenInput = {
    messages,
    systemPrompt,
    tools: [] as Array<Record<string, unknown>>,
    taskType: "research",
    routeContext: { sensitivity: "internal" as const },
  };
  const receipt = screenInferencePayload(screenInput).receipt;
  return {
    version: 1,
    messages,
    systemPrompt,
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
    dispatchScreen: {
      schemaVersion: 1,
      decision: {
        sensitivity: "internal",
        policyRulesApplied: ["inference-dispatch"],
        inferenceDataScreenReceipt: receipt,
      },
      context: {
        taskType: screenInput.taskType,
        routeContext: screenInput.routeContext,
      },
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

  it("performs authorization before provider POST and treats refusal as a definite rejection", async () => {
    const dispatch = vi.fn();
    const authorizeDispatch = vi.fn(() => {
      throw new Error("stale screen");
    });
    const dependencies = createDurableAsyncProviderDependencies({
      authorizeDispatch,
      dispatch,
      poll: vi.fn(),
      reconcile: vi.fn(),
    });

    await expect(dependencies.startProvider(operation(context())))
      .rejects.toMatchObject({ boundary: "definite-rejection" } satisfies Partial<AsyncProviderStartError>);
    expect(authorizeDispatch).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects stale, blocked, and live local-only screen evidence before dispatch", async () => {
    const validContext = context();
    const parsed = parseDurableAsyncProviderContext(operation(validContext));
    const base = parsed.dispatchScreen;
    const stale = structuredClone(base);
    stale.decision.inferenceDataScreenReceipt.inputHash = "f".repeat(64);
    expect(() => assertDurableDispatchScreen({
      evidence: stale,
      messages: parsed.messages,
      systemPrompt: parsed.systemPrompt,
      tools: parsed.tools,
      providerId: "gemini",
      localOnlyInference: false,
    })).toThrow(/stale inference data screen receipt/i);

    const blocked = structuredClone(base);
    blocked.decision.inferenceDataScreenReceipt.routeEffect = "block";
    expect(() => assertDurableDispatchScreen({
      evidence: blocked,
      messages: parsed.messages,
      systemPrompt: parsed.systemPrompt,
      tools: parsed.tools,
      providerId: "gemini",
      localOnlyInference: false,
    })).toThrow(/blocked by inference data screen/i);

    expect(() => assertDurableDispatchScreen({
      evidence: base,
      messages: parsed.messages,
      systemPrompt: parsed.systemPrompt,
      tools: parsed.tools,
      providerId: "gemini",
      localOnlyInference: true,
    })).toThrow("ASYNC_OPERATION_DISPATCH_LOCAL_ONLY");
  });

  it.each([
    ["stale", (evidence: ReturnType<typeof parseDurableAsyncProviderContext>["dispatchScreen"]) => {
      evidence.decision.inferenceDataScreenReceipt.inputHash = "f".repeat(64);
      return false;
    }],
    ["blocked", (evidence: ReturnType<typeof parseDurableAsyncProviderContext>["dispatchScreen"]) => {
      evidence.decision.inferenceDataScreenReceipt.routeEffect = "block";
      return false;
    }],
    ["local-only", (_evidence: ReturnType<typeof parseDurableAsyncProviderContext>["dispatchScreen"]) => true],
  ])("sends zero provider POSTs when the fresh %s screen refuses dispatch", async (_name, arrange) => {
    const persistedContext = context();
    const parsed = parseDurableAsyncProviderContext(operation(persistedContext));
    const evidence = structuredClone(parsed.dispatchScreen);
    const localOnlyInference = arrange(evidence);
    const dispatch = vi.fn();
    const dependencies = createDurableAsyncProviderDependencies({
      authorizeDispatch: ({ providerId, context: providerContext }) => assertDurableDispatchScreen({
        evidence: providerContext.dispatchScreen,
        messages: providerContext.messages,
        systemPrompt: providerContext.systemPrompt,
        tools: providerContext.tools,
        providerId,
        localOnlyInference,
      }),
      dispatch,
      poll: vi.fn(),
      reconcile: vi.fn(),
    });

    await expect(dependencies.startProvider(operation({
      ...persistedContext,
      dispatchScreen: evidence,
    }))).rejects.toMatchObject({
      boundary: "definite-rejection",
      message: "ASYNC_OPERATION_DISPATCH_SCREEN_REJECTED",
    } satisfies Partial<AsyncProviderStartError>);
    expect(dispatch).not.toHaveBeenCalled();
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
