import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";

// DraftAssetButton is a client component that imports server actions; stub it so
// the overview renders as a pure tree in the source-only test environment.
vi.mock("./DraftAssetButton", () => ({
  DraftAssetButton: () => null,
}));

import { MarketingStrategyOverview } from "./MarketingStrategyOverview";

const now = new Date("2026-07-01T12:00:00.000Z");

function snapshot(
  overrides: Partial<MarketingWorkspaceSnapshot> = {},
): MarketingWorkspaceSnapshot {
  const base: MarketingWorkspaceSnapshot = {
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
      primaryGoal: "Fill covers",
      routeToMarket: "inbound",
      localityModel: "hyperlocal",
      geographicScope: "Austin, TX",
      primaryChannels: ["email"],
      secondaryChannels: [],
      differentiators: [],
      reviewCadence: "monthly",
      lastReviewedAt: now,
      nextReviewAt: now,
      sourceSummary: null,
      specialistNotes: null,
      seasonalityNotes: null,
      targetSegments: [],
      idealCustomerProfiles: [],
      entryOffers: [],
      proofAssets: [
        { type: "testimonial", label: "Five-star review of our tasting menu" },
        { type: "outcome", label: "Built with Build Studio by our technical founders" },
      ],
      serviceTerritories: [],
      constraints: null,
    },
    latestReview: null,
    workProducts: {
      campaignBriefs: [
        {
          briefId: "brief-clean",
          title: "Seasonal tasting menu launch",
          objective: "Fill quiet midweek covers",
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

describe("MarketingStrategyOverview — archetype-fit badges on /strategy", () => {
  it("badges a proof asset that leaks software-platform language, not the clean one", () => {
    const html = renderToStaticMarkup(<MarketingStrategyOverview snapshot={snapshot()} />);
    // Exactly one blocked badge — the "Build Studio / technical founders" proof asset.
    const blocked = html.match(/data-fit-severity="block"/g) ?? [];
    expect(blocked).toHaveLength(1);
    expect(html).toContain('data-testid="archetype-fit-badge"');
    // The clean, in-archetype tasting-menu review must not be badged.
    expect(html).toContain("Five-star review of our tasting menu");
  });

  it("does not badge a fully in-archetype restaurant strategy", () => {
    const clean = snapshot({
      strategy: {
        ...snapshot().strategy,
        proofAssets: [{ type: "testimonial", label: "Guests love our seasonal menu" }],
      },
    });
    const html = renderToStaticMarkup(<MarketingStrategyOverview snapshot={clean} />);
    expect(html).not.toContain('data-fit-severity="block"');
    expect(html).not.toContain('data-fit-severity="warn"');
  });
});
