import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findTask: vi.fn(),
  findProjection: vi.fn(),
  findToken: vi.fn(),
  claim: vi.fn(),
  update: vi.fn(),
}));
const execution = vi.hoisted(() => ({ run: vi.fn() }));
const durableInference = vi.hoisted(() => ({ admit: vi.fn() }));
const asyncRuntime = vi.hoisted(() => ({ cancel: vi.fn(), enqueue: vi.fn() }));
const events = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findUnique: (...args: unknown[]) => db.findTask(...args),
      findFirst: (...args: unknown[]) => db.findProjection(...args),
      updateMany: (...args: unknown[]) => db.claim(...args),
      update: (...args: unknown[]) => db.update(...args),
    },
    mcpApiToken: { findFirst: (...args: unknown[]) => db.findToken(...args) },
  },
}));
vi.mock("./mcp-task-execution", () => ({
  executeRemoteTaskAttempt: (...args: unknown[]) => execution.run(...args),
}));
vi.mock("./mcp-task-durable-inference-runtime", () => ({
  admitDurableInferenceTask: (...args: unknown[]) => durableInference.admit(...args),
}));
vi.mock("@/lib/inference/async-operation-runtime", () => ({
  requestPrismaAuthorizedAsyncOperationCancellation: (...args: unknown[]) =>
    asyncRuntime.cancel(...args),
  enqueuePrismaAsyncOperationWake: (...args: unknown[]) => asyncRuntime.enqueue(...args),
}));
vi.mock("@/lib/tak/agent-event-bus", () => ({
  agentEventBus: { emit: (...args: unknown[]) => events.emit(...args) },
}));

import {
  executePersistedRemoteTask,
  reconstructPersistedRemoteTask,
} from "./mcp-task-background-worker";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { DURABLE_INFERENCE_TASK_RECIPE_ID } from "./mcp-task-durable-inference-contract";

const params = {
  agentId: "AGT-WS-REVIEW",
  routeContext: "/build/work/WC-48A3D214",
  title: "Review immutable design",
  objective: "Review BI-2014236E.",
  prompt: "Read the immutable design and record the governed result.",
  idempotencyKey: "review:BI-2014236E:013883a8",
  riskClass: "bounded-write" as const,
  threadId: null,
  authorityScope: ["tool:read_source_at_version"],
  collaborationKind: "handoff" as const,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-row-1",
    taskRunId: "TR-MCP-ASYNC",
    userId: "user-1",
    threadId: "thread-1",
    contextId: "thread-1",
    status: "submitted",
    updatedAt: new Date("2026-08-31T04:00:00.000Z"),
    routeContext: params.routeContext,
    title: params.title,
    objective: params.objective,
    currentAgentId: params.agentId,
    authorityScope: params.authorityScope,
    progressPayload: {
      dispatch: {
        schemaVersion: 1,
        kind: "external-mcp-task",
        state: "enqueued",
        eventId: "mcp-task-run:TR-MCP-ASYNC:execute:v1",
        attempt: 1,
        requestedAt: "2026-08-31T04:00:00.000Z",
      },
    },
    a2aMetadata: {
      idempotencyKey: params.idempotencyKey,
      requestDigest: remoteTaskRequestDigest(params),
      requestDigestVersion: 2,
      riskClass: params.riskClass,
      apiTokenId: "token-1",
      tokenSource: "pat",
      tokenCapability: "write",
      requestedAgentId: params.agentId,
      requestedThreadId: null,
      collaborationKind: params.collaborationKind,
      initiativeReviewBinding: null,
    },
    messages: [{ parts: [{ type: "message", text: params.prompt }] }],
    user: {
      id: "user-1",
      isSuperuser: false,
      groups: [{ platformRole: { roleId: "developer" } }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findTask.mockResolvedValue(row());
  db.findProjection.mockResolvedValue({
    status: "working",
    updatedAt: new Date("2026-08-31T04:00:00.001Z"),
    progressPayload: {
      dispatch: row().progressPayload.dispatch,
      durableInference: {
        schemaVersion: 1,
        recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        state: "admitting",
        attempt: 1,
      },
    },
  });
  db.findToken.mockResolvedValue({ id: "token-1", capability: "write" });
  db.claim.mockResolvedValue({ count: 1 });
  db.update.mockResolvedValue({});
  execution.run.mockResolvedValue({
    kind: "result",
    result: { taskRunId: "TR-MCP-ASYNC", status: "completed" },
  });
  durableInference.admit.mockResolvedValue({
    asyncOperationId: "async-op-1",
    recipeId: "recipe-row-1",
  });
  asyncRuntime.cancel.mockResolvedValue({ operationId: "async-op-1" });
  asyncRuntime.enqueue.mockResolvedValue(undefined);
});

describe("persisted remote TaskRun worker", () => {
  it("reconstructs the exact execution packet from server-owned persisted state", () => {
    const reconstructed = reconstructPersistedRemoteTask(row());

    expect(reconstructed).toMatchObject({
      ok: true,
      data: {
        run: { id: "task-row-1", taskRunId: "TR-MCP-ASYNC" },
        token: { tokenId: "token-1", userId: "user-1", capability: "write", source: "pat" },
        userContext: { userId: "user-1", platformRole: "developer", isSuperuser: false },
        parsed: params,
      },
    });
  });

  it("fails closed when persisted request bytes no longer match the immutable digest", () => {
    const reconstructed = reconstructPersistedRemoteTask(row({
      messages: [{ parts: [{ type: "message", text: "changed prompt" }] }],
    }));

    expect(reconstructed).toEqual({
      ok: false,
      code: "request_digest_mismatch",
      message: "Persisted remote task request does not match its immutable digest.",
    });
  });

  it("lets only one duplicate queue delivery claim and execute the TaskRun", async () => {
    db.claim.mockResolvedValue({ count: 0 });

    const result = await executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" });

    expect(result).toEqual({ status: "duplicate", taskRunId: "TR-MCP-ASYNC" });
    expect(execution.run).not.toHaveBeenCalled();
  });

  it("routes the closed durable-inference mode only from the persisted background worker", async () => {
    const durableParams = { ...params, riskClass: "read" as const, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID };
    db.findTask.mockResolvedValueOnce(row({
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));

    const result = await executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" });

    expect(durableInference.admit).toHaveBeenCalledWith({
      taskRunId: "TR-MCP-ASYNC",
      requestKey: params.idempotencyKey,
      requestDigest: remoteTaskRequestDigest(durableParams),
      prompt: params.prompt,
      userId: "user-1",
      agentId: params.agentId,
      threadId: "thread-1",
      routeContext: params.routeContext,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    });
    expect(execution.run).not.toHaveBeenCalled();
    expect(db.claim).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ taskRunId: "TR-MCP-ASYNC", status: "working" }),
      data: expect.objectContaining({
        progressPayload: expect.objectContaining({
          durableInference: expect.objectContaining({
            state: "admitted",
            asyncOperationId: "async-op-1",
            routingRecipeId: "recipe-row-1",
          }),
        }),
      }),
    }));
    expect(result).toEqual({
      status: "working",
      taskRunId: "TR-MCP-ASYNC",
      asyncOperationId: "async-op-1",
    });
  });

  it("reconciles a restarted durable admission on the same TaskRun and operation identity", async () => {
    const durableParams = { ...params, riskClass: "read" as const, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID };
    db.findTask.mockResolvedValueOnce(row({
      status: "working",
      progressPayload: {
        dispatch: row().progressPayload.dispatch,
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitting",
          attempt: 1,
        },
      },
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toMatchObject({ asyncOperationId: "async-op-1" });
    expect(durableInference.admit).toHaveBeenCalledTimes(1);
    expect(execution.run).not.toHaveBeenCalled();
  });

  it("reconciles a quiesced pre-operation admission after the queue gate clears", async () => {
    const durableParams = {
      ...params,
      riskClass: "read" as const,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    };
    db.findTask.mockResolvedValueOnce(row({
      status: "quiescing",
      progressPayload: {
        dispatch: row().progressPayload.dispatch,
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitting",
          attempt: 1,
        },
      },
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toMatchObject({ status: "working", asyncOperationId: "async-op-1" });
    expect(db.claim).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "quiescing" }),
      data: expect.objectContaining({ status: "working" }),
    }));
    expect(durableInference.admit).toHaveBeenCalledTimes(1);
    expect(execution.run).not.toHaveBeenCalled();
  });

  it("honors a persisted cancellation intent before retrying provider admission", async () => {
    const durableParams = {
      ...params,
      riskClass: "read" as const,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    };
    db.findTask.mockResolvedValueOnce(row({
      status: "working",
      progressPayload: {
        dispatch: row().progressPayload.dispatch,
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitting",
          attempt: 1,
          cancellationRequestedAt: "2026-09-04T13:58:00.000Z",
        },
      },
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toEqual({ status: "canceled", taskRunId: "TR-MCP-ASYNC" });
    expect(db.claim).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "working" }),
      data: expect.objectContaining({
        status: "canceled",
        progressPayload: expect.objectContaining({
          durableInference: expect.objectContaining({ state: "cancelled-before-admission" }),
        }),
      }),
    }));
    expect(durableInference.admit).not.toHaveBeenCalled();
    expect(execution.run).not.toHaveBeenCalled();
  });

  it("preserves a cancellation that wins during admission and cancels the newly bound operation", async () => {
    const durableParams = {
      ...params,
      riskClass: "read" as const,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    };
    db.findTask.mockResolvedValueOnce(row({
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));
    db.findProjection.mockResolvedValueOnce({
      status: "working",
      updatedAt: new Date("2026-08-31T04:00:00.002Z"),
      progressPayload: {
        dispatch: { state: "claimed" },
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitting",
          attempt: 1,
          cancellationRequestedAt: "2026-08-31T04:00:00.001Z",
        },
      },
    });

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toMatchObject({
        status: "working",
        asyncOperationId: "async-op-1",
        cancellationRequested: true,
      });
    expect(db.claim).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: new Date("2026-08-31T04:00:00.002Z") }),
      data: expect.objectContaining({
        progressPayload: expect.objectContaining({
          durableInference: expect.objectContaining({
            state: "admitted",
            cancellationRequestedAt: "2026-08-31T04:00:00.001Z",
            asyncOperationId: "async-op-1",
          }),
        }),
      }),
    }));
    expect(asyncRuntime.cancel).toHaveBeenCalledWith({
      target: { kind: "task-run", taskRunId: "TR-MCP-ASYNC" },
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
      requestKey: params.idempotencyKey,
    });
    expect(asyncRuntime.enqueue).toHaveBeenCalledWith("async-op-1");
  });

  it("recovers a lost first wake from the durable admitted projection without re-admitting", async () => {
    const durableParams = {
      ...params,
      riskClass: "read" as const,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    };
    db.findTask.mockResolvedValueOnce(row({
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        requestDigestVersion: 2,
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));
    db.findProjection.mockResolvedValueOnce({
      status: "working",
      updatedAt: new Date("2026-08-31T04:00:00.002Z"),
      progressPayload: {
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitted",
          attempt: 1,
          asyncOperationId: "async-op-1",
          routingRecipeId: "recipe-row-1",
        },
      },
    });

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toMatchObject({ idempotentReplay: true, asyncOperationId: "async-op-1" });
    expect(asyncRuntime.enqueue).toHaveBeenCalledWith("async-op-1");
    expect(db.claim).toHaveBeenCalledTimes(1);
  });

  it("does not reopen a TaskRun when a terminal transition wins the post-admission race", async () => {
    const durableParams = { ...params, riskClass: "read" as const, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID };
    db.findTask.mockResolvedValue(row({
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));
    db.findProjection.mockResolvedValueOnce({
      status: "completed",
      updatedAt: new Date("2026-08-31T04:00:00.002Z"),
      progressPayload: {
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitted",
          attempt: 1,
          asyncOperationId: "async-op-1",
          routingRecipeId: "recipe-row-1",
        },
      },
    });

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toEqual({
        status: "completed",
        taskRunId: "TR-MCP-ASYNC",
        asyncOperationId: "async-op-1",
        idempotentReplay: true,
      });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("returns the persisted operation identity without re-admitting a duplicate worker delivery", async () => {
    const durableParams = { ...params, riskClass: "read" as const, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID };
    db.findTask.mockResolvedValueOnce(row({
      status: "working",
      progressPayload: {
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitted",
          attempt: 1,
          asyncOperationId: "async-op-1",
          routingRecipeId: "recipe-row-1",
        },
      },
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toEqual({
        status: "working",
        taskRunId: "TR-MCP-ASYNC",
        asyncOperationId: "async-op-1",
        idempotentReplay: true,
      });
    expect(durableInference.admit).not.toHaveBeenCalled();
    expect(db.claim).not.toHaveBeenCalled();
  });

  it("does not let a revoked credential rewrite a terminal durable TaskRun", async () => {
    const durableParams = {
      ...params,
      riskClass: "read" as const,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    };
    db.findTask.mockResolvedValueOnce(row({
      status: "completed",
      progressPayload: {
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitted",
          attempt: 1,
          asyncOperationId: "async-op-1",
          routingRecipeId: "recipe-row-1",
          providerState: "completed",
        },
      },
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));
    db.findToken.mockResolvedValueOnce(null);

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toEqual({
        status: "completed",
        taskRunId: "TR-MCP-ASYNC",
        idempotentReplay: true,
      });
    expect(db.findToken).not.toHaveBeenCalled();
    expect(db.claim).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(asyncRuntime.enqueue).not.toHaveBeenCalled();
  });

  it("wakes an admitted durable operation before revalidating an expired credential", async () => {
    const durableParams = {
      ...params,
      riskClass: "read" as const,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    };
    db.findTask.mockResolvedValueOnce(row({
      status: "working",
      progressPayload: {
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
          state: "admitted",
          attempt: 1,
          asyncOperationId: "async-op-1",
          routingRecipeId: "recipe-row-1",
        },
      },
      a2aMetadata: {
        ...row().a2aMetadata,
        requestDigest: remoteTaskRequestDigest(durableParams),
        riskClass: "read",
        durableInference: {
          schemaVersion: 1,
          recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
        },
      },
    }));
    db.findToken.mockResolvedValueOnce(null);

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toEqual({
        status: "working",
        taskRunId: "TR-MCP-ASYNC",
        asyncOperationId: "async-op-1",
        idempotentReplay: true,
      });
    expect(db.findToken).not.toHaveBeenCalled();
    expect(db.claim).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(asyncRuntime.enqueue).toHaveBeenCalledWith("async-op-1");
  });

  it("does not settle a credential failure after another worker advances the TaskRun", async () => {
    db.findToken.mockResolvedValueOnce(null);
    db.claim.mockResolvedValueOnce({ count: 0 });

    await expect(executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" }))
      .resolves.toEqual({ status: "duplicate", taskRunId: "TR-MCP-ASYNC" });
    expect(db.claim).toHaveBeenCalledWith({
      where: {
        taskRunId: "TR-MCP-ASYNC",
        status: "submitted",
        updatedAt: new Date("2026-08-31T04:00:00.000Z"),
      },
      data: expect.objectContaining({
        status: "failed",
        progressPayload: expect.objectContaining({ errorCode: "authorization_revoked" }),
      }),
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});

// Keep Node's crypto import exercised so a future test fixture can compare the
// digest independently without adding a second ad-hoc hash implementation.
void createHash;
