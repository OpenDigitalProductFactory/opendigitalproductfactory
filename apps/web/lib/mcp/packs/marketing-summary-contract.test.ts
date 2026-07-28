// get_marketing_summary contract coverage (BI-CEA797A1).
//
// The live gap: the summary returned storefront inbox counts, a CRM pipeline
// rollup and the archetype playbook — and nothing about campaigns. The Marketing
// Strategist therefore had no campaignId to drill into and fell back to empty
// get_campaign_plan calls. The summary must now project the canonical operating
// snapshot: campaign identities, channel readiness, evidence freshness, blockers
// and one next executable step.

import { beforeEach, describe, expect, it, vi } from "vitest";

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

const snapshotModule = vi.hoisted(() => ({
  getMarketingOperatingSnapshot: vi.fn(),
  projectOperatingSnapshotForTools: vi.fn(),
}));
vi.mock("@/lib/marketing/operating-snapshot", () => snapshotModule);

const archetypeContext = vi.hoisted(() => ({
  resolveMarketingArchetypeContext: vi.fn(),
  MARKETING_NO_STOREFRONT_MESSAGE: "No storefront configured. Set up your storefront first at /storefront/setup.",
}));
vi.mock("@/lib/marketing/archetype-context", () => archetypeContext);

const signals = vi.hoisted(() => ({ loadAcquisitionSignals: vi.fn() }));
vi.mock("@/lib/marketing/acquisition-signals", () => signals);

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { marketingOpsPack } from "./marketing-ops-pack";

const ARCHETYPE = {
  storefrontId: "sf-1",
  archetype: { archetypeId: "restaurant", name: "Restaurant", category: "food-hospitality", ctaType: "booking" },
  playbook: { keyMetrics: ["Covers"], campaignTypes: ["Midweek offer"], primaryGoal: "Fill covers", stakeholders: "diners", ctaLanguage: ["Reserve a table"] },
};

const PROJECTION = {
  organizationId: "org-1",
  campaigns: [
    {
      campaignId: "cmp-a",
      name: "Midweek covers",
      status: "active",
      nextStep: "Draft 2 asset tasks that still need content.",
    },
  ],
  channels: [{ channelId: "email-postmark", connected: true, unsupported: ["fetch-engagement"] }],
  evidence: { stale: false, staleReasons: [] },
  blockers: [],
  nextStep: { id: "produce-assets", headline: "Draft the midweek assets", campaignId: "cmp-a", href: "/customer/marketing/campaigns" },
};

beforeEach(() => {
  vi.clearAllMocks();
  archetypeContext.resolveMarketingArchetypeContext.mockResolvedValue(ARCHETYPE);
  snapshotModule.getMarketingOperatingSnapshot.mockResolvedValue({ organizationId: "org-1" });
  snapshotModule.projectOperatingSnapshotForTools.mockReturnValue(PROJECTION);
  signals.loadAcquisitionSignals.mockResolvedValue({
    inbox: { days: 30, bookings: 2, inquiries: 3, orders: 0, donations: 0, total: 5 },
    pipeline: { engagements: { open: 4 }, opportunities: { qualified: 1 } },
  });
});

describe("get_marketing_summary — campaign identities are first-class", () => {
  it("returns campaign identities with their next step", async () => {
    const res = await marketingOpsPack.handlers.get_marketing_summary!({}, "u1");
    expect(res.success).toBe(true);

    const campaigns = (res.data as { campaigns: Array<Record<string, unknown>> }).campaigns;
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]!["campaignId"]).toBe("cmp-a");
    expect(campaigns[0]!["nextStep"]).toMatch(/draft 2 asset tasks/i);
  });

  it("returns one next executable step naming the campaign it applies to", async () => {
    const res = await marketingOpsPack.handlers.get_marketing_summary!({}, "u1");
    expect(res.data!["nextStep"]).toMatchObject({ id: "produce-assets", campaignId: "cmp-a" });
  });

  it("surfaces channel readiness and evidence freshness alongside the inbox counts", async () => {
    const res = await marketingOpsPack.handlers.get_marketing_summary!({}, "u1");
    expect(res.data).toHaveProperty("channels");
    expect(res.data).toHaveProperty("evidence");
    expect(res.data).toHaveProperty("blockers");
    // Existing consumers keep their keys.
    expect(res.data).toHaveProperty("inbox");
    expect(res.data).toHaveProperty("pipeline");
    expect(res.data).toHaveProperty("playbook");
    expect(res.data).toHaveProperty("archetype");
  });

  it("degrades honestly when no storefront is configured", async () => {
    archetypeContext.resolveMarketingArchetypeContext.mockResolvedValue(null);
    const res = await marketingOpsPack.handlers.get_marketing_summary!({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toMatch(/storefront/i);
  });

  it("still answers with the archetype context when the operating snapshot is unavailable", async () => {
    snapshotModule.getMarketingOperatingSnapshot.mockResolvedValue(null);
    const res = await marketingOpsPack.handlers.get_marketing_summary!({}, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toHaveProperty("inbox");
    expect(res.data!["campaigns"]).toEqual([]);
  });

  it("tells the coworker in its description that the summary carries campaign ids", () => {
    const def = marketingOpsPack.definitions.find((d) => d.name === "get_marketing_summary");
    expect(def?.description).toMatch(/campaign/i);
  });
});
