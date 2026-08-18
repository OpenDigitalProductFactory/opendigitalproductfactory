import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orchestrateDeliberation: vi.fn(),
}));

vi.mock("@/lib/deliberation/orchestrator", () => ({
  orchestrateDeliberation: mocks.orchestrateDeliberation,
}));

import { deliberateOnMcpHandler } from "@/lib/mcp/deliberation-handlers";

describe("deliberate_on MCP handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs deliberation with the required buildId", async () => {
    mocks.orchestrateDeliberation.mockResolvedValue({
      deliberationRunId: "delib-1",
      branches: [{ branchNodeId: "node-1", role: "reviewer", status: "completed" }],
      consensusDecision: { decision: "approve", confidence: 0.9 },
    });

    const result = await deliberateOnMcpHandler(
      { buildId: "FB-test", artifactType: "plan" },
      "user-99",
      { routeContext: "/build", threadId: "thread-1", taskRunId: "task-1" },
    );

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("delib-1");
    expect(mocks.orchestrateDeliberation).toHaveBeenCalledWith(
      expect.objectContaining({
        buildId: "FB-test",
        userId: "user-99",
        taskRunId: "task-1",
        threadId: "thread-1",
        routeContext: "/build",
        artifactType: "plan",
      }),
    );
    expect(mocks.orchestrateDeliberation.mock.calls[0]?.[0]?.buildId).not.toBe("");
  });

  it("returns an error ToolResult when buildId is missing", async () => {
    const result = await deliberateOnMcpHandler({}, "user-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_buildId");
    expect(mocks.orchestrateDeliberation).not.toHaveBeenCalled();
  });
});
