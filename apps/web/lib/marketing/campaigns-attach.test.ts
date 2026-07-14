import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  marketingCampaign: {
    findUnique: vi.fn(),
  },
  marketingCampaignBrief: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  marketingAssetTask: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

vi.mock("../marketing", () => ({
  getMarketingWorkspaceSnapshot: vi.fn(),
}));

import { attachToCampaign } from "./campaigns";

describe("attachToCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains when the caller passes a briefId as campaignId", async () => {
    prismaMock.marketingCampaign.findUnique.mockResolvedValue(null);
    prismaMock.marketingCampaignBrief.findUnique.mockResolvedValue({
      briefId: "brief-1",
      campaignId: null,
    });
    prismaMock.marketingAssetTask.findUnique.mockResolvedValue(null);

    const result = await attachToCampaign({
      campaignId: "brief-1",
      taskId: "task-1",
    });

    expect(result).toMatchObject({
      error: "wrong-campaign-id",
    });
    expect(result.message).toMatch(/briefId/i);
    expect(result.message).toMatch(/campaignId/i);
    expect(prismaMock.marketingAssetTask.update).not.toHaveBeenCalled();
  });

  it("returns a structured not-found result when the task target is missing", async () => {
    prismaMock.marketingCampaign.findUnique.mockResolvedValue({ campaignId: "campaign-1" });
    prismaMock.marketingAssetTask.findUnique.mockResolvedValue(null);

    const result = await attachToCampaign({
      campaignId: "campaign-1",
      taskId: "missing-task",
    });

    expect(result).toMatchObject({
      error: "task-not-found",
      message: "Task missing-task does not exist.",
    });
    expect(prismaMock.marketingAssetTask.update).not.toHaveBeenCalled();
  });

  it("attaches valid brief and task targets without partial updates", async () => {
    prismaMock.marketingCampaign.findUnique.mockResolvedValue({ campaignId: "campaign-1" });
    prismaMock.marketingCampaignBrief.findUnique.mockResolvedValue({ briefId: "brief-1" });
    prismaMock.marketingAssetTask.findUnique.mockResolvedValue({ taskId: "task-1" });
    prismaMock.marketingCampaignBrief.update.mockResolvedValue({ briefId: "brief-1" });
    prismaMock.marketingAssetTask.update.mockResolvedValue({ taskId: "task-1" });

    const result = await attachToCampaign({
      campaignId: "campaign-1",
      briefId: "brief-1",
      taskId: "task-1",
    });

    expect(result).toMatchObject({
      message: "Attached brief brief-1 and task task-1 to campaign campaign-1.",
    });
    expect(prismaMock.marketingCampaignBrief.update).toHaveBeenCalledWith({
      where: { briefId: "brief-1" },
      data: { campaignId: "campaign-1" },
    });
    expect(prismaMock.marketingAssetTask.update).toHaveBeenCalledWith({
      where: { taskId: "task-1" },
      data: { campaignId: "campaign-1" },
    });
  });
});
