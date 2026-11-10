import { describe, expect, it, vi } from "vitest";
import { mcpTaskNotificationBus } from "./mcp-task-notification-bus";

const task = {
  taskRunId: "TR-MCP-NOTIFY-1",
  userId: "user-1",
  title: "Review",
  objective: "Review exact artifact",
  status: "working",
  progressPayload: null,
  createdAt: new Date("2026-08-31T01:00:00.000Z"),
  updatedAt: new Date("2026-08-31T01:00:01.000Z"),
  completedAt: null,
};

describe("mcpTaskNotificationBus", () => {
  it("delivers each logical transition to one of several streams for the same token", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = mcpTaskNotificationBus.subscribe("token-shared", first);
    const stopSecond = mcpTaskNotificationBus.subscribe("token-shared", second);

    mcpTaskNotificationBus.publish("token-shared", task);
    expect(first.mock.calls.length + second.mock.calls.length).toBe(1);

    mcpTaskNotificationBus.publish("token-shared", { ...task, status: "completed" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    stopFirst();
    stopSecond();
  });

  it("never crosses token scopes", () => {
    const other = vi.fn();
    const stop = mcpTaskNotificationBus.subscribe("token-other", other);
    mcpTaskNotificationBus.publish("token-owner", task);
    expect(other).not.toHaveBeenCalled();
    stop();
  });
});
