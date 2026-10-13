import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-259F6743: cancelling a thread stops it and its delegated children.

const { mockPrisma, mockBus } = vi.hoisted(() => {
  const mockPrisma = {
    agentThread: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    taskRun: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { mockPrisma, mockBus: { requestCancel: vi.fn() } };
});

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: mockBus }));

import { cancelThreadTree } from "./thread-cancellation";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
  mockPrisma.agentThread.findUnique.mockResolvedValue({ id: "parent-1", userId: "user-1", cancelledAt: null });
  mockPrisma.agentThread.findMany.mockResolvedValue([{ id: "child-1" }, { id: "child-2" }]);
  mockPrisma.agentThread.updateMany.mockResolvedValue({ count: 3 });
  mockPrisma.taskRun.updateMany.mockResolvedValue({ count: 2 });
});

describe("cancelThreadTree", () => {
  it("cancels the thread and its open children, their unfinished runs, and signals each loop", async () => {
    await expect(cancelThreadTree("parent-1", "user-1"))
      .resolves.toEqual({ ok: true, cancelledThreadIds: ["parent-1", "child-1", "child-2"] });

    expect(mockPrisma.agentThread.findMany).toHaveBeenCalledWith({
      where: { parentThreadId: "parent-1", cancelledAt: null },
      select: { id: true },
    });
    expect(mockPrisma.agentThread.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["parent-1", "child-1", "child-2"] }, cancelledAt: null },
      data: { cancelledAt: expect.any(Date) },
    });
    expect(mockPrisma.taskRun.updateMany).toHaveBeenCalledWith({
      where: {
        threadId: { in: ["parent-1", "child-1", "child-2"] },
        status: { notIn: ["completed", "failed", "canceled", "rejected", "archived"] },
      },
      data: { status: "canceled", completedAt: expect.any(Date) },
    });
    expect(mockBus.requestCancel.mock.calls.map((call) => call[0])).toEqual(["parent-1", "child-1", "child-2"]);
  });

  it("still cancels open children of a parent that was already cancelled", async () => {
    mockPrisma.agentThread.findUnique.mockResolvedValue({ id: "parent-1", userId: "user-1", cancelledAt: new Date() });
    mockPrisma.agentThread.findMany.mockResolvedValue([{ id: "child-1" }]);
    await expect(cancelThreadTree("parent-1", "user-1")).resolves.toEqual({ ok: true, cancelledThreadIds: ["child-1"] });
  });

  it("changes nothing when the thread and its children are already cancelled", async () => {
    mockPrisma.agentThread.findUnique.mockResolvedValue({ id: "parent-1", userId: "user-1", cancelledAt: new Date() });
    mockPrisma.agentThread.findMany.mockResolvedValue([]);
    await expect(cancelThreadTree("parent-1", "user-1")).resolves.toEqual({ ok: true, cancelledThreadIds: [] });
    expect(mockPrisma.taskRun.updateMany).not.toHaveBeenCalled();
    expect(mockBus.requestCancel).not.toHaveBeenCalled();
  });

  it("refuses another user's thread", async () => {
    await expect(cancelThreadTree("parent-1", "user-2")).rejects.toThrow(/Unauthorized/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
