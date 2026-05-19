import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  backlogItem: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  backlogItemActivity: {
    create: vi.fn(),
  },
  epic: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  featureBuild: {
    create: vi.fn(),
  },
  workCapsule: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  workCapsuleActivity: {
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
    mockPrisma.workCapsule.findUnique.mockResolvedValue(null);
    mockPrisma.workCapsule.create.mockResolvedValue({
      id: "capsule-row-1",
      capsuleId: "WC-BUILD-1234",
    });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({});

    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return callback(mockPrisma);
    });
  });

  it("create_epic creates a generic epic with semantic id and actor attribution", async () => {
    mockPrisma.epic.findFirst.mockResolvedValue(null);
    mockPrisma.epic.create.mockResolvedValue({
      id: "epic-row-1",
      epicId: "EP-WWMD",
      title: "WWMD Decision Perspective Kernel",
      status: "open",
      completedAt: null,
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "create_epic",
      {
        epicId: "EP-WWMD",
        title: "WWMD Decision Perspective Kernel",
        description: "Governed autonomy gate for ambiguous decisions.",
        status: "open",
        source: "feature-gap",
      },
      "user-1",
      { agentId: "AGT-1" },
    );

    expect(result.success).toBe(true);
    expect(result.entityId).toBe("EP-WWMD");
    expect(mockPrisma.epic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          epicId: "EP-WWMD",
          title: "WWMD Decision Perspective Kernel",
          description: "Governed autonomy gate for ambiguous decisions.",
          status: "open",
          submittedById: "user-1",
          agentId: "AGT-1",
        }),
      }),
    );
  });

  it("create_epic rejects duplicate semantic ids", async () => {
    mockPrisma.epic.findFirst.mockResolvedValue({
      id: "epic-row-1",
      epicId: "EP-WWMD",
      title: "Existing WWMD",
      status: "open",
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "create_epic",
      {
        epicId: "EP-WWMD",
        title: "WWMD Decision Perspective Kernel",
      },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("duplicate_epicId");
    expect(mockPrisma.epic.create).not.toHaveBeenCalled();
  });

  it("update_epic updates editable fields and marks completion when moved to done", async () => {
    mockPrisma.epic.findFirst.mockResolvedValue({
      id: "epic-row-1",
      epicId: "EP-WWMD",
      title: "WWMD Decision Perspective Kernel",
      description: "Old description",
      status: "open",
      completedAt: null,
    });
    mockPrisma.epic.update.mockResolvedValue({
      id: "epic-row-1",
      epicId: "EP-WWMD",
      title: "WWMD Decision Perspective Kernel",
      description: "Updated description",
      status: "done",
      completedAt: new Date("2026-05-19T12:00:00.000Z"),
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "update_epic",
      {
        epicId: "EP-WWMD",
        description: "Updated description",
        status: "done",
      },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.epic.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "epic-row-1" },
        data: expect.objectContaining({
          description: "Updated description",
          status: "done",
          completedAt: expect.any(Date),
        }),
      }),
    );
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
      taxonomyNodeId: null,
      epic: null,
    };

    mockPrisma.backlogItem.findUnique.mockResolvedValue(backlogRow);
    mockPrisma.epic.create.mockResolvedValue({
      id: "epic-cuid-auto",
      epicId: "EP-BUILD-AAAAAA",
    });
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

  it("retire_backlog_item marks duplicate items as deferred with canonical linkage and activity", async () => {
    const duplicateRow = {
      id: "duplicate-row-1",
      itemId: "BI-DUP",
      status: "open",
      epicId: "epic-row-1",
      activeBuildId: null,
    };
    const canonicalRow = {
      id: "canonical-row-1",
      itemId: "BI-CANON",
      status: "done",
    };

    mockPrisma.backlogItem.findUnique
      .mockResolvedValueOnce(duplicateRow)
      .mockResolvedValueOnce(canonicalRow);
    mockPrisma.backlogItem.update.mockResolvedValue({
      itemId: "BI-DUP",
      status: "deferred",
      completedAt: new Date("2026-04-29T12:00:00.000Z"),
    });
    mockPrisma.backlogItem.count.mockResolvedValue(0);

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "retire_backlog_item",
      {
        itemId: "BI-DUP",
        outcome: "duplicate",
        duplicateOfId: "BI-CANON",
        rationale: "Superseded by the canonical implemented item.",
      },
      "user-1",
      { agentId: "AGT-1" },
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "duplicate-row-1" },
        data: expect.objectContaining({
          status: "deferred",
          triageOutcome: "duplicate",
          duplicateOfId: "canonical-row-1",
          resolution: "Superseded by the canonical implemented item.",
          abandonReason: "Superseded by the canonical implemented item.",
        }),
      }),
    );
    expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backlogItemId: "duplicate-row-1",
          kind: "status_change",
          recordedById: "user-1",
          recordedByAgentId: "AGT-1",
          payload: expect.objectContaining({
            outcome: "duplicate",
            duplicateOfId: "BI-CANON",
          }),
        }),
      }),
    );
  });

  it("retire_backlog_item discards triaging verification fixtures without backlog_triage", async () => {
    const fixtureRow = {
      id: "fixture-row-1",
      itemId: "BI-FIXTURE",
      status: "triaging",
      epicId: null,
      activeBuildId: null,
    };

    mockPrisma.backlogItem.findUnique.mockResolvedValue(fixtureRow);
    mockPrisma.backlogItem.update.mockResolvedValue({
      itemId: "BI-FIXTURE",
      status: "deferred",
      completedAt: new Date("2026-04-29T12:00:00.000Z"),
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "retire_backlog_item",
      {
        itemId: "BI-FIXTURE",
        outcome: "discard",
        rationale: "Verification fixture, not product work.",
        reason: "Created to exercise the MCP backlog surface.",
      },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fixture-row-1" },
        data: expect.objectContaining({
          status: "deferred",
          triageOutcome: "discard",
          duplicateOfId: null,
          resolution: "Verification fixture, not product work.",
          abandonReason: "Created to exercise the MCP backlog surface.",
        }),
      }),
    );
  });

  it("retire_backlog_item requires duplicateOfId for duplicate retirement", async () => {
    mockPrisma.backlogItem.findUnique.mockResolvedValue({
      id: "duplicate-row-1",
      itemId: "BI-DUP",
      status: "open",
      activeBuildId: null,
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "retire_backlog_item",
      {
        itemId: "BI-DUP",
        outcome: "duplicate",
        rationale: "Duplicate row.",
      },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_duplicateOfId");
    expect(mockPrisma.backlogItem.update).not.toHaveBeenCalled();
  });

  it("record_functional_failure_evidence creates a governed backlog item for the first fingerprint", async () => {
    mockPrisma.backlogItem.findFirst.mockResolvedValue(null);
    mockPrisma.backlogItem.create.mockResolvedValue({
      id: "functional-failure-row-1",
      itemId: "BI-FUNC1",
    });
    mockPrisma.backlogItemActivity.create.mockResolvedValue({
      id: "activity-1",
      recordedAt: new Date("2026-05-11T12:00:00.000Z"),
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "record_functional_failure_evidence",
      {
        testId: "BUILD-AI-ROUTING-01",
        suite: "build-studio",
        route: "/build",
        expected: "build-specialist coworker visible",
        actual: "Software Engineer panel missing",
        screenshotPath: "test-results/build/screenshot.png",
        tracePath: null,
        userRole: "admin",
        agentId: "build-specialist",
        routeContext: "/build",
        reproCommand: "pnpm exec playwright test --project=build-studio",
        createdAt: "2026-05-11T12:00:00.000Z",
        likelyOwnerArea: "build-studio",
      },
      "user-1",
      { agentId: "platform-engineer" },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ itemId: "BI-FUNC1", action: "created" }));
    expect(mockPrisma.backlogItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "[BUILD-AI-ROUTING-01] /build functional smoke failure",
          source: "functional-test-failure",
          status: "triaging",
          agentId: "platform-engineer",
          body: expect.stringContaining("failureFingerprint:"),
        }),
      }),
    );
    expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backlogItemId: "functional-failure-row-1",
          kind: "evidence",
          recordedById: "user-1",
          recordedByAgentId: "platform-engineer",
          payload: expect.objectContaining({
            evidenceKind: "test_fail",
            testId: "BUILD-AI-ROUTING-01",
            route: "/build",
          }),
        }),
      }),
    );
  });

  it("record_functional_failure_evidence dedupes repeated failures into the existing item", async () => {
    mockPrisma.backlogItem.findFirst.mockResolvedValue({
      id: "existing-row-1",
      itemId: "BI-EXISTING",
      occurrenceCount: 2,
    });
    mockPrisma.backlogItem.update.mockResolvedValue({
      id: "existing-row-1",
      itemId: "BI-EXISTING",
      occurrenceCount: 3,
    });
    mockPrisma.backlogItemActivity.create.mockResolvedValue({
      id: "activity-2",
      recordedAt: new Date("2026-05-11T12:05:00.000Z"),
    });

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool(
      "record_functional_failure_evidence",
      {
        testId: "OPS-AI-ROUTING-01",
        suite: "ops-backlog",
        route: "/ops",
        expected: "ops-coordinator coworker visible",
        actual: "Scrum Master panel missing",
        screenshotPath: null,
        tracePath: null,
        userRole: "admin",
        agentId: "ops-coordinator",
        routeContext: "/ops",
        reproCommand: "pnpm exec playwright test --project=ops-backlog",
        createdAt: "2026-05-11T12:05:00.000Z",
        likelyOwnerArea: "ops-backlog",
      },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ itemId: "BI-EXISTING", action: "updated" }));
    expect(mockPrisma.backlogItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-row-1" },
        data: expect.objectContaining({
          occurrenceCount: { increment: 1 },
          lastSeenAt: expect.any(Date),
        }),
      }),
    );
    expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backlogItemId: "existing-row-1",
          kind: "evidence",
          summary: expect.stringContaining("OPS-AI-ROUTING-01 failed again"),
        }),
      }),
    );
  });
});
