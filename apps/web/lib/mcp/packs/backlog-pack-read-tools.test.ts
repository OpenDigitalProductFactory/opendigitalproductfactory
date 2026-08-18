import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  findEpic: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { count: mocks.count, findMany: mocks.findMany },
    epic: { findFirst: mocks.findEpic },
  },
}));

import { listBacklogItems } from "./backlog-pack-read-tools";

const baseItem = {
  itemId: "BI-DEFERRAL",
  title: "Parked work",
  status: "deferred",
  type: "portfolio",
  workType: "feature",
  source: "user-request",
  priority: 1,
  effortSize: "small",
  demandStage: "qualified",
  demandScore: null,
  demandScoreFramework: null,
  scopeKind: "platform",
  archetypeCategories: [],
  archetypeIds: [],
  scopeRationale: null,
  lifecycleTags: [],
  activeBuildId: null,
  activeBuild: null,
  updatedAt: new Date("2026-08-15T12:00:00Z"),
  triageOutcome: "defer",
  epic: null,
};

describe("backlog deferral read projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(1);
    mocks.findMany.mockResolvedValue([]);
  });

  it("builds the nonconformant filter from the canonical projection fields", async () => {
    await listBacklogItems({ deferralConformance: "nonconformant" });

    expect(mocks.count).toHaveBeenCalledWith({
      where: {
        status: "deferred",
        OR: [
          { deferReason: null },
          { deferTrigger: null },
          { deferReviewAt: null },
          { deferOwnerPrincipalId: null },
          { deferredAt: null },
        ],
      },
    });
  });

  it("returns compliant owner, trigger, and review data without another query", async () => {
    mocks.findMany.mockResolvedValue([{
      ...baseItem,
      deferReason: "Waiting for the predecessor",
      deferTrigger: "The predecessor ships",
      deferReviewAt: new Date("2099-11-15T12:00:00Z"),
      deferOwnerPrincipalId: "principal-row-1",
      deferredAt: new Date("2026-08-15T12:00:00Z"),
      deferOwnerPrincipal: { principalId: "PRN-OWNER", displayName: "Portfolio owner" },
    }]);

    const result = await listBacklogItems({ deferralConformance: "compliant" });
    const item = (result.data as { items: Array<{ deferral: unknown }> }).items[0];

    expect(item?.deferral).toEqual({
      reason: "Waiting for the predecessor",
      trigger: "The predecessor ships",
      reviewAt: "2099-11-15T12:00:00.000Z",
      deferredAt: "2026-08-15T12:00:00.000Z",
      owner: { principalId: "PRN-OWNER", displayName: "Portfolio owner" },
      conformant: true,
      reviewDue: false,
    });
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid review horizon before querying the backlog", async () => {
    const result = await listBacklogItems({ deferralReviewDueBefore: "not-a-date" });

    expect(result).toMatchObject({ success: false, error: "invalid_deferral_review_due_before" });
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
