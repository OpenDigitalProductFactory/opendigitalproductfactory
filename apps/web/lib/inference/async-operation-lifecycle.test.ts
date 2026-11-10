import { describe, expect, it, vi } from "vitest";

import type { AsyncOperationBinding } from "./async-operation-contract";
import {
  AsyncOperationIdentityConflictError,
  admitDurableAsyncOperation,
  type AsyncOperationAdmissionStore,
  type AsyncOperationRecord,
} from "./async-operation-lifecycle";
import { screenInferencePayload } from "./data-screening/screen-inference-payload";

const binding: AsyncOperationBinding = {
  kind: "task-run",
  taskRunId: "task-internal-1",
  requestKey: "external-review:BI-1:run-1",
  requestDigest: "a".repeat(64),
};

function record(overrides: Partial<AsyncOperationRecord> = {}): AsyncOperationRecord {
  return {
    id: "async-op-1",
    authorityScopeKey: "task-run:task-internal-1",
    requestKey: binding.requestKey,
    requestDigest: "b".repeat(64),
    bindingDigest: "c".repeat(64),
    providerId: "gemini",
    modelId: "deep-research",
    contractFamily: "research",
    screenedRequestContext: { promptRef: "screened:1" },
    taskRunId: "task-internal-1",
    workroomId: null,
    status: "pending",
    providerOperationId: null,
    checkpointSequence: 0,
    transitionSequence: 0,
    startClaimFence: 0,
    startAttemptedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    nextPollAt: null,
    resultText: null,
    resultData: null,
    errorMessage: null,
    progressPct: null,
    progressMessage: null,
    createdAt: new Date("2026-09-04T11:00:00.000Z"),
    updatedAt: new Date("2026-09-04T11:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    expiresAt: new Date("2026-09-04T12:00:00.000Z"), // clock-bomb-guard: allow fixed record fixture; no wall-clock branch
    ...overrides,
  };
}

function store(result: { operation: AsyncOperationRecord; replayed: boolean }): AsyncOperationAdmissionStore {
  return {
    createOrReplay: vi.fn().mockResolvedValue(result),
  };
}

const screenedMessages = [{ role: "user" as const, content: "research" }];
const screenedSystemPrompt = "Use immutable evidence.";
const screenedInput = {
  messages: screenedMessages,
  systemPrompt: screenedSystemPrompt,
  taskType: "research",
  routeContext: { sensitivity: "internal" as const },
};
const input = {
  providerId: "gemini",
  modelId: "deep-research",
  contractFamily: "research",
  screenedRequestDigest: "d".repeat(64),
  screenedRequestContext: {
    version: 1,
    messages: screenedMessages,
    systemPrompt: screenedSystemPrompt,
    executionPlan: {
      providerId: "gemini",
      modelId: "deep-research",
      recipeId: null,
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
        inferenceDataScreenReceipt: screenInferencePayload(screenedInput).receipt,
      },
      context: {
        taskType: screenedInput.taskType,
        routeContext: screenedInput.routeContext,
      },
    },
  },
  expiresAt: new Date("2026-09-04T12:00:00.000Z"), // clock-bomb-guard: allow fixed admission fixture; no wall-clock branch
};

describe("durable async operation admission", () => {
  it("resolves server authority and persists before enqueueing", async () => {
    const events: string[] = [];
    const admissionStore = store({ operation: record(), replayed: false });

    const result = await admitDurableAsyncOperation(input, {
      resolveBinding: vi.fn(async () => {
        events.push("authority");
        return binding;
      }),
      store: {
        createOrReplay: vi.fn(async (params) => {
          events.push("persist");
          expect(params.binding).toEqual(binding);
          return admissionStore.createOrReplay(params);
        }),
      },
      enqueue: vi.fn(async (operationId) => {
        events.push("enqueue");
        expect(operationId).toBe("async-op-1");
      }),
    });

    expect(events).toEqual(["authority", "persist", "enqueue"]);
    expect(result).toEqual({ operationId: "async-op-1", replayed: false });
  });

  it("returns a matching replay without enqueueing again", async () => {
    const enqueue = vi.fn();
    const admissionStore = store({ operation: record(), replayed: true });

    const result = await admitDurableAsyncOperation(input, {
      resolveBinding: async () => binding,
      store: admissionStore,
      enqueue,
    });

    expect(result).toEqual({ operationId: "async-op-1", replayed: true });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never persists or enqueues when authority resolution refuses", async () => {
    const admissionStore = store({ operation: record(), replayed: false });
    const enqueue = vi.fn();

    await expect(admitDurableAsyncOperation(input, {
      resolveBinding: async () => {
        throw new Error("ASYNC_OPERATION_AUTHORITY_DENIED");
      },
      store: admissionStore,
      enqueue,
    })).rejects.toThrow("ASYNC_OPERATION_AUTHORITY_DENIED");

    expect(admissionStore.createOrReplay).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects an unscreened request before durable persistence", async () => {
    const admissionStore = store({ operation: record(), replayed: false });
    const enqueue = vi.fn();

    await expect(admitDurableAsyncOperation({
      ...input,
      screenedRequestContext: {
        ...input.screenedRequestContext,
        authorization: "Bearer must-not-persist",
      },
    }, {
      resolveBinding: async () => binding,
      store: admissionStore,
      enqueue,
    })).rejects.toThrow("ASYNC_OPERATION_CONTEXT_CONTAINS_CREDENTIALS");

    expect(admissionStore.createOrReplay).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("hashes and persists one normalized JSON identity for Date-shaped input", async () => {
    const captured: Array<Parameters<AsyncOperationAdmissionStore["createOrReplay"]>[0]> = [];
    const admissionStore: AsyncOperationAdmissionStore = {
      createOrReplay: vi.fn(async (params) => {
        captured.push(params);
        return { operation: record(), replayed: false };
      }),
    };
    const withDate = (value: string) => ({
      ...input,
      screenedRequestContext: {
        ...input.screenedRequestContext,
        messages: [{ role: "user", content: { observedAt: new Date(value) } }],
      },
    });

    await admitDurableAsyncOperation(withDate("2026-09-04T12:00:00.000Z"), {
      resolveBinding: async () => binding,
      store: admissionStore,
      enqueue: vi.fn(),
    });
    await admitDurableAsyncOperation(withDate("2026-09-04T12:01:00.000Z"), {
      resolveBinding: async () => binding,
      store: admissionStore,
      enqueue: vi.fn(),
    });

    expect(captured[0]?.screenedRequestContext).toMatchObject({
      messages: [{
        content: { observedAt: "2026-09-04T12:00:00.000Z" },
      }],
    });
    expect(captured[1]?.screenedRequestContext).toMatchObject({
      messages: [{
        content: { observedAt: "2026-09-04T12:01:00.000Z" },
      }],
    });
    expect(captured[0]?.requestDigest).not.toBe(captured[1]?.requestDigest);
  });

  it("fails closed on an identity conflict and never enqueues", async () => {
    const enqueue = vi.fn();
    const admissionStore: AsyncOperationAdmissionStore = {
      createOrReplay: vi.fn().mockRejectedValue(new AsyncOperationIdentityConflictError()),
    };

    await expect(admitDurableAsyncOperation(input, {
      resolveBinding: async () => binding,
      store: admissionStore,
      enqueue,
    })).rejects.toThrow("ASYNC_OPERATION_IDENTITY_CONFLICT");

    expect(enqueue).not.toHaveBeenCalled();
  });
});
