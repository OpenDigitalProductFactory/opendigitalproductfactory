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
  featureBuild: {
    create: vi.fn(),
  },
  buildActivity: {
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

  it("creates draft builds for the selected items and leaves them awaiting approval", async () => {
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
        createdAt: new Date("2026-04-24T10:00:00.000Z"),
        epic: { status: "open" },
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
        createdAt: new Date("2026-04-24T11:00:00.000Z"),
        epic: null,
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
          draftApprovedAt: null,
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
});
