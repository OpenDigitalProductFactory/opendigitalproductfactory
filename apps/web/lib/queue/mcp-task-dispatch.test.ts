import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("./inngest-client", () => ({ inngest: { send } }));

import { enqueueRemoteTaskExecution } from "./mcp-task-dispatch";

describe("MCP task dispatch", () => {
  beforeEach(() => send.mockReset().mockResolvedValue({ ids: ["evt-1"] }));

  it("enqueues a deterministic durable reference and returns immediately", async () => {
    await enqueueRemoteTaskExecution("TR-MCP-1");
    expect(send).toHaveBeenCalledWith({
      id: "mcp-task:TR-MCP-1",
      name: "mcp/task.execute",
      data: { taskRunId: "TR-MCP-1" },
    });
  });
});
