import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnWorkThread: vi.fn(),
  cancelThread: vi.fn(),
  getThreadResult: vi.fn(),
  getChildThreads: vi.fn(),
}));

vi.mock("@/lib/actions/agent-coworker", () => ({
  spawnWorkThread: mocks.spawnWorkThread,
  cancelThread: mocks.cancelThread,
  getThreadResult: mocks.getThreadResult,
  getChildThreads: mocks.getChildThreads,
}));

vi.mock("@/lib/mcp/deliberation-handlers", () => ({
  DELIBERATION_TOOLS: [],
  deliberateOnMcpHandler: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY",
  prisma: {},
}));

describe("thread MCP tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.spawnWorkThread.mockResolvedValue({ child: { id: "child-1" }, taskRunId: "TR-1" });
    mocks.cancelThread.mockResolvedValue({ ok: true });
    mocks.getThreadResult.mockResolvedValue({ summary: "done" });
    mocks.getChildThreads.mockResolvedValue([
      { id: "child-1", objective: "Do X", status: "submitted" },
    ]);
  });

  it("executeTool routes all three thread tools", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");

    await expect(
      executeTool("spawn_work_thread", { objective: "Do X" }, "user-1", { threadId: "parent-1" }),
    ).resolves.toMatchObject({ success: true, entityId: "child-1" });
    await expect(
      executeTool("cancel_thread", { threadId: "child-1" }, "user-1", { threadId: "parent-1" }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      executeTool("get_thread_result", { threadId: "child-1" }, "user-1", { threadId: "parent-1" }),
    ).resolves.toMatchObject({
      success: true,
      entityId: "child-1",
      data: { result: { summary: "done" } },
    });

    expect(mocks.spawnWorkThread).toHaveBeenCalledWith(
      expect.objectContaining({ parentThreadId: "parent-1", objective: "Do X" }),
      "user-1",
    );
    expect(mocks.cancelThread).toHaveBeenCalledWith({ threadId: "child-1" }, "user-1");
    expect(mocks.getThreadResult).toHaveBeenCalledWith({ childId: "child-1" }, "user-1");
  });

  it("spawn_work_thread without caller thread context returns the MCP error message", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");

    const result = await executeTool("spawn_work_thread", { objective: "Do X" }, "user-1", {});

    expect(result).toMatchObject({
      success: false,
      error: "missing_threadId",
      message: "Error: spawn_work_thread requires caller thread context",
    });
    expect(mocks.spawnWorkThread).not.toHaveBeenCalled();
  });

  it.each([
    ["cancel_thread", {}],
    ["get_thread_result", {}],
  ])("missing threadId returns an error ToolResult for %s", async (toolName, params) => {
    const { executeTool } = await import("@/lib/mcp-tools");

    const result = await executeTool(toolName, params, "user-1");

    expect(result).toMatchObject({
      success: false,
      error: "missing_threadId",
    });
    expect(mocks.spawnWorkThread).not.toHaveBeenCalled();
    expect(mocks.cancelThread).not.toHaveBeenCalled();
    expect(mocks.getThreadResult).not.toHaveBeenCalled();
  });

  it("get_child_threads still lists children for the current thread", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");

    await expect(
      executeTool("get_child_threads", {}, "user-1", { threadId: "parent-1" }),
    ).resolves.toMatchObject({ success: true, data: { threads: [{ id: "child-1" }] } });

    expect(mocks.getChildThreads).toHaveBeenCalledWith({ parentThreadId: "parent-1" }, "user-1");
  });
});
