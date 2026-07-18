import { beforeEach, describe, expect, it, vi } from "vitest";
import { THREAD_ERRORS, ThreadSpawnError } from "./agent-thread-errors";

const { mockDispatchAgentThread, mockPrisma } = vi.hoisted(() => ({
  mockDispatchAgentThread: vi.fn(),
  mockPrisma: {
    $transaction: vi.fn(),
    agentThread: {
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    taskRun: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    agentMessage: {
      create: vi.fn(),
    },
  },
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "12345678-1234-4234-9234-123456789abc"),
}));

vi.mock("@dpf/db", () => ({
  Prisma: {
    TransactionIsolationLevel: {
      Serializable: "Serializable",
    },
  },
  prisma: mockPrisma,
}));

vi.mock("./agent-thread-dispatcher", () => ({
  dispatchAgentThread: mockDispatchAgentThread,
}));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));

// BI-QUIESCE-005 gate: spawnWorkThread now calls getQuiescenceLevel.
// Default to "normal" for all existing tests; tests that want to
// exercise the gate can override per-test via vi.mocked(...).
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceLevel: vi.fn().mockResolvedValue("normal"),
  QuiescingError: class QuiescingError extends Error {
    readonly code = "PORTAL_QUIESCING";
    readonly retryAfterSeconds: number;
    readonly level: string;
    constructor(level: string, retryAfterSeconds = 30) {
      super(`Portal is ${level} for upgrade — new work refused`);
      this.name = "QuiescingError";
      this.level = level;
      this.retryAfterSeconds = retryAfterSeconds;
    }
  },
}));

import { spawnWorkThread } from "./agent-threads";

describe("spawnWorkThread guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (input) => {
      if (typeof input === "function") return input(mockPrisma);
      return Promise.all(input);
    });
    mockDispatchAgentThread.mockResolvedValue(undefined);
    mockPrisma.agentThread.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.taskRun.update.mockResolvedValue({ taskRunId: "ctaskrun123", status: "failed" });
    // EP-A2A: spawnWorkThread now looks up the parent thread's TaskRun to
    // populate parentTaskRunId; root chat threads have none.
    mockPrisma.taskRun.findFirst.mockResolvedValue(null);
  });

  async function expectSpawnError(parent: {
    userId: string;
    parentThreadId: string | null;
    childCount: number;
    cancelledAt: Date | null;
  }, code: keyof typeof THREAD_ERRORS) {
    mockPrisma.agentThread.findUniqueOrThrow.mockResolvedValue({
      id: "parent-1",
      ...parent,
    });

    await expect(spawnWorkThread("parent-1", "Do the work", "caller-1")).rejects.toMatchObject({
      name: "ThreadSpawnError",
      code,
    } satisfies Partial<ThreadSpawnError>);

    expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(mockPrisma.agentThread.create).not.toHaveBeenCalled();
    expect(mockPrisma.taskRun.create).not.toHaveBeenCalled();
    expect(mockPrisma.agentMessage.create).not.toHaveBeenCalled();
  }

  it("creates the child thread, task run, and user message atomically", async () => {
    const objective = `${"Write the launch plan. ".repeat(8)}Finalize handoff.`;
    mockPrisma.agentThread.findUniqueOrThrow.mockResolvedValue({
      id: "parent-1",
      userId: "caller-1",
      parentThreadId: null,
      childCount: 0,
      cancelledAt: null,
    });
    mockPrisma.agentThread.create.mockResolvedValue({ id: "child-1" });
    mockPrisma.taskRun.create.mockResolvedValue({ taskRunId: "ctaskrun123" });

    await expect(spawnWorkThread("parent-1", objective, "caller-1")).resolves.toEqual({
      child: { id: "child-1" },
      taskRunId: "ctaskrun123",
    });

    expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(mockPrisma.agentThread.create).toHaveBeenCalledWith({
      data: {
        userId: "caller-1",
        contextKey: "work-thread-12345678-1234-4234-9234-123456789abc",
        parentThreadId: "parent-1",
      },
      select: { id: true },
    });
    expect(mockPrisma.agentThread.updateMany).toHaveBeenCalledWith({
      where: { id: "parent-1" },
      data: { childCount: { increment: 1 } },
    });
    expect(mockPrisma.taskRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "caller-1",
        threadId: "child-1",
        title: objective.slice(0, 100),
        objective,
        source: "coworker",
        status: "submitted",
      }),
      select: { taskRunId: true },
    });
    expect(mockPrisma.taskRun.create.mock.calls[0]?.[0]?.data.taskRunId).toMatch(/^c[a-z0-9]{24}$/);
    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "child-1",
        role: "user",
        content: objective,
      }),
    });
    expect(mockDispatchAgentThread).toHaveBeenCalledWith("child-1", "caller-1");
  });

  it("compensates with taskRunId when dispatch fails after the transaction commits", async () => {
    let txCommitted = false;
    mockPrisma.$transaction.mockImplementation(async (input) => {
      if (typeof input === "function") {
        const result = await input(mockPrisma);
        txCommitted = true;
        return result;
      }
      return Promise.all(input);
    });
    mockDispatchAgentThread.mockImplementation(async () => {
      expect(txCommitted).toBe(true);
      throw new Error("queue unavailable");
    });
    mockPrisma.agentThread.findUniqueOrThrow.mockResolvedValue({
      id: "parent-1",
      userId: "caller-1",
      parentThreadId: null,
      childCount: 0,
      cancelledAt: null,
    });
    mockPrisma.agentThread.create.mockResolvedValue({ id: "child-1" });
    mockPrisma.taskRun.create.mockResolvedValue({ taskRunId: "ctaskrun123" });

    await expect(spawnWorkThread("parent-1", "Do the work", "caller-1")).rejects.toMatchObject({
      name: "ThreadSpawnError",
      code: THREAD_ERRORS.DISPATCH_FAILED,
    });

    expect(mockDispatchAgentThread).toHaveBeenCalledWith("child-1", "caller-1");
    expect(mockPrisma.agentThread.updateMany).toHaveBeenCalledWith({
      where: { id: "parent-1", childCount: { gt: 0 } },
      data: { childCount: { decrement: 1 } },
    });
    expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
      where: { taskRunId: "ctaskrun123" },
      data: { status: "failed" },
    });
    expect(mockPrisma.$transaction).toHaveBeenLastCalledWith([
      expect.any(Promise),
      expect.any(Promise),
    ]);
  });

  it("rejects when the caller does not own the parent thread", async () => {
    await expectSpawnError(
      { userId: "owner-1", parentThreadId: null, childCount: 0, cancelledAt: null },
      THREAD_ERRORS.UNAUTHORIZED,
    );
  });

  it("rejects spawning from a child thread", async () => {
    await expectSpawnError(
      { userId: "caller-1", parentThreadId: "root-1", childCount: 0, cancelledAt: null },
      THREAD_ERRORS.DEPTH_LIMIT_EXCEEDED,
    );
  });

  it("rejects when the parent already has five children", async () => {
    await expectSpawnError(
      { userId: "caller-1", parentThreadId: null, childCount: 5, cancelledAt: null },
      THREAD_ERRORS.CHILD_LIMIT_EXCEEDED,
    );
  });

  it("rejects when the parent thread is cancelled", async () => {
    await expectSpawnError(
      {
        userId: "caller-1",
        parentThreadId: null,
        childCount: 0,
        cancelledAt: new Date("2026-05-18T00:00:00.000Z"),
      },
      THREAD_ERRORS.PARENT_CANCELLED,
    );
  });
});
