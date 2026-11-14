import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    marketingAssetTask: { findMany: vi.fn() },
    outboundDraft: { findMany: vi.fn() },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));

import { listDraftableAssetTasks } from "./draftable-assets";

// BI-3F641F91: draft_marketing_asset needs an assetTaskId, and no read tool
// returned one, so a scheduled marketing run could decide to draft and never do it.
describe("listDraftableAssetTasks", () => {
  beforeEach(() => {
    mocks.prisma.marketingAssetTask.findMany.mockReset();
    mocks.prisma.outboundDraft.findMany.mockReset();
  });

  it("names live LinkedIn and email tasks that have no draft yet, by id", async () => {
    mocks.prisma.marketingAssetTask.findMany.mockResolvedValue([
      { taskId: "T1", title: "Partner launch post", channel: "linkedin", campaignId: "C1" },
      { taskId: "T2", title: "Owner email", channel: "email", campaignId: null },
      { taskId: "T3", title: "Already drafted", channel: "linkedin", campaignId: "C1" },
    ]);
    mocks.prisma.outboundDraft.findMany.mockResolvedValue([{ sourceId: "T3" }]);

    const result = await listDraftableAssetTasks("org-1");

    expect(result).toEqual([
      { assetTaskId: "T1", title: "Partner launch post", channel: "linkedin", campaignId: "C1" },
      { assetTaskId: "T2", title: "Owner email", channel: "email", campaignId: null },
    ]);
    const where = mocks.prisma.marketingAssetTask.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ organizationId: "org-1", status: { not: "archived" }, channel: { in: ["linkedin", "email"] } });
  });

  it("returns nothing when every task is drafted", async () => {
    mocks.prisma.marketingAssetTask.findMany.mockResolvedValue([{ taskId: "T1", title: "x", channel: "email", campaignId: null }]);
    mocks.prisma.outboundDraft.findMany.mockResolvedValue([{ sourceId: "T1" }]);
    expect(await listDraftableAssetTasks("org-1")).toEqual([]);
  });
});
