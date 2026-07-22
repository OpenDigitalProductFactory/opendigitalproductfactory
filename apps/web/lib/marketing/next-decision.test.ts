import { describe, expect, it } from "vitest";

import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { buildMarketingOwnerDecision } from "./next-decision";

const restaurantPlaybook = getPlaybook("food-hospitality", "booking");

const now = new Date("2026-07-01T12:00:00.000Z");

function snapshot(overrides: {
  pending?: number;
  approved?: number;
  hasReview?: boolean;
  reviewStale?: boolean;
  briefs?: number;
  proofs?: number;
}): MarketingWorkspaceSnapshot {
  const {
    pending = 0,
    approved = 0,
    hasReview = true,
    reviewStale = false,
    briefs = 1,
    proofs = 1,
  } = overrides;

  const draft = (id: string): MarketingWorkspaceSnapshot["pendingDrafts"][number] => ({
    draftId: id,
    sourceType: "marketing-asset-task",
    sourceId: "task-1",
    assetTaskTitle: "Seasonal menu post",
    channelId: "email",
    assetType: "email",
    status: "pending-review",
    body: "Body",
    bodyFormat: "markdown",
    createdByAgentId: "AGT-WS-MARKETING",
    createdAt: now,
  });

  return {
    organization: { id: "org-1", name: "Trattoria", website: null, addressSummary: "Austin, TX" },
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
      strategyId: "strategy-1",
      status: "active",
      primaryGoal: null,
      routeToMarket: "inbound",
      localityModel: "hyperlocal",
      geographicScope: "Austin, TX",
      primaryChannels: ["email"],
      secondaryChannels: [],
      differentiators: [],
      reviewCadence: "monthly",
      lastReviewedAt: hasReview ? now : null,
      nextReviewAt: now,
      sourceSummary: null,
      specialistNotes: null,
      seasonalityNotes: null,
      targetSegments: [],
      idealCustomerProfiles: [],
      entryOffers: [],
      proofAssets: Array.from({ length: proofs }, (_, i) => ({
        type: "testimonial" as const,
        label: `Review ${i + 1}`,
      })),
      serviceTerritories: [],
      constraints: null,
    },
    latestReview: hasReview
      ? {
          reviewType: "ai-proactive",
          summary: "Fill midweek covers.",
          createdAt: now,
          suggestedActions: [],
          recommendation: null,
        }
      : null,
    workProducts: {
      campaignBriefs: Array.from({ length: briefs }, (_, i) => ({
        briefId: `brief-${i}`,
        title: "Seasonal menu",
        objective: "Fill covers",
        audience: "Diners",
        channels: ["email"] as never,
        cta: null,
        proofAssets: [],
        kpis: [],
        notes: null,
        status: "draft",
        createdAt: now,
      })),
      assetTasks: [],
      kpiCheckpoints: [],
      automationCandidates: [],
    },
    pendingDrafts: Array.from({ length: pending }, (_, i) => draft(`d-${i}`)),
    approvedDrafts: Array.from({ length: approved }, (_, i) => ({
      ...draft(`a-${i}`),
      status: "approved" as const,
    })),
    connectedChannels: [],
    inboundMessages: [],
    staleAreas: reviewStale ? ["Strategy review cadence is overdue"] : [],
  };
}

describe("buildMarketingOwnerDecision — single restaurant-owner next decision", () => {
  it("prioritizes reviewing pending drafts, phrased for diners", () => {
    const decision = buildMarketingOwnerDecision(snapshot({ pending: 2 }), restaurantPlaybook);
    expect(decision.id).toBe("review-drafts");
    expect(decision.headline).toContain("diners");
    expect(decision.metricFocus).toBe("Covers per service (lunch vs dinner)");
  });

  it("falls through to publishing approved copy when nothing is pending", () => {
    const decision = buildMarketingOwnerDecision(snapshot({ approved: 1 }), restaurantPlaybook);
    expect(decision.id).toBe("publish-approved");
    expect(decision.ctaHref).toContain("marketing-publish-queue");
  });

  it("asks to run the first review when none exists", () => {
    const decision = buildMarketingOwnerDecision(
      snapshot({ hasReview: false }),
      restaurantPlaybook,
    );
    expect(decision.id).toBe("run-first-review");
    expect(decision.detail.toLowerCase()).toContain("fill covers");
  });

  it("routes to the first campaign using a food-hospitality campaign type", () => {
    const decision = buildMarketingOwnerDecision(snapshot({ briefs: 0 }), restaurantPlaybook);
    expect(decision.id).toBe("create-first-campaign");
    expect(decision.headline).toContain("Seasonal menu launches");
  });

  it("asks to choose restaurant proof (reviews) when none is featured", () => {
    const decision = buildMarketingOwnerDecision(snapshot({ proofs: 0 }), restaurantPlaybook);
    expect(decision.id).toBe("choose-proof");
    expect(decision.headline.toLowerCase()).toContain("reviews");
  });

  it("plans the next seasonal push in steady state", () => {
    const decision = buildMarketingOwnerDecision(snapshot({}), restaurantPlaybook);
    expect(decision.id).toBe("plan-seasonal");
    expect(decision.headline).toContain("Seasonal menu launches");
  });

  it("never leaks software-platform vocabulary into the headline", () => {
    for (const scenario of [
      snapshot({ pending: 1 }),
      snapshot({ approved: 1 }),
      snapshot({ hasReview: false }),
      snapshot({ briefs: 0 }),
      snapshot({ proofs: 0 }),
      snapshot({}),
    ]) {
      const decision = buildMarketingOwnerDecision(scenario, restaurantPlaybook);
      const text = `${decision.headline} ${decision.detail}`.toLowerCase();
      expect(text).not.toContain("build studio");
      expect(text).not.toContain("agentic");
      expect(text).not.toContain("backlog");
    }
  });
});
