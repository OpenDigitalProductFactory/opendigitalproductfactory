import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  platformDevConfig: {
    findUnique: vi.fn(),
  },
  backlogItem: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  epic: {
    create: vi.fn(),
  },
  featureBuild: {
    create: vi.fn(),
    update: vi.fn(),
  },
  buildActivity: {
    create: vi.fn(),
  },
  backlogItemActivity: {
    create: vi.fn(),
  },
  workCapsule: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  workCapsuleActivity: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

describe("governed backlog tee-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      id: "singleton",
      governedBacklogEnabled: true,
      backlogTeeUpDailyCap: 2,
    });
    mockPrisma.backlogItemActivity.create.mockResolvedValue({});
    mockPrisma.workCapsule.findUnique.mockResolvedValue(null);
    mockPrisma.workCapsule.create.mockResolvedValue({
      id: "capsule-row-1",
      capsuleId: "WC-BUILD01",
    });
    mockPrisma.workCapsuleActivity.create.mockResolvedValue({});
    mockPrisma.featureBuild.update.mockResolvedValue({});

    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => {
      return callback(mockPrisma);
    });
  });

  it("selects only eligible items, preferring active-epic work before bootstrap candidates", async () => {
    const { selectGovernedBacklogTeeUpCandidates } = await import("./governed-backlog-tee-up");

    const selected = selectGovernedBacklogTeeUpCandidates(
      [
        {
          id: "bootstrap-older",
          itemId: "BI-BOOT-OLDER",
          title: "Bootstrap older",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "medium",
          activeBuildId: null,
          digitalProductId: null,
          epicId: null,
          createdAt: new Date("2026-04-24T12:00:00.000Z"),
          epic: null,
        },
        {
          id: "epic-newer",
          itemId: "BI-EPIC-NEWER",
          title: "Epic newer",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "large",
          activeBuildId: null,
          digitalProductId: null,
          epicId: "epic-1",
          createdAt: new Date("2026-04-24T13:00:00.000Z"),
          epic: { status: "open" },
        },
        {
          id: "epic-older",
          itemId: "BI-EPIC-OLDER",
          title: "Epic older",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "small",
          activeBuildId: null,
          digitalProductId: null,
          epicId: "epic-2",
          createdAt: new Date("2026-04-24T11:00:00.000Z"),
          epic: { status: "in-progress" },
        },
        {
          id: "xlarge",
          itemId: "BI-XL",
          title: "Too large",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "xlarge",
          activeBuildId: null,
          digitalProductId: null,
          epicId: "epic-3",
          createdAt: new Date("2026-04-24T10:00:00.000Z"),
          epic: { status: "open" },
        },
        {
          id: "already-active",
          itemId: "BI-ACTIVE",
          title: "Already active",
          body: null,
          status: "open",
          triageOutcome: "build",
          effortSize: "medium",
          activeBuildId: "build-row-1",
          digitalProductId: null,
          epicId: null,
          createdAt: new Date("2026-04-24T09:00:00.000Z"),
          epic: null,
        },
      ],
      3,
    );

    expect(selected.map((item) => item.itemId)).toEqual([
      "BI-EPIC-OLDER",
      "BI-EPIC-NEWER",
      "BI-BOOT-OLDER",
    ]);
  });

  it("creates draft builds for the selected items and auto-approves them under governed flow (BI-52022707 axis D)", async () => {
    mockPrisma.backlogItem.findMany.mockResolvedValue([
      {
        id: "backlog-epic",
        itemId: "BI-EPIC-1",
        title: "Epic-backed workflow work",
        body: "Implement governed workflow details",
        status: "open",
        triageOutcome: "build",
        effortSize: "medium",
        activeBuildId: null,
        digitalProductId: "product-1",
        epicId: "epic-1",
        createdAt: new Date("2026-04-24T10:00:00.000Z"),
        epic: { status: "open" },
      },
      {
        id: "backlog-bootstrap",
        itemId: "BI-BOOT-2",
        title: "Bootstrap workflow work",
        body: "Create a safe draft",
        status: "open",
        triageOutcome: "build",
        effortSize: "large",
        activeBuildId: null,
        digitalProductId: null,
        epicId: null,
        createdAt: new Date("2026-04-24T11:00:00.000Z"),
        epic: null,
      },
    ]);
    mockPrisma.backlogItem.findUnique
      .mockResolvedValueOnce({
        id: "backlog-epic",
        itemId: "BI-EPIC-1",
        title: "Epic-backed workflow work",
        body: "Implement governed workflow details",
        status: "open",
        triageOutcome: "build",
        effortSize: "medium",
        activeBuildId: null,
        digitalProductId: "product-1",
        epicId: "epic-1",
        taxonomyNodeId: "taxonomy-node-1",
        createdAt: new Date("2026-04-24T10:00:00.000Z"),
        epic: { epicId: "EP-WORKFLOW-1" },
      })
      .mockResolvedValueOnce({
        id: "backlog-bootstrap",
        itemId: "BI-BOOT-2",
        title: "Bootstrap workflow work",
        body: "Create a safe draft",
        status: "open",
        triageOutcome: "build",
        effortSize: "large",
        activeBuildId: null,
        digitalProductId: null,
        epicId: null,
        taxonomyNodeId: null,
        createdAt: new Date("2026-04-24T11:00:00.000Z"),
        epic: null,
      });

    mockPrisma.epic.create.mockResolvedValueOnce({
      id: "epic-cuid-bootstrap",
      epicId: "EP-BUILD-AAAAAA",
    });

    mockPrisma.featureBuild.create
      .mockResolvedValueOnce({ id: "build-row-1", buildId: "FB-11111111" })
      .mockResolvedValueOnce({ id: "build-row-2", buildId: "FB-22222222" });

    const { runGovernedBacklogTeeUp } = await import("./governed-backlog-tee-up");
    const result = await runGovernedBacklogTeeUp({
      prisma: mockPrisma,
      userId: "user-1",
      trigger: "daily",
    });

    expect(result).toEqual({
      trigger: "daily",
      requestedLimit: 2,
      selectedCount: 2,
      createdCount: 2,
      skippedCount: 0,
      builds: [
        { backlogItemId: "BI-EPIC-1", buildId: "FB-11111111" },
        { backlogItemId: "BI-BOOT-2", buildId: "FB-22222222" },
      ],
    });

    expect(mockPrisma.featureBuild.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Epic-backed workflow work",
          description: "Implement governed workflow details",
          digitalProductId: "product-1",
          originatingBacklogItemId: "backlog-epic",
          // BI-52022707 axis D: draft created with draftApprovedAt=null;
          // the auto-approve happens as a separate featureBuild.update
          // immediately after creation when governedBacklogEnabled=true
          // and the BI body is non-empty (verified by the update assertion
          // and the approve_start activity row assertion below).
          draftApprovedAt: null,
        }),
      }),
    );

    // BI-52022707 axis D — auto-approve fires on governed-mode promotion
    // when the BI body is non-empty. The approve_start BuildActivity row
    // pairs with the featureBuild.update that populates draftApprovedAt.
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "build-row-1" },
        data: expect.objectContaining({
          draftApprovedAt: expect.any(Date),
        }),
      }),
    );
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-11111111",
          tool: "approve_start",
          summary: expect.stringContaining("Auto-approved by governed backlog flow"),
        }),
      }),
    );
    expect(mockPrisma.backlogItem.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { itemId: "BI-EPIC-1" },
        data: expect.objectContaining({
          activeBuildId: "build-row-1",
          status: "open",
        }),
      }),
    );
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-11111111",
          tool: "governed_backlog_tee_up",
          summary: expect.stringContaining("daily backlog tee-up"),
        }),
      }),
    );
    expect(mockPrisma.workCapsule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "build-studio",
          executorKind: "build-studio",
          executorRef: "FB-11111111",
          status: "working",
          backlogItemId: "backlog-epic",
          epicId: "epic-1",
          featureBuildId: "build-row-1",
          idempotencyKey: "build-studio:FB-11111111",
        }),
      }),
    );
    expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backlogItemId: "backlog-epic",
          kind: "build-studio-capsule-attached",
          recordedById: "user-1",
          summary: expect.stringContaining("FB-11111111"),
          payload: expect.objectContaining({
            buildId: "FB-11111111",
            capsuleId: "WC-BUILD01",
            featureBuildId: "build-row-1",
          }),
        }),
      }),
    );
  });

  it("skips processing when governed backlog mode is disabled", async () => {
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      id: "singleton",
      governedBacklogEnabled: false,
      backlogTeeUpDailyCap: 2,
    });

    const { runGovernedBacklogTeeUp } = await import("./governed-backlog-tee-up");
    const result = await runGovernedBacklogTeeUp({
      prisma: mockPrisma,
      userId: "user-1",
      trigger: "manual",
    });

    expect(result).toEqual({
      trigger: "manual",
      requestedLimit: 2,
      selectedCount: 0,
      createdCount: 0,
      skippedCount: 0,
      builds: [],
    });
    expect(mockPrisma.backlogItem.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.featureBuild.create).not.toHaveBeenCalled();
  });

  describe("promoteBacklogItemToBuildDraft intake initialization", () => {
    it("seeds happyPathState.intake from a BI with an existing epic and taxonomy", async () => {
      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({
        id: "bi-cuid-1",
        itemId: "BI-EPIC-OK",
        title: "Add taxonomy filter to operations map",
        body: "Operators need to scope the map by taxonomy node.",
        status: "open",
        triageOutcome: "build",
        effortSize: "medium",
        activeBuildId: null,
        digitalProductId: "product-1",
        epicId: "epic-cuid-1",
        taxonomyNodeId: "taxonomy-cuid-ops",
        epic: { epicId: "EP-OPS-001" },
      });
      mockPrisma.featureBuild.create.mockResolvedValueOnce({
        id: "build-row-1",
        buildId: "FB-12345678",
      });

      const { promoteBacklogItemToBuildDraft } = await import("./governed-backlog-tee-up");
      const result = await promoteBacklogItemToBuildDraft({
        tx: mockPrisma,
        itemId: "BI-EPIC-OK",
        userId: "user-1",
        governedBacklogEnabled: true,
      });

      expect(result.kind).toBe("success");
      if (result.kind === "success") {
        expect(result.capsuleId).toBe("WC-BUILD01");
      }
      expect(mockPrisma.epic.create).not.toHaveBeenCalled();
      expect(mockPrisma.workCapsule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: "build-studio",
            executorKind: "build-studio",
            executorRef: "FB-12345678",
            status: "working",
            backlogItemId: "bi-cuid-1",
            epicId: "epic-cuid-1",
            featureBuildId: "build-row-1",
            idempotencyKey: "build-studio:FB-12345678",
            workspaceState: expect.objectContaining({
              buildStudio: expect.objectContaining({
                buildId: "FB-12345678",
                phase: "ideate",
              }),
              backlogItem: expect.objectContaining({
                itemId: "BI-EPIC-OK",
              }),
            }),
          }),
        }),
      );
      expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            backlogItemId: "bi-cuid-1",
            kind: "build-studio-capsule-attached",
            recordedById: "user-1",
            payload: expect.objectContaining({
              buildId: "FB-12345678",
              capsuleId: "WC-BUILD01",
              featureBuildId: "build-row-1",
            }),
          }),
        }),
      );

      const createCall = mockPrisma.featureBuild.create.mock.calls[0]![0];
      const intake = createCall.data.plan.happyPathState.intake;
      expect(intake).toEqual({
        status: "ready",
        backlogItemId: "BI-EPIC-OK",
        epicId: "EP-OPS-001",
        taxonomyNodeId: "taxonomy-cuid-ops",
        constrainedGoal: "Add taxonomy filter to operations map",
        failureReason: null,
      });
    });

    it("auto-creates a solo epic and falls back to a triaged-bi taxonomy anchor when BI has neither", async () => {
      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({
        id: "bi-cuid-solo",
        itemId: "BI-SOLO",
        title: "Surface stale agent grants in admin",
        body: null,
        status: "open",
        triageOutcome: "build",
        effortSize: "small",
        activeBuildId: null,
        digitalProductId: null,
        epicId: null,
        taxonomyNodeId: null,
        epic: null,
      });
      mockPrisma.epic.create.mockResolvedValueOnce({
        id: "epic-cuid-solo",
        epicId: "EP-BUILD-ABCDEF",
      });
      mockPrisma.featureBuild.create.mockResolvedValueOnce({
        id: "build-row-solo",
        buildId: "FB-SOLO0001",
      });

      const { promoteBacklogItemToBuildDraft } = await import("./governed-backlog-tee-up");
      const result = await promoteBacklogItemToBuildDraft({
        tx: mockPrisma,
        itemId: "BI-SOLO",
        userId: "user-1",
        governedBacklogEnabled: true,
      });

      expect(result.kind).toBe("success");

      // Epic was minted from the BI title and linked back to the BI before
      // the build was created.
      expect(mockPrisma.epic.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Surface stale agent grants in admin",
            status: "open",
            epicId: expect.stringMatching(/^EP-BUILD-[A-F0-9]{6}$/),
          }),
        }),
      );
      expect(mockPrisma.backlogItem.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { itemId: "BI-SOLO" },
          data: { epicId: "epic-cuid-solo" },
        }),
      );

      const mintedEpicId = mockPrisma.epic.create.mock.calls[0]![0].data.epicId;
      const createCall = mockPrisma.featureBuild.create.mock.calls[0]![0];
      const intake = createCall.data.plan.happyPathState.intake;
      expect(intake).toEqual({
        status: "ready",
        backlogItemId: "BI-SOLO",
        epicId: mintedEpicId,
        taxonomyNodeId: "triaged-bi:bi-cuid-solo",
        constrainedGoal: "Surface stale agent grants in admin",
        failureReason: null,
      });
    });

    it("derives constrainedGoal from the BI title, truncated to 280 chars", async () => {
      const longTitle = "Long feature title ".repeat(20).trim(); // ~ 380 chars
      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({
        id: "bi-cuid-long",
        itemId: "BI-LONG",
        title: longTitle,
        body: "Even longer body. ".repeat(200),
        status: "open",
        triageOutcome: "build",
        effortSize: "medium",
        activeBuildId: null,
        digitalProductId: null,
        epicId: "epic-cuid-long",
        taxonomyNodeId: null,
        epic: { epicId: "EP-LONG-001" },
      });
      mockPrisma.featureBuild.create.mockResolvedValueOnce({
        id: "build-row-long",
        buildId: "FB-LONG0001",
      });

      const { promoteBacklogItemToBuildDraft } = await import("./governed-backlog-tee-up");
      const result = await promoteBacklogItemToBuildDraft({
        tx: mockPrisma,
        itemId: "BI-LONG",
        userId: "user-1",
        governedBacklogEnabled: true,
      });

      expect(result.kind).toBe("success");

      const createCall = mockPrisma.featureBuild.create.mock.calls[0]![0];
      const intake = createCall.data.plan.happyPathState.intake;
      expect(intake.constrainedGoal).toHaveLength(280);
      expect(longTitle.startsWith(intake.constrainedGoal)).toBe(true);
    });
  });
});
