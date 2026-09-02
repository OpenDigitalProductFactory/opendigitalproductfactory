import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: { taskRun: { findMany: (...args: unknown[]) => db.findMany(...args) } },
}));

import { mcpTaskNotificationBus } from "@/lib/mcp-task-notification-bus";
import { openMcpTaskStatusStream } from "./task-status-stream";

const owner = { tokenId: "token-1", userId: "user-1" };
const task = {
  taskRunId: "TR-MCP-ASYNC-1",
  userId: "user-1",
  title: "Review",
  objective: "Review exact artifact",
  status: "working",
  progressPayload: null,
  createdAt: new Date("2026-08-31T01:00:00.000Z"),
  updatedAt: new Date("2026-08-31T01:00:01.000Z"),
  completedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.findMany.mockResolvedValue([]);
});

describe("openMcpTaskStatusStream", () => {
  it("replays only the token-owned durable task snapshot", async () => {
    db.findMany.mockResolvedValue([task]);
    const response = await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1"),
      owner,
    );
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "user-1",
        a2aMetadata: { path: ["apiTokenId"], equals: "token-1" },
      }),
    }));

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const replay = `${decoder.decode((await reader.read()).value)}${decoder.decode((await reader.read()).value)}`;
    expect(replay).toContain('"method":"notifications/tasks/status"');
    expect(replay).toContain('"taskId":"TR-MCP-ASYNC-1"');
    await reader.cancel();
  });

  it("pushes a committed live transition without a polling request", async () => {
    const response = await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1"),
      owner,
    );
    const reader = response.body!.getReader();
    await reader.read(); // : connected
    mcpTaskNotificationBus.publish(owner.tokenId, { ...task, status: "completed" });
    const pushed = new TextDecoder().decode((await reader.read()).value);
    expect(pushed).toContain('"method":"notifications/tasks/status"');
    expect(pushed).toContain('"status":"completed"');
    await reader.cancel();
  });

  it("rejects a GET client that does not accept an event stream", async () => {
    const response = await openMcpTaskStatusStream(
      new Request("http://localhost:3000/api/mcp/v1", { headers: { Accept: "application/json" } }),
      owner,
    );
    expect(response.status).toBe(406);
    expect(db.findMany).not.toHaveBeenCalled();
  });
});
