import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const tx = {
    taskRun: {
      create: vi.fn(async () => {
        events.push("create");
        return {
          id: "tr-atomic",
          taskRunId: "TR-MCP-ATOMIC",
          contextId: "thread-atomic",
        };
      }),
    },
    taskMessage: { create: vi.fn() },
  };
  const transaction = vi.fn(async (callback: (db: typeof tx) => unknown) => callback(tx));
  return { events, transaction, tx };
});

vi.mock("@dpf/db", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/platform-runtime/work-admission", () => ({
  admitRuntimeGuardedWork: vi.fn(),
}));
vi.mock("@/lib/golden-triangle/coworker-review", () => ({
  resolveCoworkerReviewPattern: vi.fn(),
}));
vi.mock("@/lib/tak/coworker-inline-review", () => ({
  reviewCoworkerDraft: vi.fn(),
}));

describe("createAutonomousWorkRun admission", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.transaction.mockClear();
    mocks.tx.taskRun.create.mockClear();
  });

  it("runs a server-owned guard before creation in the requested transaction isolation", async () => {
    const admissionGuard = vi.fn(async () => {
      mocks.events.push("guard");
    });
    const { createAutonomousWorkRun } = await import("./autonomous-work-run");

    await createAutonomousWorkRun({
      trigger: "external-mcp",
      userId: "user-1",
      agentId: "AGT-WS-PORTFOLIO",
      routeContext: "/build",
      title: "Atomic objective mapping",
      objective: "Map current objectives.",
      prompt: "Map current objectives.",
      threadId: "thread-atomic",
      admissionGuard,
      transactionIsolationLevel: "ReadCommitted",
    });

    expect(mocks.events).toEqual(["guard", "create"]);
    expect(admissionGuard).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "ReadCommitted",
    });
  });
});
