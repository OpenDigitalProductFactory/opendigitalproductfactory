import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  backlogItem: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  featureBuild: {
    create: vi.fn(),
  },
  platformDevConfig: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
};

const mockInngest = {
  send: vi.fn(),
};
vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: mockInngest,
}));
describe("backlog MCP tool execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      id: "singleton",
      governedBacklogEnabled: true,
      backlogTeeUpDailyCap: 3,
    });

    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return callback(mockPrisma);
    });
  });

  it("triage_backlog_item persists triage fields and opens a build candidate", async () => {
    const backlogRow = {
      id: "backlog-row-1",
      itemId: "BI-123",
      status: "triaging",
      triageOutcome: null,
    };

    mockPrisma.backlogItem.findUnique.mockResolvedValue(backlogRow);
    mockPrisma.backlogItem.update.mockResolvedValue({
      ...backlogRow,
      status: "open",
      triageOutcome: "build",
      effortSize: "medium",
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "triage_backlog_item",
      {
        itemId: "BI-123",
        outcome: "build",
        rationale: "Clear product gap and ready for Build Studio.",
        effortSize: "medium",
      },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "BI-123" },
        data: expect.objectContaining({
          status: "open",
          triageOutcome: "build",
          effortSize: "medium",
        }),
      }),
    );
  });

  it("size_backlog_item updates effort size only", async () => {
    const backlogRow = {
      id: "backlog-row-1",
      itemId: "BI-123",
      status: "open",
      triageOutcome: "build",
      effortSize: null,
    };

    mockPrisma.backlogItem.findUnique.mockResolvedValue(backlogRow);
    mockPrisma.backlogItem.update.mockResolvedValue({
      ...backlogRow,
      effortSize: "large",
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "size_backlog_item",
      { itemId: "BI-123", size: "large" },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "BI-123" },
        data: { effortSize: "large" },
      }),
    );
  });

  it("promote_to_build_studio creates a draft build and keeps backlog open in governed mode", async () => {
    const backlogRow = {
      id: "backlog-row-1",
      itemId: "BI-123",
      title: "Sandbox-first governed workflow",
      body: "Implement the workflow UX and approvals.",
      status: "open",
      triageOutcome: "build",
      activeBuildId: null,
      digitalProductId: null,
      epicId: null,
    };

    mockPrisma.backlogItem.findUnique.mockResolvedValue(backlogRow);
    mockPrisma.featureBuild.create.mockResolvedValue({
      id: "build-row-1",
      buildId: "FB-12345678",
    });
    mockPrisma.backlogItem.update.mockResolvedValue({
      ...backlogRow,
      activeBuildId: "build-row-1",
      status: "open",
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "promote_to_build_studio",
      { itemId: "BI-123" },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        buildId: "FB-12345678",
        backlogItemId: "BI-123",
      }),
    );
    expect(mockPrisma.featureBuild.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Sandbox-first governed workflow",
          originatingBacklogItemId: "backlog-row-1",
          draftApprovedAt: null,
        }),
      }),
    );
    expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "BI-123" },
        data: expect.objectContaining({
          activeBuildId: "build-row-1",
          status: "open",
        }),
      }),
    );
  });
  it("process_backlog_for_build_studio queues an on-demand tee-up sweep", async () => {
    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "process_backlog_for_build_studio",
      { limit: 2 },
      "user-1",
      { routeContext: "/build", threadId: "thread-1", agentId: "AGT-1" },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: "queued", limit: 2 });
    expect(mockInngest.send).toHaveBeenCalledWith({
      name: "build/backlog-tee-up.requested",
      data: {
        userId: "user-1",
        limit: 2,
        routeContext: "/build",
        threadId: "thread-1",
        requestedByAgentId: "AGT-1",
      },
    });
  });
});
