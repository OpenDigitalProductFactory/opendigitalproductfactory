// Regression coverage for archetype-scoping of the Restaurant marketing cockpit
// across its three routes:
//   - /customer/marketing  → buildMarketingOwnerDecision (first-viewport decision)
//                             + per-draft archetype-fit (approval queue)
//   - /customer/marketing/strategy → getPlaybook + fit over strategy artifacts
//   - /customer/marketing/campaigns → buildMarketingCampaignsView (imported/test flag)
//
// BI-CC580161: saved campaign artifacts, proof prompts, draft review, and
// publish readiness must be scoped to the current organization and archetype.

import { describe, expect, it } from "vitest";

import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { assessArchetypeFit } from "./archetype-fit";
import { buildMarketingOwnerDecision } from "./next-decision";
import { buildMarketingCampaignsView } from "./subroutes";

const now = new Date("2026-07-22T12:00:00.000Z");

const LEAK_BODY =
  "Build Studio helps technical founders ship software with an AI workflow — powered by our SaaS platform.";
const CLEAN_BODY =
  "Reserve a table for our autumn tasting menu and fill quiet midweek covers. Our five-star reviews speak for themselves.";

function restaurantSnapshot(): MarketingWorkspaceSnapshot {
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
      differentiators: ["Seasonal menu", "Local sourcing"],
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
          briefId: "brief-leak",
          title: "Reach technical founders with our AI workflow",
          objective: "Show how Build Studio ships software",
          audience: "technical founders",
          channels: ["linkedin"],
          cta: "Book a demo",
          proofAssets: [],
          kpis: [],
          notes: "Position the SaaS platform.",
          status: "draft",
          createdAt: now,
        },
        {
          briefId: "brief-clean",
          title: "Fill quiet midweek covers with a seasonal tasting menu",
          objective: "Lift midweek bookings",
          audience: "local diners",
          channels: ["email"],
          cta: "Reserve a table",
          proofAssets: [],
          kpis: ["Booking fill rate"],
          notes: "Feature our reviews.",
          status: "draft",
          createdAt: now,
        },
      ],
      assetTasks: [],
      kpiCheckpoints: [],
      automationCandidates: [],
    },
    pendingDrafts: [
      {
        draftId: "draft-leak",
        sourceType: "marketing-asset-task",
        sourceId: "t-leak",
        assetTaskTitle: "LinkedIn post",
        channelId: "linkedin",
        assetType: "linkedin-post",
        status: "pending-review",
        body: LEAK_BODY,
        bodyFormat: "markdown",
        createdByAgentId: "AGT",
        createdAt: now,
      },
    ],
    approvedDrafts: [],
    connectedChannels: [],
    inboundMessages: [],
    staleAreas: [],
  };
}

describe("Restaurant marketing archetype scoping (BI-CC580161)", () => {
  it("/customer/marketing: first-viewport decision is restaurant-scoped, not DPF/software", () => {
    const snapshot = restaurantSnapshot();
    const playbook = getPlaybook(snapshot.storefront.category, snapshot.storefront.ctaType);
    const decision = buildMarketingOwnerDecision(snapshot, playbook);

    // Pending drafts exist → the one next decision is to review them.
    expect(decision.id).toBe("review-drafts");
    expect(decision.metricFocus.toLowerCase()).toMatch(/covers|booking/);
    const decisionText = `${decision.headline} ${decision.detail} ${decision.metricFocus}`.toLowerCase();
    expect(decisionText).not.toMatch(/build studio|technical founder|ai workflow|saas/);
  });

  it("/customer/marketing: approval queue blocks a platform-leak draft, passes clean copy", () => {
    const category = restaurantSnapshot().storefront.category;
    expect(assessArchetypeFit({ text: LEAK_BODY, category }).blocked).toBe(true);
    expect(assessArchetypeFit({ text: CLEAN_BODY, category }).severity).toBe("ok");
  });

  it("/strategy: playbook + strategy artifacts use food-hospitality concepts", () => {
    const snapshot = restaurantSnapshot();
    const playbook = getPlaybook(snapshot.storefront.category, snapshot.storefront.ctaType);

    // Playbook is the restaurant one — covers, bookings, no-show, reviews.
    expect(playbook.keyMetrics.join(" ").toLowerCase()).toMatch(/covers|booking fill|no-show/);
    expect(playbook.ctaLanguage.join(" ").toLowerCase()).toMatch(/reserve a table|menu/);

    // Clean strategy content passes; a platform-leak differentiator is caught.
    const cleanStrategyText = [snapshot.strategy.primaryGoal, ...snapshot.strategy.differentiators].join(" ");
    expect(assessArchetypeFit({ text: cleanStrategyText, category: snapshot.storefront.category }).severity).toBe(
      "ok",
    );
    expect(
      assessArchetypeFit({ text: "Differentiator: our AI workflow", category: snapshot.storefront.category })
        .blocked,
    ).toBe(true);
  });

  it("/campaigns: saved briefs are flagged imported/test when off-archetype, clean ones pass", () => {
    const view = buildMarketingCampaignsView(restaurantSnapshot());
    const leak = view.campaigns.find((c) => c.id === "brief-leak");
    const clean = view.campaigns.find((c) => c.id === "brief-clean");

    expect(leak?.archetypeFit.blocked).toBe(true);
    expect(clean?.archetypeFit.severity).toBe("ok");
    expect(view.importedTestCount).toBe(1);
  });
});
