import { describe, expect, it } from "vitest";

import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";
import {
  buildMarketingAutomationView,
  buildMarketingCampaignsView,
  buildMarketingFunnelView,
} from "./subroutes";

const now = new Date("2026-06-04T12:00:00.000Z");

function snapshot(
  overrides: Partial<MarketingWorkspaceSnapshot> = {},
): MarketingWorkspaceSnapshot {
  const base: MarketingWorkspaceSnapshot = {
    organization: {
      id: "org-1",
      name: "DPF Demo",
      website: "https://example.test",
      addressSummary: "Austin, TX",
    },
    storefront: {
      id: "storefront-1",
      archetypeId: "expert-services",
      archetypeName: "Expert Services",
      category: "professional-services",
      tagline: "Proof-led growth",
      description: "Operational advice",
      ctaType: "inquiry",
    },
    strategy: {
      strategyId: "strategy-1",
      status: "active",
      primaryGoal: "Generate qualified founder inquiries",
      routeToMarket: "inbound",
      localityModel: "national",
      geographicScope: "United States",
      primaryChannels: ["linkedin", "email"],
      secondaryChannels: ["content-seo"],
      differentiators: ["operational proof"],
      reviewCadence: "weekly",
      lastReviewedAt: now,
      nextReviewAt: new Date("2026-06-11T12:00:00.000Z"),
      sourceSummary: "Seeded test context",
      specialistNotes: null,
      seasonalityNotes: null,
      targetSegments: [{ name: "Founder operators", description: "Hands-on CEOs" }],
      idealCustomerProfiles: [],
      entryOffers: [],
      proofAssets: [],
      serviceTerritories: [],
      constraints: null,
    },
    latestReview: null,
    workProducts: {
      campaignBriefs: [
        {
          briefId: "brief-1",
          title: "Founder trust sequence",
          objective: "Create qualified sales conversations",
          audience: "Founder operators",
          channels: ["linkedin", "email"],
          cta: "Book a fit call",
          proofAssets: ["case study"],
          kpis: ["qualified replies"],
          notes: "Keep it founder-led.",
          status: "draft",
          createdAt: now,
        },
      ],
      assetTasks: [
        {
          taskId: "task-1",
          title: "Draft LinkedIn proof post",
          assetType: "linkedin-post",
          channel: "linkedin",
          dueWindow: "this week",
          brief: "Use the founder trust sequence.",
          status: "draft",
          createdAt: now,
        },
        {
          taskId: "task-2",
          title: "Write nurture email",
          assetType: "email",
          channel: "email",
          dueWindow: "next week",
          brief: "Follow up after the proof post.",
          status: "ready",
          createdAt: now,
        },
      ],
      kpiCheckpoints: [
        {
          checkpointId: "kpi-1",
          metric: "qualified replies",
          target: "5 per month",
          cadence: "weekly",
          notes: "Baseline after first send.",
          status: "active",
          createdAt: now,
        },
      ],
      automationCandidates: [
        {
          candidateId: "auto-1",
          title: "Reply follow-up reminder",
          trigger: "Qualified reply received",
          action: "Create CRM follow-up task",
          approvalRequired: true,
          rationale: "Protects response SLA.",
          status: "draft",
          createdAt: now,
        },
      ],
    },
    pendingDrafts: [
      {
        draftId: "draft-1",
        sourceType: "marketing-asset-task",
        sourceId: "task-1",
        assetTaskTitle: "Draft LinkedIn proof post",
        channelId: "linkedin",
        assetType: "linkedin-post",
        status: "pending-review",
        body: "Post body",
        bodyFormat: "markdown",
        createdByAgentId: "AGT-WS-MARKETING",
        createdAt: now,
      },
    ],
    approvedDrafts: [],
    connectedChannels: ["linkedin-personal-social"],
    inboundMessages: [],
    staleAreas: [],
  };

  return { ...base, ...overrides };
}

describe("marketing subroute view models", () => {
  it("builds campaign rows with asset task and draft posture", () => {
    const view = buildMarketingCampaignsView(snapshot());

    expect(view.metrics).toEqual([
      { label: "Campaign briefs", value: "1", hint: "1 active work plan", intent: "accent" },
      { label: "Asset tasks", value: "2", hint: "1 waiting for review", intent: "info" },
      { label: "Ready to publish", value: "0", hint: "approval-gated", intent: "success" },
    ]);
    expect(view.campaigns[0]).toMatchObject({
      title: "Founder trust sequence",
      channelsLabel: "LinkedIn, Email",
      taskCount: 2,
      pendingDraftCount: 1,
      nextWorkLabel: "1 draft waiting for review",
    });
    expect(view.assetTasks[0]).toMatchObject({
      title: "Draft LinkedIn proof post",
      draftStatusLabel: "Pending review",
    });
  });

  it("aggregates funnel evidence without overstating attribution", () => {
    const view = buildMarketingFunnelView(snapshot(), {
      engagements: [
        { source: "storefront", status: "new", count: 3 },
        { source: "facebook-lead-ads", status: "qualified", count: 2 },
      ],
      opportunities: [
        { source: "storefront", stage: "qualification", expectedValue: 5000 },
        { source: "storefront", stage: "closed_won", expectedValue: 7000 },
        { source: null, stage: "proposal", expectedValue: 2500 },
      ],
    });

    expect(view.sourceRows[0]).toMatchObject({
      source: "Storefront",
      engagementCount: 3,
      opportunityCount: 2,
      pipelineValueLabel: "GBP 12,000",
      evidenceLabel: "Source evidence, not full attribution",
    });
    expect(view.sourceRows.map((row) => row.source)).toContain("Facebook Lead Ads");
    expect(view.stageRows.map((row) => row.stageLabel)).toEqual([
      "Qualification",
      "Proposal",
      "Won",
    ]);
  });

  it("flags campaign artifacts that leak software-platform language as imported/test data", () => {
    const leaked = snapshot({
      storefront: {
        id: "storefront-1",
        archetypeId: "restaurant",
        archetypeName: "Restaurant",
        category: "food-hospitality",
        tagline: null,
        description: null,
        ctaType: "booking",
      },
      workProducts: {
        campaignBriefs: [
          {
            briefId: "brief-leak",
            title: "Meet our technical founders",
            objective: "Show off the Build Studio AI workflow",
            audience: "SaaS buyers",
            channels: ["linkedin"],
            cta: "Book a demo",
            proofAssets: [],
            kpis: [],
            notes: null,
            status: "draft",
            createdAt: now,
          },
        ],
        assetTasks: [
          {
            taskId: "task-clean",
            title: "Draft seasonal tasting menu post",
            assetType: "email",
            channel: "email",
            dueWindow: "this week",
            brief: "Promote the autumn tasting menu and reserve-a-table CTA.",
            status: "draft",
            createdAt: now,
          },
        ],
        kpiCheckpoints: [],
        automationCandidates: [],
      },
    });

    const view = buildMarketingCampaignsView(leaked);
    expect(view.importedTestCount).toBe(1);
    expect(view.campaigns[0]!.archetypeFit.blocked).toBe(true);
    // Clean, in-archetype restaurant task must not be flagged.
    expect(view.assetTasks[0]!.archetypeFit.blocked).toBe(false);
    expect(view.assetTasks[0]!.archetypeFit.severity).toBe("ok");
  });

  it("summarizes automation approval posture", () => {
    const view = buildMarketingAutomationView(snapshot());

    expect(view.metrics[0]).toMatchObject({
      label: "Automation candidates",
      value: "1",
      intent: "warning",
    });
    expect(view.candidates[0]).toMatchObject({
      title: "Reply follow-up reminder",
      approvalLabel: "Approval required",
      safetyLabel: "Human approval before this can run",
    });
  });
});
