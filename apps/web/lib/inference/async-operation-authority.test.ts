import { describe, expect, it, vi } from "vitest";

import {
  AsyncOperationAuthorizationError,
  resolveServerOwnedAsyncOperationBinding,
  type AsyncOperationAuthorityDatabase,
} from "./async-operation-authority";

const digest = "a".repeat(64);

function database(input?: {
  taskRun?: Record<string, unknown> | null;
  workroom?: Record<string, unknown> | null;
}) {
  return {
    taskRun: {
      findUnique: vi.fn().mockResolvedValue(input?.taskRun ?? null),
    },
    workroom: {
      findUnique: vi.fn().mockResolvedValue(input?.workroom ?? null),
    },
  } as unknown as AsyncOperationAuthorityDatabase;
}

describe("resolveServerOwnedAsyncOperationBinding", () => {
  it("resolves a TaskRun semantic key to its server-owned row for the owning user", async () => {
    const db = database({
      taskRun: {
        id: "task-row-1",
        taskRunId: "TR-1",
        userId: "user-1",
        initiatingAgentId: null,
        currentAgentId: null,
      },
    });

    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "task-run", taskRunId: "TR-1", requestKey: "logical-1", requestDigest: digest },
      actor: { userId: "user-1", agentId: null, principalId: null, isSuperuser: false },
      db,
    })).resolves.toEqual({
      kind: "task-run",
      taskRunId: "task-row-1",
      requestKey: "logical-1",
      requestDigest: digest,
    });
    expect(db.taskRun.findUnique).toHaveBeenCalledWith({
      where: { taskRunId: "TR-1" },
      select: expect.objectContaining({ id: true, taskRunId: true, userId: true }),
    });
  });

  it("allows the exact current agent but rejects an unrelated actor", async () => {
    const taskRun = {
      id: "task-row-1",
      taskRunId: "TR-1",
      userId: "owner",
      initiatingAgentId: "agent-initial",
      currentAgentId: "agent-current",
    };
    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "task-run", taskRunId: "TR-1", requestKey: "logical-1", requestDigest: digest },
      actor: { userId: "other", agentId: "agent-current", principalId: null, isSuperuser: false },
      db: database({ taskRun }),
    })).resolves.toMatchObject({ taskRunId: "task-row-1" });

    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "task-run", taskRunId: "TR-1", requestKey: "logical-1", requestDigest: digest },
      actor: { userId: "other", agentId: "agent-other", principalId: null, isSuperuser: false },
      db: database({ taskRun }),
    })).rejects.toBeInstanceOf(AsyncOperationAuthorizationError);
  });

  it("resolves a Workroom only for its exact executor, lease holder, or active participant", async () => {
    const workroom = {
      id: "workroom-row-1",
      capsuleId: "WC-1",
      executorRef: "session-1",
      leaseHolderPrincipalId: "principal-lease",
      participants: [{ principalId: "principal-participant", lifecycle: "active" }],
    };
    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "workroom", workroomId: "WC-1", requestKey: "logical-1", requestDigest: digest },
      actor: { userId: "user-2", agentId: "session-1", principalId: null, isSuperuser: false },
      db: database({ workroom }),
    })).resolves.toEqual({
      kind: "workroom",
      workroomId: "workroom-row-1",
      requestKey: "logical-1",
      requestDigest: digest,
    });

    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "workroom", workroomId: "WC-1", requestKey: "logical-1", requestDigest: digest },
      actor: { userId: "user-2", agentId: null, principalId: "principal-participant", isSuperuser: false },
      db: database({ workroom }),
    })).resolves.toMatchObject({ workroomId: "workroom-row-1" });

    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "workroom", workroomId: "WC-1", requestKey: "logical-1", requestDigest: digest },
      actor: { userId: "other", agentId: "other", principalId: "other-principal", isSuperuser: false },
      db: database({ workroom }),
    })).rejects.toBeInstanceOf(AsyncOperationAuthorizationError);
  });

  it("allows a superuser but fails closed for missing records and malformed identity", async () => {
    const taskRun = {
      id: "task-row-1",
      taskRunId: "TR-1",
      userId: "owner",
      initiatingAgentId: null,
      currentAgentId: null,
    };
    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "task-run", taskRunId: "TR-1", requestKey: "logical-1", requestDigest: digest },
      actor: { userId: "admin", agentId: null, principalId: null, isSuperuser: true },
      db: database({ taskRun }),
    })).resolves.toMatchObject({ taskRunId: "task-row-1" });

    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "task-run", taskRunId: "TR-1", requestKey: "logical-1", requestDigest: digest },
      actor: { userId: "other", agentId: "agent-other", principalId: null, isSuperuser: true },
      db: database({ taskRun }),
    })).rejects.toThrow("ASYNC_OPERATION_AUTHORITY_DENIED");

    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "task-run", taskRunId: "missing", requestKey: "logical-1", requestDigest: digest },
      actor: { userId: "admin", agentId: null, principalId: null, isSuperuser: true },
      db: database(),
    })).rejects.toThrow("ASYNC_OPERATION_AUTHORITY_NOT_FOUND");

    await expect(resolveServerOwnedAsyncOperationBinding({
      request: { kind: "task-run", taskRunId: "TR-1", requestKey: " ", requestDigest: digest },
      actor: { userId: "owner", agentId: null, principalId: null, isSuperuser: false },
      db: database({ taskRun }),
    })).rejects.toThrow("ASYNC_OPERATION_REQUEST_KEY_INVALID");
  });
});
