// BI-B1A6A2BE: tools/call parity for the MCP `tasks/result` read.
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleTasksResult = vi.fn();
const tasksLifecycleEnabled = vi.fn(() => true);
vi.mock("@/lib/mcp/tasks-lifecycle", () => ({ handleTasksResult, tasksLifecycleEnabled }));

import { mcpTaskResultPack } from "./mcp-task-result-pack";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

const handler = mcpTaskResultPack.handlers.read_task_result!;

beforeEach(() => {
  handleTasksResult.mockReset();
  tasksLifecycleEnabled.mockReturnValue(true);
});

describe("mcpTaskResultPack shape", () => {
  it("declares one read-only tool with matching handler and grants", () => {
    expect(mcpTaskResultPack.definitions.map((d) => d.name)).toEqual(["read_task_result"]);
    expect(Object.keys(mcpTaskResultPack.handlers)).toEqual(["read_task_result"]);
    expect(mcpTaskResultPack.grants).toEqual({ read_task_result: ["backlog_read"] });
    expect(TOOL_TO_GRANTS.read_task_result).toEqual(["backlog_read"]);
    expect(mcpTaskResultPack.definitions[0]!.sideEffect).toBe(false);
  });
});

describe("read_task_result", () => {
  it("AC-1: returns the tasks/result payload for the same caller and params", async () => {
    const payload = { content: [{ type: "text", text: "Original review TR-1: unknown. x" }],
      structuredContent: { taskId: "TR-1", originalResult: { classification: "unknown" } }, isError: false };
    handleTasksResult.mockResolvedValue({ kind: "ok", value: payload });
    const result = await handler({ taskId: "TR-1", requestDigest: "a".repeat(64) }, "user-1",
      { agentId: "AGT-EXT-CODEX", tokenGrantScopes: ["backlog_read"] });
    expect(handleTasksResult).toHaveBeenCalledWith("user-1", { taskId: "TR-1", requestDigest: "a".repeat(64) },
      { actingAgentId: "AGT-EXT-CODEX", tokenGrantScopes: ["backlog_read"] });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ taskId: "TR-1", result: payload });
  });

  it("AC-2: actor and scopes come only from context, never from arguments", async () => {
    handleTasksResult.mockResolvedValue({ kind: "ok", value: {} });
    await handler({ taskId: "TR-1", actingAgentId: "AGT-EXT-CODEX", tokenGrantScopes: ["backlog_read"], userId: "x" },
      "user-1", undefined);
    expect(handleTasksResult).toHaveBeenCalledWith("user-1", { taskId: "TR-1" },
      { actingAgentId: null, tokenGrantScopes: [] });
  });

  it("AC-3: cross-owner and unknown tasks are refusals without data", async () => {
    handleTasksResult.mockResolvedValue({ kind: "forbidden", message: "task belongs to a different auth context" });
    const forbidden = await handler({ taskId: "TR-2" }, "user-1", { agentId: "A", tokenGrantScopes: [] });
    expect(forbidden).toMatchObject({ success: false, error: "forbidden" });
    expect(forbidden.data).toBeUndefined();
    handleTasksResult.mockResolvedValue({ kind: "notfound", message: "task not found: TR-3" });
    expect(await handler({ taskId: "TR-3" }, "user-1", undefined)).toMatchObject({ success: false, error: "notfound" });
  });

  it("validates input before reading", async () => {
    expect(await handler({}, "user-1", undefined)).toMatchObject({ success: false, error: "invalid_input" });
    expect(await handler({ taskId: "TR-1", requestDigest: "nothex" }, "user-1", undefined))
      .toMatchObject({ success: false, error: "invalid_input" });
    expect(handleTasksResult).not.toHaveBeenCalled();
  });

  it("honors the Tasks lifecycle kill switch", async () => {
    tasksLifecycleEnabled.mockReturnValue(false);
    expect(await handler({ taskId: "TR-1" }, "user-1", undefined)).toMatchObject({ success: false, error: "tasks_lifecycle_disabled" });
    expect(handleTasksResult).not.toHaveBeenCalled();
  });
});
