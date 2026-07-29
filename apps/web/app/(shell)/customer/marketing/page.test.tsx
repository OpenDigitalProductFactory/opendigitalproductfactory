import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMarketingOperatingSnapshot, getMarketingWorkspaceSnapshot } = vi.hoisted(() => ({
  getMarketingOperatingSnapshot: vi.fn(),
  getMarketingWorkspaceSnapshot: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
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

vi.mock("@/lib/marketing/operating-snapshot", () => ({
  getMarketingOperatingSnapshot,
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

beforeEach(() => {
  getMarketingOperatingSnapshot.mockResolvedValue(null);
  getMarketingWorkspaceSnapshot.mockResolvedValue(snapshot());
});

describe("CustomerMarketingPage", () => {
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
});

const LEAK_BRIEF = {
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
};

const CLEAN_BRIEF = {
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
};

function restaurantSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    ...snapshot(),
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
      ...snapshot().strategy,
      primaryGoal: "Fill covers during quiet periods",
      proofAssets: [{ type: "testimonial", label: "Five-star reviews" }],
    },
    ...overrides,
  };
}

describe("CustomerMarketingPage — progressive disclosure (BI-8AB9C904 + BI-CC580161)", () => {
  it("opens with one restaurant owner-first question and defers strategy behind disclosure", async () => {
    getMarketingWorkspaceSnapshot.mockResolvedValue(restaurantSnapshot());
    const html = renderToStaticMarkup(await CustomerMarketingPage());

    // Exactly one owner-first question, phrased in booking language.
    expect(html).toContain('data-testid="marketing-owner-question"');
    expect(html.toLowerCase()).toContain("booking demand");

    // The strategy machinery is deferred inside a <details>, not on the first screen.
    const detailsIdx = html.indexOf('data-testid="marketing-advanced-strategy"');
    const overviewIdx = html.indexOf('data-testid="strategy-overview"');
    expect(detailsIdx).toBeGreaterThan(-1);
    expect(overviewIdx).toBeGreaterThan(detailsIdx);
  });

  it("quarantines off-archetype artifacts and defers publish/review until a fit campaign exists", async () => {
    getMarketingWorkspaceSnapshot.mockResolvedValue(
      restaurantSnapshot({
        workProducts: {
          campaignBriefs: [LEAK_BRIEF],
          assetTasks: [],
          kpiCheckpoints: [],
          automationCandidates: [],
        },
      }),
    );
    const html = renderToStaticMarkup(await CustomerMarketingPage());

    expect(html).toContain('data-testid="marketing-quarantine-banner"');
    expect(html).toContain('data-testid="marketing-publish-deferred"');
    expect(html).not.toContain('data-testid="approval-queue"');

    // No software-founder campaign copy leaks into the always-visible page shell.
    expect(html).not.toContain("Build Studio");
    expect(html).not.toContain("technical founders");
    expect(html).not.toContain("AI workflow");
  });

  it("reveals the review & publish queue once there is archetype-fit work", async () => {
    getMarketingWorkspaceSnapshot.mockResolvedValue(
      restaurantSnapshot({
        workProducts: {
          campaignBriefs: [CLEAN_BRIEF],
          assetTasks: [],
          kpiCheckpoints: [],
          automationCandidates: [],
        },
        pendingDrafts: [
          {
            draftId: "d1",
            sourceType: "marketing-asset-task",
            sourceId: "t1",
            assetTaskTitle: "Email",
            channelId: "email",
            assetType: "email",
            status: "pending-review",
            body: "Reserve a table for our seasonal tasting menu.",
            bodyFormat: "markdown",
            createdByAgentId: "AGT",
            createdAt: now,
          },
        ],
      }),
    );
    const html = renderToStaticMarkup(await CustomerMarketingPage());

    expect(html).toContain('data-testid="marketing-publish-review"');
    expect(html).toContain('data-testid="approval-queue"');
    expect(html).not.toContain('data-testid="marketing-publish-deferred"');
  });
});
