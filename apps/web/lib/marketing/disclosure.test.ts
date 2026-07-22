// Coverage for the marketing overview's progressive-disclosure state and the
// owner-first question (BI-8AB9C904 + BI-CC580161):
//   - off-archetype / software-platform artifacts are quarantined, never counted
//     as an archetype-fit campaign or as reason to expose publish/review queues;
//   - publish/review queues are deferred until there is fit work to act on;
//   - the first-viewport question speaks the archetype's own vocabulary.

import { describe, expect, it } from "vitest";

import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import {
  buildMarketingDisclosure,
  buildMarketingOwnerQuestion,
  marketingOwnerJobs,
} from "./disclosure";

const now = new Date("2026-07-22T12:00:00.000Z");

type CampaignBriefRow = MarketingWorkspaceSnapshot["workProducts"]["campaignBriefs"][number];

const LEAK_BRIEF: CampaignBriefRow = {
  briefId: "brief-leak",
  title: "Reach technical founders with our AI workflow",
  objective: "Show how Build Studio ships software",
  audience: "technical founders",
  channels: ["linkedin"],
  cta: "Book a demo",
  proofAssets: [],
  kpis: [],
  notes: "Position the SaaS platform.",
  status: "draft" as const,
  createdAt: now,
};

const CLEAN_BRIEF: CampaignBriefRow = {
  briefId: "brief-clean",
  title: "Fill quiet midweek covers with a seasonal tasting menu",
  objective: "Lift midweek bookings",
  audience: "local diners",
  channels: ["email"],
  cta: "Reserve a table",
  proofAssets: [],
  kpis: ["Booking fill rate"],
  notes: "Feature our reviews.",
  status: "draft" as const,
  createdAt: now,
};

function restaurantSnapshot(
  overrides: Partial<MarketingWorkspaceSnapshot> = {},
): MarketingWorkspaceSnapshot {
  return {
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
      differentiators: ["Seasonal menu"],
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
      campaignBriefs: [],
      assetTasks: [],
      kpiCheckpoints: [],
      automationCandidates: [],
    },
    pendingDrafts: [],
    approvedDrafts: [],
    connectedChannels: [],
    inboundMessages: [],
    staleAreas: [],
    ...overrides,
  } as MarketingWorkspaceSnapshot;
}

describe("buildMarketingDisclosure", () => {
  it("defers publish/review and quarantines when only off-archetype artifacts exist", () => {
    const snapshot = restaurantSnapshot({
      workProducts: {
        campaignBriefs: [LEAK_BRIEF],
        assetTasks: [],
        kpiCheckpoints: [],
        automationCandidates: [],
      },
    });

    const d = buildMarketingDisclosure(snapshot);
    // A software-platform brief is NOT an archetype-fit campaign...
    expect(d.hasArchetypeFitCampaign).toBe(false);
    // ...it is quarantined...
    expect(d.quarantinedCount).toBe(1);
    // ...and it does not unlock the publish/review queues.
    expect(d.showPublishReview).toBe(false);
  });

  it("treats a clean archetype-fit brief as a campaign and unlocks the queues", () => {
    const snapshot = restaurantSnapshot({
      workProducts: {
        campaignBriefs: [LEAK_BRIEF, CLEAN_BRIEF],
        assetTasks: [],
        kpiCheckpoints: [],
        automationCandidates: [],
      },
    });

    const d = buildMarketingDisclosure(snapshot);
    expect(d.hasArchetypeFitCampaign).toBe(true);
    expect(d.quarantinedCount).toBe(1); // only the leak brief
    expect(d.showPublishReview).toBe(true);
  });

  it("opens the publish/review disclosure when drafts are waiting", () => {
    const snapshot = restaurantSnapshot({
      pendingDrafts: [
        {
          draftId: "d1",
          sourceType: "marketing-asset-task",
          sourceId: "t1",
          assetTaskTitle: "Email",
          channelId: "email",
          assetType: "email",
          status: "pending-review",
          body: "Reserve a table for our tasting menu.",
          bodyFormat: "markdown",
          createdByAgentId: "AGT",
          createdAt: now,
        },
      ],
    });

    const d = buildMarketingDisclosure(snapshot);
    expect(d.reviewableCount).toBe(1);
    expect(d.showPublishReview).toBe(true);
    expect(d.publishReviewOpenByDefault).toBe(true);
  });

  it("defers everything for a fresh workspace with no artifacts", () => {
    const d = buildMarketingDisclosure(restaurantSnapshot());
    expect(d.hasArchetypeFitCampaign).toBe(false);
    expect(d.reviewableCount).toBe(0);
    expect(d.showPublishReview).toBe(false);
    expect(d.quarantinedCount).toBe(0);
    expect(d.publishReviewOpenByDefault).toBe(false);
  });
});

describe("buildMarketingOwnerQuestion", () => {
  it("asks a restaurant owner about booking demand in food/hospitality language", () => {
    const playbook = getPlaybook("food-hospitality", "booking");
    const question = buildMarketingOwnerQuestion("food-hospitality", playbook);

    expect(question.toLowerCase()).toContain("booking demand");
    // Food/hospitality jobs, not software-founder language.
    expect(question.toLowerCase()).toMatch(/slow nights|private dining|catering|repeat guests/);
    expect(question.toLowerCase()).not.toMatch(/build studio|technical founder|ai workflow|saas/);
  });

  it("derives a sensible question for non-food archetypes from the playbook", () => {
    const playbook = getPlaybook("trades-maintenance", "quote");
    const question = buildMarketingOwnerQuestion("trades-maintenance", playbook);

    expect(question.toLowerCase()).toContain("grow first");
    expect(question).not.toContain("booking demand");
    expect(marketingOwnerJobs("trades-maintenance", playbook).length).toBeGreaterThan(0);
  });
});
