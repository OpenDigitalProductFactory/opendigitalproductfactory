// BI-78540D2C — the daily tee-up and the capacity drain run one ranking (the
// drain calls runGovernedBacklogTeeUp with trigger "capacity-drain"), start the
// highest-demand item, and record why on the started build's activity.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  platformDevConfig: { findUnique: vi.fn() },
  backlogItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  epic: { create: vi.fn() },
  featureBuild: { create: vi.fn(), update: vi.fn() },
  buildActivity: { create: vi.fn() },
  backlogItemActivity: { create: vi.fn() },
  workroom: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  workroomActivity: { create: vi.fn() },
  platformIssueReport: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

const base = {
  title: "t", body: "b", status: "open", triageOutcome: "build", effortSize: "medium",
  activeBuildId: null, activeEpicId: null, digitalProductId: null, portfolioId: null,
  epicId: null, epic: null, workType: null, demandScoreFramework: "rice",
};
const oldUnscored = { ...base, id: "row-old", itemId: "BI-OLD", demandScore: null, investmentBucket: null, createdAt: new Date("2025-01-01") };
const newScored = { ...base, id: "row-new", itemId: "BI-HIGH", demandScore: 42, investmentBucket: "grow", createdAt: new Date("2026-09-30") };
const admitAll = async () => ({ verdict: "admit" as const, reason: "fits" });

describe("governed tee-up ranking (BI-78540D2C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true, backlogTeeUpDailyCap: 3, demandBucketTargets: null,
    });
    mockPrisma.backlogItemActivity.create.mockResolvedValue({});
    mockPrisma.workroom.findUnique.mockResolvedValue(null);
    mockPrisma.workroom.findFirst.mockResolvedValue(null);
    mockPrisma.workroom.create.mockResolvedValue({ id: "capsule-row-1", capsuleId: "WC-BUILD01" });
    mockPrisma.workroomActivity.create.mockResolvedValue({});
    mockPrisma.featureBuild.update.mockResolvedValue({});
    mockPrisma.platformIssueReport.findUnique.mockResolvedValue(null);
    mockPrisma.platformIssueReport.findFirst.mockResolvedValue(null);
    mockPrisma.platformIssueReport.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) => cb(mockPrisma));
  });

  it.each(["daily", "capacity-drain"] as const)(
    "%s: starts the highest-demand item and records the ranking reason on the build",
    async (trigger) => {
      mockPrisma.backlogItem.findMany.mockResolvedValue([oldUnscored, newScored]);
      mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({ ...newScored, taxonomyNodeId: null, epic: null });
      mockPrisma.epic.create.mockResolvedValueOnce({ id: "epic-row", epicId: "EP-BUILD-AAAAAA" });
      mockPrisma.featureBuild.create.mockResolvedValueOnce({ id: "build-row-1", buildId: "FB-11111111" });

      const { runGovernedBacklogTeeUp } = await import("./governed-backlog-tee-up");
      const result = await runGovernedBacklogTeeUp({ prisma: mockPrisma, userId: "u", trigger, limit: 1, admit: admitAll });

      expect(result.builds).toEqual([{ backlogItemId: "BI-HIGH", buildId: "FB-11111111" }]);
      expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildId: "FB-11111111",
          tool: "governed_backlog_tee_up",
          summary: expect.stringContaining("by demand score 42 (rice)"),
        }),
      });
    },
  );

  it("records that an unscored item was started without a score rather than silently by age", async () => {
    mockPrisma.backlogItem.findMany.mockResolvedValue([oldUnscored]);
    mockPrisma.backlogItem.findUnique.mockResolvedValueOnce({ ...oldUnscored, taxonomyNodeId: null, epic: null });
    mockPrisma.epic.create.mockResolvedValueOnce({ id: "epic-row", epicId: "EP-BUILD-BBBBBB" });
    mockPrisma.featureBuild.create.mockResolvedValueOnce({ id: "build-row-1", buildId: "FB-22222222" });

    const { runGovernedBacklogTeeUp } = await import("./governed-backlog-tee-up");
    await runGovernedBacklogTeeUp({ prisma: mockPrisma, userId: "u", trigger: "daily", limit: 1, admit: admitAll });

    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ summary: expect.stringMatching(/no eligible item has a demand score/i) }),
    });
  });

  it("reads the in-flight bucket mix only when investment-bucket targets are set", async () => {
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      governedBacklogEnabled: true, backlogTeeUpDailyCap: 3, demandBucketTargets: { run: 70, grow: 20, transform: 10 },
    });
    mockPrisma.backlogItem.findMany
      .mockResolvedValueOnce([oldUnscored, newScored])
      .mockResolvedValueOnce([{ investmentBucket: "run", workType: null, effortSize: "large" }]);

    const { runGovernedBacklogTeeUp } = await import("./governed-backlog-tee-up");
    // Every candidate is refused, so this checks selection without a promotion.
    const result = await runGovernedBacklogTeeUp({
      prisma: mockPrisma, userId: "u", trigger: "capacity-drain", limit: 2,
      admit: async () => ({ verdict: "refuse" as const, reason: "over allowance" }),
    });

    expect(mockPrisma.backlogItem.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.backlogItem.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ activeBuildId: { not: null } }) }),
    );
    expect(result.refused.map((r) => r.backlogItemId)).toEqual(["BI-HIGH", "BI-OLD"]);
  });

  it("selects demand fields from the backlog and does not read the in-flight mix without targets", async () => {
    mockPrisma.backlogItem.findMany.mockResolvedValue([]);
    const { runGovernedBacklogTeeUp } = await import("./governed-backlog-tee-up");
    await runGovernedBacklogTeeUp({ prisma: mockPrisma, userId: "u", trigger: "daily", admit: admitAll });

    expect(mockPrisma.backlogItem.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.backlogItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ demandScore: true, demandScoreFramework: true, investmentBucket: true }),
      }),
    );
  });
});
