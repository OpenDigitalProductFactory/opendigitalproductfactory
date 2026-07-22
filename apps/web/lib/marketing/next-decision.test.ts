import { describe, expect, it } from "vitest";

import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { buildMarketingOwnerDecision } from "./next-decision";

const now = new Date("2026-07-22T12:00:00.000Z");
const playbook = getPlaybook("food-hospitality", "booking");

function restaurantSnapshot(
  overrides: Partial<MarketingWorkspaceSnapshot> = {},
): MarketingWorkspaceSnapshot {
  const base: MarketingWorkspaceSnapshot = {
    organization: { id: "org-r", name: "The Copper Table", website: null, addressSummary: "Leeds" },
    storefront: {
      id: "sf-r",
      archetypeId: "restaurant",
      archetypeName: "Restaurant",
      category: "food-hospitality",
      tagline: "Seasonal neighbourhood dining",
      description: null,
      ctaType: "booking",
    },
    strategy: {
      strategyId: "st-r",
      status: "active",
      primaryGoal: "Fill covers during quiet periods",
      routeToMarket: "inbound",
      localityModel: "hyperlocal",
      geographicScope: "Leeds",
      primaryChannels: ["email", "instagram"],
      secondaryChannels: [],
      differentiators: [],
      reviewCadence: "monthly",
      lastReviewedAt: now,
      nextReviewAt: new Date("2026-08-22T12:00:00.000Z"),
      sourceSummary: null,
      specialistNotes: null,
      seasonalityNotes: null,
      targetSegments: [{ name: "Local diners", description: null }],
      idealCustomerProfiles: [],
      entryOffers: [],
      proofAssets: [{ type: "testimonial", label: "Five-star reviews" }],
      serviceTerritories: [],
      constraints: null,
    },
    latestReview: {
      reviewType: "ai-proactive",
      summary: "Focus on midweek covers",
      createdAt: now,
      suggestedActions: [],
      recommendation: null,
    },
    workProducts: {
      campaignBriefs: [
        {
          briefId: "b1",
          title: "Midweek covers",
          objective: "Lift quiet nights",
          audience: "Local diners",
          channels: ["email"],
          cta: "Reserve a table",
          proofAssets: [],
          kpis: [],
          notes: null,
          status: "draft",
          createdAt: now,
        },
      ],
      assetTasks: [],
      kpiCheckpoints: [],
      automationCandidates: [],
    },
    pendingDrafts: [],
    approvedDrafts: [],
    connectedChannels: [],
    inboundMessages: [],
    staleAreas: [],
  };
  return { ...base, ...overrides };
}

describe("buildMarketingOwnerDecision", () => {
  it("prioritises reviewing pending drafts, phrased for diners", () => {
    const decision = buildMarketingOwnerDecision(
      restaurantSnapshot({
        pendingDrafts: [
          {
            draftId: "d1",
            sourceType: "marketing-asset-task",
            sourceId: "t1",
            assetTaskTitle: "Post",
            channelId: "email",
            assetType: "email",
            status: "pending-review",
            body: "Reserve a table",
            bodyFormat: "markdown",
            createdByAgentId: "AGT",
            createdAt: now,
          },
        ],
      }),
      playbook,
    );
    expect(decision.id).toBe("review-drafts");
    expect(decision.headline).toContain("diners");
    expect(decision.metricFocus).toBe(playbook.keyMetrics[0]);
  });

  it("surfaces publishing when approved drafts wait", () => {
    const decision = buildMarketingOwnerDecision(
      restaurantSnapshot({
        approvedDrafts: [
          {
            draftId: "d2",
            sourceType: "marketing-asset-task",
            sourceId: "t2",
            assetTaskTitle: "Post",
            channelId: "email",
            assetType: "email",
            status: "approved",
            body: "Reserve a table",
            bodyFormat: "markdown",
            createdByAgentId: "AGT",
            createdAt: now,
          },
        ],
      }),
      playbook,
    );
    expect(decision.id).toBe("publish-approved");
  });

  it("asks for a first strategy review when none exists", () => {
    const decision = buildMarketingOwnerDecision(
      restaurantSnapshot({ latestReview: null }),
      playbook,
    );
    expect(decision.id).toBe("run-first-review");
    expect(decision.detail.toLowerCase()).toContain("covers");
  });

  it("asks to create the first campaign when strategy exists but no briefs", () => {
    const decision = buildMarketingOwnerDecision(
      restaurantSnapshot({
        workProducts: {
          campaignBriefs: [],
          assetTasks: [],
          kpiCheckpoints: [],
          automationCandidates: [],
        },
      }),
      playbook,
    );
    expect(decision.id).toBe("create-first-campaign");
    expect(decision.headline).toContain(playbook.campaignTypes[0]!);
  });

  it("asks to choose proof when none is saved", () => {
    const snap = restaurantSnapshot();
    snap.strategy.proofAssets = [];
    const decision = buildMarketingOwnerDecision(snap, playbook);
    expect(decision.id).toBe("choose-proof");
    expect(decision.headline.toLowerCase()).toContain("review");
  });

  it("falls back to planning the next seasonal push when steady-state", () => {
    const decision = buildMarketingOwnerDecision(restaurantSnapshot(), playbook);
    expect(decision.id).toBe("plan-seasonal");
  });
});
