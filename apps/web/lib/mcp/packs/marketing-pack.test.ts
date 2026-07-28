// Campaign tool-contract coverage for the marketing pack (BI-CEA797A1).
//
// The production failure this pins: repeated get_campaign_plan /
// get_campaign_performance calls with empty arguments, each answered with an
// opaque "Campaign  does not exist." The handlers must now forward the
// structured recovery payload (candidate campaign IDs + one instruction) so the
// coworker can self-correct instead of retrying blind.

import { beforeEach, describe, expect, it, vi } from "vitest";

const campaigns = vi.hoisted(() => ({
  createMarketingCampaign: vi.fn(),
  updateMarketingCampaign: vi.fn(),
  attachToCampaign: vi.fn(),
  getCampaignPlan: vi.fn(),
}));
vi.mock("@/lib/marketing/campaigns", () => campaigns);

const performance = vi.hoisted(() => ({ getCampaignPerformance: vi.fn() }));
vi.mock("@/lib/marketing/campaign-performance", () => performance);

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { marketingPack } from "./marketing-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const RECOVERY = {
  error: "campaign-id-required" as const,
  message: "get_campaign_plan needs a campaignId. Open campaigns: cmp-a (Midweek covers).",
  data: {
    candidates: [{ campaignId: "cmp-a", name: "Midweek covers", status: "active", nextStep: "Draft 2 asset tasks." }],
    recovery: "Re-call get_campaign_plan with campaignId set to one of the listed ids.",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("marketing pack — registration invariants", () => {
  it("definitions and handlers stay in lockstep", () => {
    expect(Object.keys(marketingPack.handlers).sort()).toEqual(
      marketingPack.definitions.map((d) => d.name).sort(),
    );
    expect(Object.keys(marketingPack.grants).sort()).toEqual(
      marketingPack.definitions.map((d) => d.name).sort(),
    );
  });

  it("read tools require marketing_read and write tools require marketing_write", () => {
    for (const def of marketingPack.definitions) {
      const expected = def.sideEffect ? "marketing_write" : "marketing_read";
      expect(marketingPack.grants[def.name]).toEqual([expected]);
      expect(isToolAllowedByGrants(def.name, [expected])).toBe(true);
    }
  });

  it("descriptions stay provenance-free", () => {
    for (const def of marketingPack.definitions) {
      expect(def.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("campaign drill-in descriptions tell the caller how to obtain a campaignId", () => {
    for (const name of ["get_campaign_plan", "get_campaign_performance"]) {
      const def = marketingPack.definitions.find((d) => d.name === name);
      expect(def?.description).toMatch(/get_marketing_summary/);
    }
  });
});

describe("get_campaign_plan — actionable empty drill-in", () => {
  it("forwards the structured recovery payload instead of dropping it", async () => {
    campaigns.getCampaignPlan.mockResolvedValue(RECOVERY);
    const res = await marketingPack.handlers.get_campaign_plan!({}, "u1");

    expect(res.success).toBe(false);
    expect(res.error).toBe("campaign-id-required");
    expect(res.data).toBeDefined();
    expect((res.data as { candidates: Array<{ campaignId: string }> }).candidates[0]!.campaignId).toBe("cmp-a");
    expect((res.data as { recovery: string }).recovery).toMatch(/campaignId/);
  });

  it("passes a blank campaignId straight through so the service can classify it", async () => {
    campaigns.getCampaignPlan.mockResolvedValue(RECOVERY);
    await marketingPack.handlers.get_campaign_plan!({ campaignId: "   " }, "u1");
    expect(campaigns.getCampaignPlan).toHaveBeenCalledWith("   ");
  });

  it("returns the plan unchanged on success", async () => {
    campaigns.getCampaignPlan.mockResolvedValue({ message: "ok", data: { campaign: { campaignId: "cmp-a" } } });
    const res = await marketingPack.handlers.get_campaign_plan!({ campaignId: "cmp-a" }, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ campaign: { campaignId: "cmp-a" } });
  });
});

describe("get_campaign_performance — actionable empty drill-in", () => {
  it("forwards the structured recovery payload", async () => {
    performance.getCampaignPerformance.mockResolvedValue({ ...RECOVERY, error: "campaign-not-found" as const });
    const res = await marketingPack.handlers.get_campaign_performance!({ campaignId: "nope" }, "u1");

    expect(res.success).toBe(false);
    expect(res.error).toBe("campaign-not-found");
    expect((res.data as { candidates: unknown[] }).candidates).toHaveLength(1);
  });
});
