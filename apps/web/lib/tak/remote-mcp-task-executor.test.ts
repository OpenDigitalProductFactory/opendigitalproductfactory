import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  taskFind: vi.fn(),
  taskUpdate: vi.fn(),
  taskUpdateMany: vi.fn(),
  tokenFind: vi.fn(),
  userFind: vi.fn(),
  resolveAgent: vi.fn(),
  resolveTools: vi.fn(),
  executeLoop: vi.fn(),
  createMessage: vi.fn(),
  markWorking: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findUnique: mocks.taskFind,
      update: mocks.taskUpdate,
      updateMany: mocks.taskUpdateMany,
    },
    mcpApiToken: { findUnique: mocks.tokenFind },
    user: { findUnique: mocks.userFind },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  resolveAutonomousWorkAgent: mocks.resolveAgent,
  resolveAutonomousWorkTools: mocks.resolveTools,
  executeAutonomousAgenticLoop: mocks.executeLoop,
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: mocks.createMessage }));
vi.mock("@/lib/observability/heartbeat", () => ({ markTaskRunWorking: mocks.markWorking }));

import { executeRemoteTask } from "./remote-mcp-task-executor";

const task = {
  id: "row-1",
  taskRunId: "TR-MCP-1",
  userId: "u1",
  contextId: "thread-1",
  threadId: "thread-1",
  currentAgentId: "AGT-REMOTE",
  routeContext: "/platform/tools/discovery",
  status: "working",
  cancellationRequestedAt: null,
  a2aMetadata: {
    trigger: "external-mcp",
    sourceRef: { kind: "mcp-token", id: "tok-1" },
    apiTokenId: "tok-1",
    riskClass: "read",
  },
  messages: [{ parts: [{ type: "message", text: "Summarize the backlog." }] }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.taskFind.mockResolvedValue(task);
  mocks.taskUpdate.mockResolvedValue(task);
  mocks.taskUpdateMany.mockResolvedValue({ count: 1 });
  mocks.tokenFind.mockResolvedValue({
    id: "tok-1",
    userId: "u1",
    agentId: "AGT-REMOTE",
    scopes: ["backlog_read"],
    scope: "read",
    capability: "read",
    revokedAt: null,
    expiresAt: null,
  });
  mocks.userFind.mockResolvedValue({
    isSuperuser: false,
    groups: [{ platformRole: { roleId: "HR-EMPLOYEE" } }],
  });
  mocks.resolveAgent.mockResolvedValue({
    agentId: "AGT-REMOTE",
    systemPrompt: "You are a coworker.",
    sensitivity: "internal",
    displayName: "Remote Coworker",
  });
  mocks.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
  mocks.executeLoop.mockResolvedValue({ content: "Done.", executedTools: [] });
});

describe("remote MCP task executor", () => {
  it("revalidates the durable PAT before allocating an agent or model", async () => {
    mocks.tokenFind.mockResolvedValue({
      id: "tok-1",
      userId: "u1",
      agentId: "AGT-REMOTE",
      scopes: ["backlog_read"],
      scope: "read",
      capability: "read",
      revokedAt: new Date(),
      expiresAt: null,
    });
    await executeRemoteTask("TR-MCP-1");
    expect(mocks.resolveAgent).not.toHaveBeenCalled();
    expect(mocks.executeLoop).not.toHaveBeenCalled();
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
  });

  it("reconstructs execution from durable references and writes the terminal result", async () => {
    await executeRemoteTask("TR-MCP-1");
    expect(mocks.markWorking).toHaveBeenCalledWith("TR-MCP-1");
    expect(mocks.resolveTools).toHaveBeenCalledWith(expect.objectContaining({
      mode: "advise",
      externalAccessEnabled: true,
      authorityGrants: ["backlog_read"],
    }));
    expect(mocks.executeLoop).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-1",
      apiTokenId: "tok-1",
      chatHistory: [{ role: "user", content: "Summarize the backlog." }],
    }));
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-MCP-1",
      role: "assistant",
      content: "Done.",
    }));
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ cancellationRequestedAt: null }),
      data: expect.objectContaining({ status: "completed" }),
    }));
  });

  it("honors cancellation before allocating an agent or model", async () => {
    mocks.taskFind.mockResolvedValue({ ...task, cancellationRequestedAt: new Date() });
    await executeRemoteTask("TR-MCP-1");
    expect(mocks.executeLoop).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "canceled" }),
    }));
  });
});
