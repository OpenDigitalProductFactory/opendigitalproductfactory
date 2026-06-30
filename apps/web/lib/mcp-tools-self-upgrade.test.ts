import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequestSelfUpgrade = vi.fn();

vi.mock("@/lib/self-upgrade/request", () => ({
  requestSelfUpgrade: mockRequestSelfUpgrade,
}));

describe("self-upgrade MCP tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes request_self_upgrade as an operator side-effecting tool", async () => {
    const { PLATFORM_TOOLS } = await import("./mcp-tools");
    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === "request_self_upgrade");
    const properties = tool?.inputSchema.properties as Record<string, unknown> | undefined;

    expect(tool).toBeDefined();
    expect(tool?.requiredCapability).toBe("manage_provider_connections");
    expect(tool?.executionMode).toBe("immediate");
    expect(tool?.sideEffect).toBe(true);
    expect(tool?.inputSchema.required).toEqual([]);
    expect(properties?.force).toBeUndefined();
  });

  it("queues the governed self-upgrade request as an agent trigger", async () => {
    mockRequestSelfUpgrade.mockResolvedValueOnce({
      success: true,
      status: "queued",
      runId: "SUR-QUEUED1",
      triggeredBy: "mcp:codex",
      eventIds: ["evt-1"],
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "request_self_upgrade",
      { reason: "codex" },
      "user-1",
      { agentId: "codex" },
    );

    expect(result).toMatchObject({
      success: true,
      message: "Queued governed self-upgrade SUR-QUEUED1.",
      data: { status: "queued", runId: "SUR-QUEUED1" },
    });
    expect(mockRequestSelfUpgrade).toHaveBeenCalledWith({
      requestedBy: "mcp:codex",
      actorKind: "agent",
    });
  });

  it("surfaces the human override requirement without queueing a run", async () => {
    mockRequestSelfUpgrade.mockResolvedValueOnce({
      success: true,
      status: "human_override_required",
      reason: "outside-window",
      message: "Self-upgrade is outside the allowed maintenance window. Use /ops/self-upgrade for a human override.",
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("request_self_upgrade", {}, "user-1", { agentId: "codex" });

    expect(result).toMatchObject({
      success: true,
      message: "Self-upgrade is outside the allowed maintenance window. Use /ops/self-upgrade for a human override.",
      data: {
        status: "human_override_required",
        reason: "outside-window",
      },
    });
    expect(mockRequestSelfUpgrade).toHaveBeenCalledWith({
      requestedBy: "mcp:codex",
      actorKind: "agent",
    });
  });
});
