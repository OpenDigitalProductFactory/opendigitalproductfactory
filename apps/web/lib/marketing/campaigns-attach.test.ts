import { beforeEach, describe, expect, it, vi } from "vitest";

// attachToCampaign resolves every target inside the configured organization
// (BI-CEA797A1) — the lookups are findFirst with an organizationId predicate,
// not a bare findUnique by id.
const prismaMock = vi.hoisted(() => ({
  organization: {
    findFirst: vi.fn(),
  },
  marketingCampaign: {
    findFirst: vi.fn(),
  },
  marketingCampaignBrief: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  marketingAssetTask: {
    findFirst: vi.fn(),
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
    prismaMock.organization.findFirst.mockResolvedValue({ id: "org-1" });
  });

  it("explains when the caller passes a briefId as campaignId", async () => {
    prismaMock.marketingCampaign.findFirst.mockResolvedValue(null);
    prismaMock.marketingCampaignBrief.findFirst.mockResolvedValue({
      briefId: "brief-1",
      campaignId: null,
    });
    prismaMock.marketingAssetTask.findFirst.mockResolvedValue(null);

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
    prismaMock.marketingCampaign.findFirst.mockResolvedValue({ campaignId: "campaign-1" });
    prismaMock.marketingAssetTask.findFirst.mockResolvedValue(null);

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
    prismaMock.marketingCampaign.findFirst.mockResolvedValue({ campaignId: "campaign-1" });
    prismaMock.marketingCampaignBrief.findFirst.mockResolvedValue({ briefId: "brief-1" });
    prismaMock.marketingAssetTask.findFirst.mockResolvedValue({ taskId: "task-1" });
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

  it("scopes every target lookup to the resolved organization", async () => {
    prismaMock.marketingCampaign.findFirst.mockResolvedValue({ campaignId: "campaign-1" });
    prismaMock.marketingAssetTask.findFirst.mockResolvedValue({ taskId: "task-1" });
    prismaMock.marketingAssetTask.update.mockResolvedValue({ taskId: "task-1" });

    await attachToCampaign({ campaignId: "campaign-1", taskId: "task-1" });

    expect(prismaMock.marketingCampaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: "campaign-1", organizationId: "org-1" }),
      }),
    );
    expect(prismaMock.marketingAssetTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ taskId: "task-1", organizationId: "org-1" }),
      }),
    );
  });

  it("refuses to attach when no organization workspace is configured", async () => {
    prismaMock.organization.findFirst.mockResolvedValue(null);

    const result = await attachToCampaign({ campaignId: "campaign-1", taskId: "task-1" });

    expect(result).toMatchObject({ error: "no-workspace" });
    expect(prismaMock.marketingAssetTask.update).not.toHaveBeenCalled();
  });
});
