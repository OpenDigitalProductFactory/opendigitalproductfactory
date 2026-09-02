import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("./inngest-client", () => ({ inngest: { send } }));

import { sendMcpTaskRunExecutionEvent } from "./mcp-task-run-events";

describe("external MCP TaskRun queue adapter", () => {
  beforeEach(() => send.mockReset().mockResolvedValue({ ids: ["event-1"] }));

  it("sends only the stable TaskRun identity under the deterministic event id", async () => {
    await sendMcpTaskRunExecutionEvent("TR-1", "mcp-task-run:TR-1:execute:1");

    expect(send).toHaveBeenCalledWith({
      id: "mcp-task-run:TR-1:execute:1",
      name: "mcp/task-run.execute",
      data: { taskRunId: "TR-1" },
    });
  });
});
