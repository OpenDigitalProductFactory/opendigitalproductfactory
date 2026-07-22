import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMarketingWorkspaceSnapshot } = vi.hoisted(() => ({
  getMarketingWorkspaceSnapshot: vi.fn(),
}));

vi.mock("@/lib/marketing", () => ({
  formatMarketingDate: (value: Date | string | null | undefined) =>
    value ? new Date(value).toISOString().slice(0, 10) : "No date",
  formatMarketingGap: (value: string) => `Gap: ${value}`,
  formatMarketingLabel: (value: string) =>
    value
      .split(/[-_]/g)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" "),
  getMarketingWorkspaceSnapshot,
}));

vi.mock("@/components/agent/AgentWorkLauncher", () => ({
  AgentWorkLauncher: ({
    primaryActionLabel,
    routeContext,
    topics,
  }: {
    primaryActionLabel: string;
    routeContext?: string;
    topics: Array<{ id: string; label: string; prompt: string }>;
  }) => (
    <section data-route-context={routeContext} data-testid="agent-work-launcher">
      <p>{primaryActionLabel}</p>
      {topics.map((topic) => (
        <article key={topic.id} data-topic-id={topic.id}>
          <h2>{topic.label}</h2>
          <p>{topic.prompt}</p>
        </article>
      ))}
    </section>
  ),
}));

vi.mock("@/components/customer-marketing/MarketingStrategyOverview", () => ({
  MarketingStrategyOverview: () => <section data-testid="strategy-overview" />,
}));

vi.mock("@/components/customer-marketing/ApprovalQueuePanel", () => ({
  ApprovalQueuePanel: () => <section data-testid="approval-queue" />,
}));

import CustomerMarketingPage from "./page";

const now = new Date("2026-06-06T12:00:00.000Z");

function snapshot() {
  return {
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
      nextReviewAt: new Date("2026-06-13T12:00:00.000Z"),
      sourceSummary: "Seeded test context",
      specialistNotes: null,
      seasonalityNotes: null,
      targetSegments: [{ name: "Founder operators", description: "Hands-on CEOs" }],
      idealCustomerProfiles: [],
      entryOffers: [],
      proofAssets: [{ type: "case-study", label: "Founder case study" }],
      serviceTerritories: [],
      constraints: null,
    },
    latestReview: {
      reviewType: "ad-hoc",
      summary: "Prioritize founder proof.",
      createdAt: now,
      suggestedActions: [
        { description: "Collect one proof asset before outbound work." },
      ],
      recommendation: {
        primaryChannels: ["linkedin", "email"],
        skippedChannels: ["paid-social"],
        cadence: "weekly",
        kpis: ["qualified replies"],
      },
    },
    workProducts: {
      campaignBriefs: [],
      assetTasks: [],
      kpiCheckpoints: [],
      automationCandidates: [],
    },
    pendingDrafts: [],
    approvedDrafts: [],
    connectedChannels: ["linkedin-personal-social"],
    inboundMessages: [],
    staleAreas: [],
  };
}

describe("CustomerMarketingPage", () => {
  beforeEach(() => {
    getMarketingWorkspaceSnapshot.mockResolvedValue(snapshot());
  });

  it("offers Slice 5 agentic operations topics in the marketing route context", async () => {
    const html = renderToStaticMarkup(await CustomerMarketingPage());

    expect(html).toContain('data-route-context="/customer/marketing"');
    expect(html).toContain("Start marketing review");
    expect(html).toContain('data-topic-id="signal-review"');
    expect(html).toContain('data-topic-id="campaign-brief"');
    expect(html).toContain('data-topic-id="automation-candidates"');
    expect(html).toContain('data-topic-id="integration-recommendations"');
    expect(html).toContain("save_marketing_review");
    expect(html).not.toContain('data-topic-id="strategy-review"');
    expect(html).not.toContain('data-topic-id="campaign-directions"');
    expect(html).not.toContain('data-topic-id="proof-plan"');
  });

  it("opens with a single archetype-scoped next decision in the first viewport", async () => {
    const html = renderToStaticMarkup(await CustomerMarketingPage());

    expect(html).toContain('data-testid="marketing-next-decision"');
    // Snapshot has a review + proof but no campaign brief → create the first campaign.
    expect(html).toContain('data-decision-id="create-first-campaign"');
    expect(html).toContain("Your next decision");
    // Must not leak software-platform vocabulary onto a customer marketing surface.
    expect(html).not.toContain("Build Studio");
    expect(html).not.toContain("backlog item");
  });
});
