import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    marketingCampaignBrief: { findMany: vi.fn(), update: vi.fn() },
    marketingAssetTask: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));

import { ACTIVE_MARKETING_WORK, retireMarketingWork } from "./retire-work";

describe("retireMarketingWork (BI-FB24DC2C)", () => {
  beforeEach(() => {
    for (const model of [mocks.prisma.marketingCampaignBrief, mocks.prisma.marketingAssetTask]) {
      model.findMany.mockReset();
      model.update.mockReset();
      model.update.mockResolvedValue({});
    }
  });

  it("archives named work in this organization, keeps the row and records why", async () => {
    mocks.prisma.marketingCampaignBrief.findMany.mockResolvedValue([{ briefId: "B1", notes: "old note" }]);
    mocks.prisma.marketingAssetTask.findMany.mockResolvedValue([{ taskId: "T1", brief: null }]);

    const result = await retireMarketingWork({
      organizationId: "org-1",
      briefIds: ["B1", "B-missing"],
      taskIds: ["T1"],
      reason: "Targets SaaS engineering leaders; we serve small businesses through partners",
    });

    expect(mocks.prisma.marketingCampaignBrief.findMany.mock.calls[0]?.[0]?.where).toMatchObject({
      organizationId: "org-1",
      ...ACTIVE_MARKETING_WORK,
    });
    const briefUpdate = mocks.prisma.marketingCampaignBrief.update.mock.calls[0]?.[0];
    expect(briefUpdate.data.status).toBe("archived");
    expect(briefUpdate.data.notes).toMatch(/^old note\nRetired \d{4}-\d{2}-\d{2}: Targets SaaS/);
    expect(mocks.prisma.marketingAssetTask.update.mock.calls[0]?.[0]?.data.status).toBe("archived");
    expect(result.retiredBriefIds).toEqual(["B1"]);
    expect(result.retiredTaskIds).toEqual(["T1"]);
    expect(result.notFound).toEqual(["B-missing"]);
  });

  it("does not query a model it was not asked about", async () => {
    mocks.prisma.marketingAssetTask.findMany.mockResolvedValue([]);
    await retireMarketingWork({ organizationId: "org-1", taskIds: ["T9"], reason: "duplicate" });
    expect(mocks.prisma.marketingCampaignBrief.findMany).not.toHaveBeenCalled();
  });
});
