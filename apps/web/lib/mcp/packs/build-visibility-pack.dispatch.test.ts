import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    featureBuild: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    buildActivity: {
      findMany: vi.fn(),
    },
  },
  getBuildProgressVisibility: vi.fn(),
  getSandboxStateForBuild: vi.fn(),
  getDispatchHistoryForBuild: vi.fn(),
  getScopedVerificationForBuild: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY",
  prisma: mocks.prisma,
}));

vi.mock("@/lib/build/progress-visibility", () => ({
  getBuildProgressVisibility: mocks.getBuildProgressVisibility,
}));

vi.mock("@/lib/build/sandbox-state", () => ({
  getSandboxStateForBuild: mocks.getSandboxStateForBuild,
}));

vi.mock("@/lib/build/dispatch-attempts", () => ({
  getDispatchHistoryForBuild: mocks.getDispatchHistoryForBuild,
}));

vi.mock("@/lib/build/scoped-verification", () => ({
  getScopedVerificationForBuild: mocks.getScopedVerificationForBuild,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.featureBuild.findUnique.mockResolvedValue({
    buildId: "FB-123",
    createdById: "user-1",
  });
});

describe("Build Studio observer MCP tools", () => {
  it("returns the shared progress visibility projection for an explicitly authorized build", async () => {
    mocks.getBuildProgressVisibility.mockResolvedValue({
      buildId: "FB-123",
      progress: {
        primary: { source: "db-task-results", completed: 1, total: 3, observedAt: "2026-05-18T12:00:00.000Z" },
        conflicts: [],
      },
    });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool("get_build_progress_visibility", { buildId: "FB-123" }, "user-1");

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("FB-123");
    expect(result.message).toContain("1/3 tasks");
    expect(mocks.getBuildProgressVisibility).toHaveBeenCalledWith("FB-123");
  });

  it("returns bounded activity rows after an ISO cursor", async () => {
    mocks.prisma.buildActivity.findMany.mockResolvedValue([
      {
        id: "act-1",
        buildId: "FB-123",
        tool: "resume_implementation",
        summary: "Resume clicked",
        createdAt: new Date("2026-05-18T12:05:00.000Z"),
      },
    ]);

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "list_build_activity_since",
      { buildId: "FB-123", cursor: "2026-05-18T12:00:00.000Z" },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mocks.prisma.buildActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        buildId: "FB-123",
        createdAt: { gt: new Date("2026-05-18T12:00:00.000Z") },
      },
      take: 50,
    }));
    expect(result.data?.nextCursor).toBe("2026-05-18T12:05:00.000Z");
  });
});
