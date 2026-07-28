// Regression: the operating snapshot must not load a second workspace snapshot
// when the caller already has one (BI-CEA797A1).
//
// getMarketingWorkspaceSnapshot() UPSERTS the MarketingStrategy row. The
// /customer/marketing page originally loaded the workspace snapshot and the
// operating snapshot concurrently in a Promise.all, and the operating snapshot
// loaded its own workspace snapshot internally — so two upserts raced on the
// organizationId unique key against a freshly-seeded database and one lost.
// That rendered HTTP 500 on /customer/marketing, and under a 2-worker crawl it
// also knocked over the neighbouring /customer/marketing/automation request,
// which shares the same upsert but none of this code.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";

const marketing = vi.hoisted(() => ({ getMarketingWorkspaceSnapshot: vi.fn() }));
vi.mock("../marketing", () => marketing);

const archetypeContext = vi.hoisted(() => ({ resolveMarketingArchetypeContext: vi.fn() }));
vi.mock("./archetype-context", () => archetypeContext);

const performance = vi.hoisted(() => ({
  loadPublicationMetricsForTasks: vi.fn(),
  metricRowFromSnapshot: vi.fn(),
}));
vi.mock("./campaign-performance", () => performance);

const registry = vi.hoisted(() => ({ listAdapters: vi.fn() }));
vi.mock("./channels/registry", () => registry);

const db = vi.hoisted(() => ({
  marketingCampaign: { findMany: vi.fn() },
  scheduledOutboundAction: { groupBy: vi.fn() },
  marketingKpiCheckpoint: { findFirst: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

import { getMarketingOperatingSnapshot } from "./operating-snapshot";

function workspace(): MarketingWorkspaceSnapshot {
  return {
    organization: { id: "org-1", name: "The Copper Table", website: null, addressSummary: null },
    storefront: {
      id: "sf-1",
      archetypeId: "restaurant",
      archetypeName: "Restaurant",
      category: "food-hospitality",
      tagline: null,
      description: null,
      ctaType: "booking",
    },
    strategy: {
      strategyId: "st-1",
      status: "active",
      primaryGoal: null,
      routeToMarket: "inbound",
      localityModel: "hyperlocal",
      geographicScope: null,
      primaryChannels: ["email"],
      secondaryChannels: [],
      differentiators: [],
      reviewCadence: "monthly",
      lastReviewedAt: null,
      nextReviewAt: null,
      sourceSummary: null,
      specialistNotes: null,
      seasonalityNotes: null,
      targetSegments: [],
      idealCustomerProfiles: [],
      entryOffers: [],
      proofAssets: [],
      serviceTerritories: [],
      constraints: null,
    },
    latestReview: null,
    workProducts: { campaignBriefs: [], assetTasks: [], kpiCheckpoints: [], automationCandidates: [] },
    pendingDrafts: [],
    approvedDrafts: [],
    connectedChannels: [],
    inboundMessages: [],
    staleAreas: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  archetypeContext.resolveMarketingArchetypeContext.mockResolvedValue(null);
  registry.listAdapters.mockReturnValue([]);
  db.marketingCampaign.findMany.mockResolvedValue([]);
  db.scheduledOutboundAction.groupBy.mockResolvedValue([]);
  db.marketingKpiCheckpoint.findFirst.mockResolvedValue(null);
  performance.loadPublicationMetricsForTasks.mockResolvedValue({
    byTask: new Map(),
    draftedTaskIds: new Set(),
    approvedTaskIds: new Set(),
    lastPublishedAt: null,
    lastPolledAt: null,
  });
});

describe("getMarketingOperatingSnapshot — workspace snapshot is loaded at most once", () => {
  it("does NOT load its own workspace snapshot when the caller supplies one", async () => {
    const snapshot = await getMarketingOperatingSnapshot({ workspace: workspace() });

    expect(marketing.getMarketingWorkspaceSnapshot).not.toHaveBeenCalled();
    expect(snapshot?.organizationId).toBe("org-1");
  });

  it("honours an explicitly-null supplied workspace without falling back to a load", async () => {
    const snapshot = await getMarketingOperatingSnapshot({ workspace: null });

    expect(snapshot).toBeNull();
    expect(marketing.getMarketingWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it("loads exactly one workspace snapshot when the caller supplies none", async () => {
    marketing.getMarketingWorkspaceSnapshot.mockResolvedValue(workspace());

    await getMarketingOperatingSnapshot();

    expect(marketing.getMarketingWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  });

  it("still loads one when other options are passed but workspace is omitted", async () => {
    marketing.getMarketingWorkspaceSnapshot.mockResolvedValue(workspace());

    await getMarketingOperatingSnapshot({ metricsWindowHours: 72 });

    expect(marketing.getMarketingWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  });

  it("returns null without querying campaigns when there is no workspace at all", async () => {
    marketing.getMarketingWorkspaceSnapshot.mockResolvedValue(null);

    expect(await getMarketingOperatingSnapshot()).toBeNull();
    expect(db.marketingCampaign.findMany).not.toHaveBeenCalled();
  });

  it("scopes campaigns, scheduled actions and checkpoints to the resolved organization", async () => {
    await getMarketingOperatingSnapshot({ workspace: workspace() });

    for (const call of [
      db.marketingCampaign.findMany,
      db.scheduledOutboundAction.groupBy,
      db.marketingKpiCheckpoint.findFirst,
    ]) {
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }),
      );
    }
  });
});
