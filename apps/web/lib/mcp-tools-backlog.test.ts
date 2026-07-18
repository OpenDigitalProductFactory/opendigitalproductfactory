import { beforeEach, describe, expect, it, vi } from "vitest";

vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "info").mockImplementation(() => undefined);

const { mockPrisma, mockInngest } = vi.hoisted(() => ({
  mockPrisma: {
    backlogItem: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    backlogItemActivity: {
      create: vi.fn(),
    },
    epic: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    employeeProfile: {
      findFirst: vi.fn(),
    },
    featureBuild: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    buildActivity: {
      create: vi.fn(),
    },
    workCapsule: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      // BI-937128F6: unified WIP query reads active capsules across surfaces.
      findMany: vi.fn(),
    },
    workCapsuleActivity: {
      create: vi.fn(),
    },
    // BI-937128F6: unified WIP query reads the active shared nonprod leases.
    nonProductionEnvironmentLease: {
      findMany: vi.fn(),
    },
    platformDevConfig: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockInngest: {
    send: vi.fn(),
  },
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: mockInngest,
}));

// promote_to_build_studio fires a detached `void (async () => …)()` that
// dynamically imports this module and dispatches Ideate. With the real module
// in place that fire-and-forget rejects under the mocked prisma and calls
// console.error *after* the test has returned — surfacing during worker
// teardown as the intermittent
// "Closing rpc while \"onUserConsoleLog\" was pending" EnvironmentTeardownError.
// Stubbing the dispatch makes the detached promise resolve quietly so nothing
// logs during teardown.
vi.mock("@/lib/integrate/ideate-on-approval", () => ({
  dispatchIdeateForApprovedBuild: vi.fn().mockResolvedValue(undefined),
}));

// Same detached-async hazard as above: every backlog status transition now fires
// a fire-and-forget `void (async () => …)()` that bridges the item to a WorkItem
// (EP-WORK-CONVERGENCE / BI-AC815F1E). With the real bridge in place that promise
// rejects under the mocked prisma and console.warns *after* the test returns —
// surfacing during worker teardown as the intermittent
// "Closing rpc while \"onUserConsoleLog\" was pending" EnvironmentTeardownError.
// Stubbing the bridge makes the detached promise resolve quietly.
vi.mock("@/lib/queue/bridges/backlog-bridge", () => ({
  bridgeBacklogItemToWorkItem: vi.fn().mockResolvedValue(null),
}));

import { executeTool } from "./mcp-tools";

describe("backlog MCP tool execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      id: "singleton",
      governedBacklogEnabled: true,
      backlogTeeUpDailyCap: 3,
    });
    mockPrisma.workCapsule.findUnique.mockResolvedValue(null);
    mockPrisma.workCapsule.findMany.mockResolvedValue([]);
    mockPrisma.nonProductionEnvironmentLease.findMany.mockResolvedValue([]);
    mockPrisma.workCapsule.create.mockResolvedValue({
      id: "capsule-row-1",
      capsuleId: "WC-BUILD-1234",
    });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({});
    mockPrisma.epic.findMany.mockResolvedValue([]);
    mockPrisma.employeeProfile.findFirst.mockResolvedValue(null);
    mockPrisma.backlogItemActivity.create.mockResolvedValue({});
    mockPrisma.featureBuild.count.mockResolvedValue(0);
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockPrisma.buildActivity.create.mockResolvedValue({});

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

    const result = await executeTool(
      "create_epic",
      {
        epicId: "EP-WWMD",
        title: "WWMD Decision Perspective Kernel",
        description: "Governed autonomy gate for ambiguous decisions.",
        status: "open",
        source: "user-request",
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

  it("create_epic persists priority and resolves owner to the accountable employee", async () => {
    mockPrisma.epic.findFirst.mockResolvedValue(null);
    mockPrisma.employeeProfile.findFirst.mockResolvedValue({
      id: "employee-row-1",
      employeeId: "EMP-PLATFORM",
      displayName: "Platform Owner",
      workEmail: "owner@dpf.local",
    });
    mockPrisma.epic.create.mockResolvedValue({
      id: "epic-row-1",
      epicId: "EP-MCP",
      title: "MCP generic epic management",
      status: "in-progress",
      priority: 2,
      accountableEmployeeId: "employee-row-1",
      accountableEmployee: {
        employeeId: "EMP-PLATFORM",
        displayName: "Platform Owner",
        workEmail: "owner@dpf.local",
      },
      completedAt: null,
    });

    const result = await executeTool(
      "create_epic",
      {
        epicId: "EP-MCP",
        title: "MCP generic epic management",
        status: "in-progress",
        priority: 2,
        owner: "owner@dpf.local",
        source: "automated-detection",
      },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.employeeProfile.findFirst).toHaveBeenCalled();
    expect(mockPrisma.epic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 2,
          accountableEmployeeId: "employee-row-1",
        }),
      }),
    );
    expect(result.data).toEqual(
      expect.objectContaining({
        epicId: "EP-MCP",
        priority: 2,
        owner: expect.objectContaining({
          employeeId: "EMP-PLATFORM",
          displayName: "Platform Owner",
        }),
      }),
    );
  });

  it("create_epic warns when the title is similar to an active epic", async () => {
    mockPrisma.epic.findFirst.mockResolvedValue(null);
    mockPrisma.epic.findMany.mockResolvedValue([
      {
        epicId: "EP-MCP",
        title: "MCP generic epic management",
        status: "open",
      },
    ]);
    mockPrisma.epic.create.mockResolvedValue({
      id: "epic-row-2",
      epicId: "EP-MCP-2",
      title: "MCP generic epic management tools",
      status: "open",
      priority: null,
      accountableEmployeeId: null,
      accountableEmployee: null,
      completedAt: null,
    });

    const result = await executeTool(
      "create_epic",
      {
        epicId: "EP-MCP-2",
        title: "MCP generic epic management tools",
      },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(result.data?.similarEpics).toEqual([
      expect.objectContaining({
        epicId: "EP-MCP",
        title: "MCP generic epic management",
        status: "open",
      }),
    ]);
    expect(result.data?.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("similar active epic")]),
    );
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

  it("update_epic updates priority and preserves spec/plan context in the response", async () => {
    mockPrisma.epic.findFirst.mockResolvedValue({
      id: "epic-row-1",
      epicId: "EP-WWMD",
      title: "WWMD Decision Perspective Kernel",
      description: "Old description",
      status: "open",
      priority: null,
      completedAt: null,
    });
    mockPrisma.epic.update.mockResolvedValue({
      id: "epic-row-1",
      epicId: "EP-WWMD",
      title: "WWMD Decision Perspective Kernel",
      description: "Old description",
      status: "open",
      priority: 4,
      completedAt: null,
    });

    const result = await executeTool(
      "update_epic",
      {
        epicId: "EP-WWMD",
        priority: 4,
        specPath: "docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md",
        planPath: "docs/superpowers/plans/2026-05-17-wwmd-decision-perspective-kernel-implementation.md",
      },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.epic.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "epic-row-1" },
        data: expect.objectContaining({
          priority: 4,
        }),
      }),
    );
    expect(result.data).toEqual(
      expect.objectContaining({
        epicId: "EP-WWMD",
        priority: 4,
        specPath: "docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md",
        planPath: "docs/superpowers/plans/2026-05-17-wwmd-decision-perspective-kernel-implementation.md",
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

  describe("update_backlog_item_status claim-on-start gate", () => {
    const FRESH = new Date().toISOString();
    const STALE = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();

    function openRow(overrides: Record<string, unknown> = {}) {
      return {
        id: "claim-row-1",
        itemId: "BI-CLAIM01",
        status: "open",
        epicId: null,
        triageOutcome: "build",
        effortSize: "small",
        activeBuildId: null,
        claimStatus: null,
        claimedById: null,
        claimedByAgentId: null,
        claimedAt: null,
        ...overrides,
      };
    }

    async function startInProgress(force = false) {
      return executeTool(
        "update_backlog_item_status",
        { itemId: "BI-CLAIM01", status: "in-progress", ...(force ? { force: true } : {}) },
        "user-1",
        { agentId: "AGT-1" },
      );
    }

    it("acquires via atomic updateMany then writes status", async () => {
      mockPrisma.backlogItem.findUnique.mockResolvedValue(openRow());
      mockPrisma.backlogItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.backlogItem.update.mockResolvedValue({ itemId: "BI-CLAIM01", status: "in-progress", epicId: null, completedAt: null });
      expect((await startInProgress()).success).toBe(true);
      expect(mockPrisma.backlogItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ claimStatus: "active", claimedById: "user-1" }) }),
      );
    });

    it("rejects when atomic claim loses the race (count=0)", async () => {
      const held = openRow({ claimStatus: "active", claimedById: "user-2", claimedByAgentId: "AGT-2", claimedAt: FRESH });
      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce(held).mockResolvedValueOnce(held);
      mockPrisma.backlogItem.updateMany.mockResolvedValue({ count: 0 });
      const result = await startInProgress();
      expect(result.success).toBe(false);
      expect(result.error).toBe("claim_conflict");
      expect(mockPrisma.backlogItem.update).not.toHaveBeenCalled();
    });

    it("force=true takes over and records forcedClaim", async () => {
      mockPrisma.backlogItem.findUnique.mockResolvedValue(
        openRow({ claimStatus: "active", claimedById: "user-2", claimedByAgentId: "AGT-2", claimedAt: FRESH }),
      );
      mockPrisma.backlogItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.backlogItem.update.mockResolvedValue({ itemId: "BI-CLAIM01", status: "in-progress", epicId: null, completedAt: null });
      expect((await startInProgress(true)).success).toBe(true);
      expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ forcedClaim: true }) }) }),
      );
    });

    it("reclaims stale claims and allows same-session re-entry", async () => {
      mockPrisma.backlogItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.backlogItem.update.mockResolvedValue({ itemId: "BI-CLAIM01", status: "in-progress", epicId: null, completedAt: null });
      mockPrisma.backlogItem.findUnique.mockResolvedValue(
        openRow({ claimStatus: "active", claimedById: "user-2", claimedByAgentId: "AGT-2", claimedAt: STALE }),
      );
      expect((await startInProgress()).success).toBe(true);
      mockPrisma.backlogItem.findUnique.mockResolvedValue(
        openRow({ claimStatus: "active", claimedById: "user-1", claimedByAgentId: "AGT-1", claimedAt: FRESH }),
      );
      expect((await startInProgress()).success).toBe(true);
    });

    it("releases the claim when leaving in-progress", async () => {
      mockPrisma.backlogItem.findUnique.mockResolvedValue(
        openRow({ status: "in-progress", claimStatus: "active", claimedById: "user-1", claimedByAgentId: "AGT-1", claimedAt: FRESH }),
      );
      mockPrisma.backlogItem.update.mockResolvedValue({ itemId: "BI-CLAIM01", status: "done", epicId: null, completedAt: new Date() });
      const result = await executeTool(
        "update_backlog_item_status",
        { itemId: "BI-CLAIM01", status: "done", resolution: "Shipped." },
        "user-1",
        { agentId: "AGT-1" },
      );
      expect(result.success).toBe(true);
      expect(mockPrisma.backlogItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "done", claimStatus: "released" }) }),
      );
    });
  });
});
