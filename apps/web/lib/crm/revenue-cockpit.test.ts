import { describe, expect, it } from "vitest";
import { buildRevenueCockpitSummary, formatRevenueAmount } from "./revenue-cockpit";

describe("revenue cockpit summary", () => {
  it("formats revenue in GBP by default (matches Opportunity.currency default)", () => {
    expect(formatRevenueAmount(12500)).toBe("£12,500");
  });

  it("respects a passed currency code", () => {
    expect(formatRevenueAmount(12500, "USD")).toBe("$12,500");
    expect(formatRevenueAmount(12500, "EUR")).toBe("€12,500");
  });

  it("summarizes pipeline, engagements, quotes, and active orders", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [
        { status: "new", count: 3 },
        { status: "contacted", count: 2 },
      ],
      opportunityCounts: [
        { stage: "qualification", count: 2, expectedValue: 1000 },
        { stage: "proposal", count: 1, expectedValue: 5000 },
        { stage: "closed_won", count: 1, expectedValue: 7500 },
      ],
      quoteCounts: [
        { status: "draft", count: 2 },
        { status: "sent", count: 1 },
      ],
      orderCounts: [
        { status: "confirmed", count: 1 },
        { status: "in_progress", count: 2 },
        { status: "fulfilled", count: 5 },
      ],
      staleOpportunityCount: 0,
      marketingWork: {
        campaignBriefsOpen: 0,
        assetTasksOpen: 0,
        automationCandidatesOpen: 0,
      },
    });

    expect(summary.metrics).toEqual([
      {
        id: "engagements",
        label: "Engagements",
        value: "5",
        detail: "3 new",
        href: "/customer/engagements",
        tone: "attention",
      },
      {
        id: "pipeline",
        label: "Pipeline",
        value: "3",
        detail: "£6,000 open",
        href: "/customer/opportunities",
        tone: "accent",
      },
      {
        id: "quotes",
        label: "Quotes",
        value: "3",
        detail: "1 sent",
        href: "/customer/quotes",
        tone: "info",
      },
      {
        id: "orders",
        label: "Orders",
        value: "3",
        detail: "active",
        href: "/customer/sales-orders",
        tone: "success",
      },
    ]);
    expect(summary.attentionItems).toEqual([]);
  });

  it("surfaces stale opportunities and marketing work as attention items", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [],
      opportunityCounts: [],
      quoteCounts: [],
      orderCounts: [],
      staleOpportunityCount: 2,
      marketingWork: {
        campaignBriefsOpen: 1,
        assetTasksOpen: 3,
        automationCandidatesOpen: 1,
      },
    });

    expect(summary.attentionItems).toEqual([
      {
        id: "stale-opportunities",
        label: "2 stale opportunities need a next action",
        href: "/customer/opportunities",
        tone: "warning",
      },
      {
        id: "marketing-work",
        label: "5 marketing work products are waiting",
        href: "/customer/marketing",
        tone: "accent",
      },
    ]);
  });

  it("uses singular phrasing for a single stale opportunity and a single waiting work product", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [],
      opportunityCounts: [],
      quoteCounts: [],
      orderCounts: [],
      staleOpportunityCount: 1,
      marketingWork: {
        campaignBriefsOpen: 1,
        assetTasksOpen: 0,
        automationCandidatesOpen: 0,
      },
    });

    expect(summary.attentionItems).toEqual([
      {
        id: "stale-opportunities",
        label: "1 stale opportunity needs a next action",
        href: "/customer/opportunities",
        tone: "warning",
      },
      {
        id: "marketing-work",
        label: "1 marketing work product is waiting",
        href: "/customer/marketing",
        tone: "accent",
      },
    ]);
  });
});
