import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), message: vi.fn(), link: vi.fn(), thread: vi.fn(), existing: vi.fn(), receipt: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findUnique: mocks.existing } } }));
vi.mock("@/lib/tak/autonomous-work-run", () => ({ createAutonomousWorkRun: mocks.create }));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: mocks.message }));
import { admitForegroundWork } from "./foreground-work-admission";

const input = { userId: "owner", agentId: "coo", threadId: "conversation", userMessageId: "message", routeContext: "/workspace/mailroom", content: "Prepare a checklist", coworkerMode: "advise" as const };

describe("foreground admission authority and immutable request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.thread.mockResolvedValue({ userId: "owner" });
    mocks.existing.mockResolvedValue(null);
    mocks.link.mockResolvedValue({ count: 1 });
    mocks.create.mockImplementation(async (options) => {
      const task = { id: "row", taskRunId: options.taskRunId, contextId: "conversation" };
      await options.afterTaskCreated({ agentThread: { findUnique: mocks.thread }, agentMessage: { updateMany: mocks.link, create: mocks.receipt } }, task);
      return task;
    });
  });
  it("retains the exact request and links only its accepted user message", async () => {
    const admitted = await admitForegroundWork(input);
    expect(admitted).toMatch(/^TR-CHAT-/);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ trigger: "interactive", userId: "owner", sourceRef: { kind: "agent-message", id: "message" } }));
    expect(mocks.link).toHaveBeenCalledWith({ where: { id: "message", threadId: "conversation", role: "user", content: "Prepare a checklist", taskRunId: null }, data: { taskRunId: admitted } });
    expect(mocks.message).toHaveBeenCalledWith(expect.objectContaining({ taskRunId: admitted, content: input.content, role: "user" }), expect.anything());
  });
  it("refuses changed conversation ownership before linking or retaining input", async () => {
    mocks.thread.mockResolvedValue({ userId: "another-owner" });
    await expect(admitForegroundWork(input)).rejects.toThrow("authority changed");
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
  });
  it("refuses a duplicate or changed accepted message without another retained request", async () => {
    mocks.link.mockResolvedValue({ count: 0 });
    await expect(admitForegroundWork(input)).rejects.toThrow("already linked or no longer matches");
    expect(mocks.message).not.toHaveBeenCalled();
  });
  it("returns the original job and deadline on a repeated accepted request", async () => {
    const first = await admitForegroundWork(input);
    const metadata = mocks.create.mock.calls[0][0].metadata;
    mocks.existing.mockResolvedValue({ userId: "owner", threadId: "conversation", source: "coworker", a2aMetadata: metadata });
    expect(await admitForegroundWork(input)).toBe(first);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.receipt).toHaveBeenCalledOnce();
    await expect(admitForegroundWork({ ...input, coworkerMode: "act" })).rejects.toThrow("does not match");
  });
});
