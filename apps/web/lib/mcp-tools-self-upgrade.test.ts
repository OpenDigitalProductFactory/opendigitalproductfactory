import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequestSelfUpgrade = vi.fn();
const mockGetQuiescenceActivity = vi.fn();

vi.mock("@/lib/self-upgrade/request", () => ({
  requestSelfUpgrade: mockRequestSelfUpgrade,
}));

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  getQuiescenceActivity: mockGetQuiescenceActivity,
}));

describe("self-upgrade MCP tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuiescenceActivity.mockResolvedValue({
      level: "normal",
      runId: null,
      enteredAt: null,
      run: null,
      blockersCapturedAt: null,
      blockers: [],
    });
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

  it("exposes get_quiescence_status as a read-only operator status surface", async () => {
    const { PLATFORM_TOOLS } = await import("./mcp-tools");
    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === "get_quiescence_status");

    expect(tool).toBeDefined();
    expect(tool?.requiredCapability).toBe("view_operations");
    expect(tool?.executionMode).toBe("immediate");
    expect(tool?.sideEffect).toBe(false);
    expect(tool?.inputSchema.required).toEqual([]);
  });

  it("returns active coordinator, blockers, retry hints, and write implications", async () => {
    mockGetQuiescenceActivity.mockResolvedValueOnce({
      level: "draining",
      runId: "QR-STATUS",
      enteredAt: "2026-07-24T14:00:00.000Z",
      run: {
        runId: "QR-STATUS",
        status: "draining",
        trigger: "self-upgrade",
        targetVersion: "1.2.3",
        targetBundleHash: "abc123",
        deferSurface: "mcp",
        deferReason: "portal_quiescing",
        budgetMs: 60000,
        drainStartedAt: "2026-07-24T14:00:00.000Z",
        lastHeartbeatAt: "2026-07-24T14:00:20.000Z",
      },
      blockersCapturedAt: "2026-07-24T14:00:10.000Z",
      blockers: [
        {
          surface: "task-run",
          label: "build gate",
          kind: "agent-task",
          count: 2,
          estimatedWaitMs: 30000,
          sampleAgent: "codex",
          sampleTitle: "local CI",
          oldestSignalAt: "2026-07-24T14:00:02.000Z",
          stale: false,
        },
      ],
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("get_quiescence_status", {}, "user-1", { agentId: "codex" });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      level: "draining",
      runId: "QR-STATUS",
      trigger: "self-upgrade",
      activeTaskCount: 2,
      retryAfterSeconds: 30,
      writesRefused: true,
      writeImplications: expect.stringMatching(/mutating MCP writes are refused/i),
      activeCoordinator: {
        kind: "self-upgrade",
        runId: "QR-STATUS",
        status: "draining",
      },
    });
    expect(result.data?.drainBlockers).toHaveLength(1);
    expect(result.data?.cleanupOperationsAllowed).toContain("release_nonprod_environment_lease");
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
