// Red-green coverage for organization-scoped campaign drill-in (BI-CEA797A1).
//
// Two live defects are pinned here:
//   1. get_campaign_plan / get_campaign_performance resolved a campaign with a
//      bare findUnique on campaignId — a campaign belonging to another
//      organization was readable by id.
//   2. An empty campaignId produced the opaque "Campaign  does not exist.", which
//      is exactly what the Marketing Strategist hit repeatedly in production.
//      The drill-in must instead return structured candidate IDs plus one
//      recovery instruction.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  organization: { findFirst: vi.fn() },
  marketingCampaign: { findFirst: vi.fn(), findMany: vi.fn() },
  marketingCampaignBrief: { findMany: vi.fn() },
  marketingAssetTask: { findMany: vi.fn() },
  outboundDraft: { findMany: vi.fn() },
  outboundPublication: { findMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

import {
  buildCampaignDrillInRecovery,
  requireCampaignInScope,
  type CampaignCandidate,
} from "./campaigns";

const CANDIDATES: CampaignCandidate[] = [
  { campaignId: "cmp-a", name: "Midweek covers", status: "active", nextStep: "Draft 2 asset tasks." },
  { campaignId: "cmp-b", name: "Autumn tasting", status: "draft", nextStep: "Create a campaign brief." },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.organization.findFirst.mockResolvedValue({ id: "org-1" });
  db.marketingCampaign.findMany.mockResolvedValue([]);
  db.marketingCampaign.findFirst.mockResolvedValue(null);
  db.marketingCampaignBrief.findMany.mockResolvedValue([]);
  db.marketingAssetTask.findMany.mockResolvedValue([]);
  db.outboundDraft.findMany.mockResolvedValue([]);
});

describe("buildCampaignDrillInRecovery — actionable, never opaque", () => {
  it("an omitted campaignId returns candidate IDs and one recovery instruction", () => {
    const failure = buildCampaignDrillInRecovery({
      requestedCampaignId: "",
      candidates: CANDIDATES,
      toolName: "get_campaign_plan",
    });
    expect(failure.error).toBe("campaign-id-required");
    expect(failure.data.candidates.map((c) => c.campaignId)).toEqual(["cmp-a", "cmp-b"]);
    expect(failure.data.recovery).toMatch(/campaignId/);
    // The message itself must carry an id the caller can act on immediately.
    expect(failure.message).toContain("cmp-a");
  });

  it("a whitespace-only campaignId is treated as omitted, not as a lookup miss", () => {
    const failure = buildCampaignDrillInRecovery({
      requestedCampaignId: "   ",
      candidates: CANDIDATES,
      toolName: "get_campaign_performance",
    });
    expect(failure.error).toBe("campaign-id-required");
  });

  it("an omitted campaignId with no campaigns at all points at campaign creation", () => {
    const failure = buildCampaignDrillInRecovery({
      requestedCampaignId: "",
      candidates: [],
      toolName: "get_campaign_plan",
    });
    expect(failure.error).toBe("campaign-id-required");
    expect(failure.data.candidates).toEqual([]);
    expect(failure.data.recovery).toMatch(/create_marketing_campaign/);
  });

  it("an unknown campaignId is reported as not-found and still lists the real ones", () => {
    const failure = buildCampaignDrillInRecovery({
      requestedCampaignId: "cmp-does-not-exist",
      candidates: CANDIDATES,
      toolName: "get_campaign_plan",
    });
    expect(failure.error).toBe("campaign-not-found");
    expect(failure.message).toContain("cmp-does-not-exist");
    expect(failure.data.candidates).toHaveLength(2);
  });

  it("never echoes a brief or task id back as if it were a campaign candidate", () => {
    const failure = buildCampaignDrillInRecovery({
      requestedCampaignId: "brief-123",
      candidates: CANDIDATES,
      toolName: "get_campaign_plan",
    });
    expect(failure.data.candidates.every((c) => c.campaignId.startsWith("cmp-"))).toBe(true);
  });
});

describe("requireCampaignInScope — organization isolation", () => {
  it("resolves a campaign that belongs to the resolved organization", async () => {
    db.marketingCampaign.findFirst.mockResolvedValue({ campaignId: "cmp-a" });
    const result = await requireCampaignInScope("cmp-a", "get_campaign_plan");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.organizationId).toBe("org-1");

    // The scoping predicate must be in the query, not applied after the fact.
    expect(db.marketingCampaign.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: "cmp-a", organizationId: "org-1" }),
      }),
    );
  });

  it("refuses a campaign owned by another organization without leaking that it exists", async () => {
    // The row exists globally but not within org-1, so the scoped query misses.
    db.marketingCampaign.findFirst.mockResolvedValue(null);
    db.marketingCampaign.findMany.mockResolvedValue([
      { campaignId: "cmp-a", name: "Midweek covers", status: "active" },
    ]);

    const result = await requireCampaignInScope("cmp-other-org", "get_campaign_plan");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.error).toBe("campaign-not-found");
      // Candidates are drawn from THIS org only.
      expect(result.failure.data.candidates.map((c) => c.campaignId)).toEqual(["cmp-a"]);
    }
    expect(db.marketingCampaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }),
    );
  });

  it("returns the structured recovery for an empty campaignId without querying by id", async () => {
    db.marketingCampaign.findMany.mockResolvedValue([
      { campaignId: "cmp-a", name: "Midweek covers", status: "active" },
    ]);
    const result = await requireCampaignInScope("", "get_campaign_performance");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.error).toBe("campaign-id-required");
    expect(db.marketingCampaign.findFirst).not.toHaveBeenCalled();
  });

  it("reports no-workspace when no organization is configured", async () => {
    db.organization.findFirst.mockResolvedValue(null);
    const result = await requireCampaignInScope("cmp-a", "get_campaign_plan");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.error).toBe("no-workspace");
  });
});
