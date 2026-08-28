import { beforeEach, describe, expect, it, vi } from "vitest";

// Underlying marketing services the pack handlers delegate to. Mock at the
// module boundary so the delegation-behavior tests assert the handler calls the
// service without touching the DB.
const marketing = vi.hoisted(() => ({
  recordMarketingStrategistReview: vi.fn(),
  createMarketingCampaignBrief: vi.fn(),
  createMarketingAssetTask: vi.fn(),
  createMarketingAutomationCandidate: vi.fn(),
  recordMarketingKpiCheckpoint: vi.fn(),
  MARKETING_CHANNELS: ["email", "linkedin"] as const,
  MARKETING_REVIEW_CADENCE: ["weekly", "monthly"] as const,
}));
vi.mock("@/lib/marketing", () => marketing);

const publish = vi.hoisted(() => ({ publishApprovedDraft: vi.fn() }));
vi.mock("@/lib/marketing/publish", () => publish);

// prisma is imported at module scope by the pack; stub it so importing the pack
// module does not require a live client.
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { marketingOpsPack } from "./marketing-ops-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "get_marketing_summary",
  "suggest_campaign_ideas",
  "save_marketing_review",
  "create_marketing_campaign_brief",
  "create_marketing_asset_task",
  "publish_to_linkedin",
  "send_marketing_email",
  "place_linkedin_ad",
  "refresh_channel_kpis",
  "tick_marketing_scheduler",
  "plan_upcoming_marketing_drafts",
  "set_marketing_autopilot_policy",
  "draft_marketing_asset",
  "record_marketing_kpi_checkpoint",
  "create_marketing_automation_candidate",
  "analyze_seo_opportunity",
  "record_marketing_grounding",
];

const READ_TOOLS = ["get_marketing_summary", "suggest_campaign_ideas", "analyze_seo_opportunity"];
const WRITE_TOOLS = EXPECTED_TOOLS.filter((t) => !READ_TOOLS.includes(t));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("marketing-ops pack — registration", () => {
  it("exposes exactly the seventeen marketing-ops tools in definitions and handlers", () => {
    expect(marketingOpsPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(marketingOpsPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(marketingOpsPack.packId).toBe("marketing-ops");
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of marketingOpsPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: read tools need marketing_read, mutating tools need marketing_write", () => {
    for (const t of READ_TOOLS) {
      expect(marketingOpsPack.grants[t]).toEqual(["marketing_read"]);
      expect(isToolAllowedByGrants(t, ["marketing_read"])).toBe(true);
    }
    for (const t of WRITE_TOOLS) {
      expect(marketingOpsPack.grants[t]).toEqual(["marketing_write"]);
      expect(isToolAllowedByGrants(t, ["marketing_write"])).toBe(true);
    }
  });
});

describe("marketing-ops pack — handler behavior (delegation preserved)", () => {
  it("save_marketing_review delegates to recordMarketingStrategistReview with the acting agent id", async () => {
    marketing.recordMarketingStrategistReview.mockResolvedValue({ reviewId: "R1", message: "Saved" });
    const res = await marketingOpsPack.handlers.save_marketing_review(
      { summary: "Focus on LinkedIn" },
      "u1",
      { agentId: "agent-7" },
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("R1");
    expect(marketing.recordMarketingStrategistReview).toHaveBeenCalledOnce();
    expect(marketing.recordMarketingStrategistReview.mock.calls[0][0]).toMatchObject({
      createdByAgentId: "agent-7",
    });
  });

  it("publish_to_linkedin / send_marketing_email / place_linkedin_ad share one handler over publishApprovedDraft", async () => {
    publish.publishApprovedDraft.mockResolvedValue({ ok: true, publicationId: "P1", message: "Published" });
    for (const tool of ["publish_to_linkedin", "send_marketing_email", "place_linkedin_ad"]) {
      publish.publishApprovedDraft.mockClear();
      const res = await marketingOpsPack.handlers[tool]({ draftId: "D1" }, "u1");
      expect(res.success).toBe(true);
      expect(res.entityId).toBe("P1");
      expect(publish.publishApprovedDraft).toHaveBeenCalledWith({ draftId: "D1", publishedByUserId: "u1" });
    }
  });

  it("create_marketing_asset_task returns a workspace error when the service reports no org", async () => {
    marketing.createMarketingAssetTask.mockResolvedValue(null);
    const res = await marketingOpsPack.handlers.create_marketing_asset_task(
      { title: "FAQ", assetType: "FAQ" },
      "u1",
      { agentId: "agent-1" },
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("No organization workspace is configured");
    expect(marketing.createMarketingAssetTask).toHaveBeenCalledOnce();
  });
});
