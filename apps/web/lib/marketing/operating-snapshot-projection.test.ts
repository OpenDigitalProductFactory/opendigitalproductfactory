// MCP/UI projection parity for the marketing operating snapshot (BI-CEA797A1).
//
// Acceptance requires the coworker tool output and the owner surface to report
// the SAME state for the same organization. Before this, the owner page derived
// its first-viewport decision from saved campaign BRIEFS while the MCP tools
// reported storefront inbox counts — two partial truths that could disagree
// about whether a campaign even existed. Both now read one projection.

import { describe, expect, it } from "vitest";

import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { buildMarketingOwnerDecision } from "./next-decision";
import {
  MARKETING_NEXT_STEP_IDS,
  projectOperatingSnapshotForTools,
  type MarketingNextStep,
  type MarketingNextStepId,
  type MarketingOperatingSnapshot,
} from "./operating-snapshot";

const NOW = new Date("2026-07-28T12:00:00.000Z");

function workspaceSnapshot(): MarketingWorkspaceSnapshot {
  return {
    organization: { id: "org-1", name: "The Copper Table", website: null, addressSummary: "Leeds" },
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
      primaryGoal: "Fill covers during quiet periods",
      routeToMarket: "inbound",
      localityModel: "hyperlocal",
      geographicScope: "Leeds",
      primaryChannels: ["email"],
      secondaryChannels: [],
      differentiators: ["Seasonal menu"],
      reviewCadence: "monthly",
      lastReviewedAt: NOW,
      nextReviewAt: new Date("2026-08-28T12:00:00.000Z"),
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
      createdAt: NOW,
      suggestedActions: [],
      recommendation: null,
    },
    workProducts: { campaignBriefs: [], assetTasks: [], kpiCheckpoints: [], automationCandidates: [] },
    pendingDrafts: [],
    approvedDrafts: [],
    connectedChannels: ["postmark"],
    inboundMessages: [],
    staleAreas: [],
  };
}

function operatingSnapshot(nextStep: MarketingNextStep): MarketingOperatingSnapshot {
  return {
    organizationId: "org-1",
    organizationName: "The Copper Table",
    archetype: { archetypeId: "restaurant", name: "Restaurant", category: "food-hospitality", ctaType: "booking" },
    strategy: {
      strategyId: "st-1",
      status: "active",
      primaryChannels: ["email"],
      lastReviewedAt: NOW,
      nextReviewAt: new Date("2026-08-28T12:00:00.000Z"),
      hasReview: true,
      stale: false,
      staleAreas: [],
    },
    campaigns: [],
    workProducts: { campaignBriefs: 0, assetTasks: 0, kpiCheckpoints: 0, automationCandidates: 0 },
    approvals: { pendingDrafts: 0, approvedDrafts: 0, scheduledActionsPending: 0, scheduledActionsFailed: 0 },
    channels: [],
    evidence: {
      lastPublishedAt: null,
      lastMetricsPolledAt: null,
      lastKpiCheckpointAt: null,
      lastStrategyReviewAt: NOW,
      stale: false,
      staleReasons: [],
    },
    blockers: [],
    nextStep,
  };
}

function step(id: MarketingNextStepId, campaignId: string | null = null): MarketingNextStep {
  return {
    id,
    headline: `headline for ${id}`,
    detail: `detail for ${id}`,
    campaignId,
    href: `/customer/marketing#${id}`,
  };
}

describe("projectOperatingSnapshotForTools", () => {
  it("carries campaign identities so the coworker never has to guess a campaignId", () => {
    const snapshot = operatingSnapshot(step("produce-assets", "cmp-a"));
    snapshot.campaigns = [
      {
        campaignId: "cmp-a",
        name: "Midweek covers",
        objective: "Lift midweek bookings",
        status: "active",
        channels: ["email"],
        startDate: null,
        endDate: null,
        execution: {
          briefCount: 1,
          taskCount: 2,
          draftedCount: 0,
          approvedCount: 0,
          undraftedCount: 2,
          nextStep: "Draft 2 asset tasks that still need content.",
        },
        measurement: {
          publications: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          spendCents: 0,
          lastPublishedAt: null,
          lastMetricsPolledAt: null,
          attributionConfidence: "none",
        },
      },
    ];

    const projected = projectOperatingSnapshotForTools(snapshot);
    const campaigns = projected["campaigns"] as Array<Record<string, unknown>>;

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]!["campaignId"]).toBe("cmp-a");
    expect(campaigns[0]!["nextStep"]).toMatch(/draft 2 asset tasks/i);
    expect(projected["nextStep"]).toMatchObject({ id: "produce-assets", campaignId: "cmp-a" });
  });

  it("reports an empty campaign list as an explicit state, not a missing key", () => {
    const projected = projectOperatingSnapshotForTools(operatingSnapshot(step("establish-campaign")));
    expect(projected["campaigns"]).toEqual([]);
    expect(projected).toHaveProperty("blockers");
    expect(projected).toHaveProperty("evidence");
    expect(projected).toHaveProperty("channels");
  });
});

describe("owner decision and tool projection agree", () => {
  it("maps every next-step id to exactly one owner decision pointing at the same place", () => {
    const ws = workspaceSnapshot();
    const playbook = getPlaybook(ws.storefront.category, ws.storefront.ctaType);

    for (const id of MARKETING_NEXT_STEP_IDS) {
      const operating = operatingSnapshot(step(id, "cmp-a"));
      const decision = buildMarketingOwnerDecision(ws, playbook, operating);

      expect(decision.ctaHref).toBe(operating.nextStep.href);
      expect(decision.headline.length).toBeGreaterThan(0);
      expect(decision.metricFocus.length).toBeGreaterThan(0);
    }
  });

  it("keeps the archetype voice — the owner sees covers/bookings, never platform language", () => {
    const ws = workspaceSnapshot();
    const playbook = getPlaybook(ws.storefront.category, ws.storefront.ctaType);
    const decision = buildMarketingOwnerDecision(ws, playbook, operatingSnapshot(step("measure-evidence", "cmp-a")));

    expect(decision.metricFocus.toLowerCase()).toMatch(/covers|booking/);
    expect(`${decision.headline} ${decision.detail}`.toLowerCase()).not.toMatch(
      /build studio|saas|campaignid|projection/,
    );
  });

  it("still resolves a decision when no operating snapshot is supplied (existing callers)", () => {
    const ws = workspaceSnapshot();
    const playbook = getPlaybook(ws.storefront.category, ws.storefront.ctaType);
    expect(buildMarketingOwnerDecision(ws, playbook).id).toBeTruthy();
  });
});
