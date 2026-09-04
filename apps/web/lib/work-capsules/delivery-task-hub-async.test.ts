import { describe, expect, it, vi } from "vitest";

import {
  createDeliveryTaskHubAsyncProjectionLoader,
  readDeliveryTaskAsyncOperation,
} from "./delivery-task-hub-async";

const actor = {
  userId: "user-1",
  agentId: null,
  principalId: "principal-row-1",
  isSuperuser: false,
};

function operation(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "private-op-id",
    requestKey: "private-request-key",
    requestDigest: "a".repeat(64),
    status: "running",
    providerId: "openai",
    modelId: "gpt-test",
    providerOperationId: "provider-secret-handle",
    contractFamily: "interactions",
    checkpointSequence: 2,
    transitionSequence: 3,
    progressPct: 45,
    progressMessage: "Generating the verified result",
    resultText: "private result",
    resultData: { private: true },
    errorMessage: "private failure detail",
    createdAt: new Date("2026-09-04T11:00:00.000Z"),
    updatedAt: new Date("2026-09-04T12:00:00.000Z"),
    startedAt: new Date("2026-09-04T11:01:00.000Z"),
    completedAt: null,
    expiresAt: new Date("2026-09-05T11:00:00.000Z"),
    ...overrides,
  };
}

describe("delivery task hub async-operation adapter", () => {
  it("reads only authorized semantic scopes at a fixed one-row bound and returns a safe projection", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ operations: [operation()], nextCursor: null })
      .mockResolvedValueOnce({
        operations: [operation({
          operationId: "newer-private-id",
          status: "completed",
          progressPct: 100,
          progressMessage: "  Durable work completed  ",
          updatedAt: new Date("2026-09-04T12:01:00.000Z"),
        })],
        nextCursor: null,
      });

    const result = await readDeliveryTaskAsyncOperation({
      capsuleId: "WC-1",
      taskRunId: "TR-1",
    }, actor, { list });

    expect(list).toHaveBeenNthCalledWith(1, {
      target: { kind: "task-run", taskRunId: "TR-1" },
      actor,
      limit: 1,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      target: { kind: "workroom", workroomId: "WC-1" },
      actor,
      limit: 1,
    });
    expect(result).toEqual({
      coreHandleAvailable: true,
      operationId: "newer-private-id",
      status: "completed",
      observedAt: "2026-09-04T12:01:00.000Z",
      progressPct: 100,
      progressMessage: "Durable work completed",
    });
    expect(result).not.toHaveProperty("providerOperationId");
    expect(result).not.toHaveProperty("requestDigest");
    expect(result).not.toHaveProperty("resultText");
    expect(result).not.toHaveProperty("errorMessage");
  });

  it("contains denied or unavailable scopes per row instead of leaking or failing the hub", async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error("ASYNC_OPERATION_AUTHORITY_DENIED"))
      .mockResolvedValueOnce({ operations: [], nextCursor: null });

    await expect(readDeliveryTaskAsyncOperation({
      capsuleId: "WC-OTHER-ORG",
      taskRunId: "TR-OTHER-ORG",
    }, actor, { list })).resolves.toEqual({ coreHandleAvailable: false });
  });

  it("resolves the relational principal once when creating a session-scoped loader", async () => {
    const resolvePrincipalId = vi.fn().mockResolvedValue("principal-row-1");
    const list = vi.fn().mockResolvedValue({ operations: [], nextCursor: null });

    const load = await createDeliveryTaskHubAsyncProjectionLoader({
      id: "user-1",
      isSuperuser: true,
    }, { resolvePrincipalId, list });
    await load({ capsuleId: "WC-1", taskRunId: null });
    await load({ capsuleId: "WC-2", taskRunId: null });

    expect(resolvePrincipalId).toHaveBeenCalledTimes(1);
    expect(resolvePrincipalId).toHaveBeenCalledWith({ type: "admin", id: "user-1" });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: "user-1",
        agentId: null,
        principalId: "principal-row-1",
        isSuperuser: true,
      },
      limit: 1,
    }));
  });
});
