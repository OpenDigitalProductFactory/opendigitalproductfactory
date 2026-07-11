import { describe, expect, it } from "vitest";
import { buildRevenueCockpitSummary, formatRevenueAmount } from "./revenue-cockpit";

describe("revenue cockpit summary", () => {
  it("formats revenue in USD by default", () => {
    expect(formatRevenueAmount(12500)).toBe("$12,500");
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
        detail: "$6,000 open",
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
    // 3 "new" engagements now surface as the new-leads triage inbox item.
    expect(summary.attentionItems).toEqual([
      {
        id: "new-leads",
        label: "3 new leads are waiting for triage",
        href: "/customer/engagements",
        tone: "attention",
      },
    ]);
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
        // Campaign briefs (1) + asset tasks (3) route to the campaigns review queue.
        id: "marketing-campaign-work",
        label: "4 campaign work products are waiting for review",
        href: "/customer/marketing/campaigns",
        tone: "accent",
      },
      {
        // Automation candidate (1) routes to the automation review queue.
        id: "marketing-automation-work",
        label: "1 automation candidate is waiting for review",
        href: "/customer/marketing/automation",
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
        id: "marketing-campaign-work",
        label: "1 campaign work product is waiting for review",
        href: "/customer/marketing/campaigns",
        tone: "accent",
      },
    ]);
  });

  it("builds the engagement inbox: urgency-ordered items each with a plain-language why", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [{ status: "new", count: 3 }],
      opportunityCounts: [],
      quoteCounts: [],
      orderCounts: [],
      staleOpportunityCount: 2,
      renewalsDueSoonCount: 1,
      overdueInvoiceCount: 2,
      marketingWork: { campaignBriefsOpen: 0, assetTasksOpen: 0, automationCandidatesOpen: 0 },
    });

    expect(summary.attentionItems.map((i) => i.id)).toEqual([
      "overdue-invoices",
      "stale-opportunities",
      "new-leads",
      "renewals-due",
    ]);
    expect(summary.attentionItems[0]).toEqual({
      id: "overdue-invoices",
      label: "2 invoices are past due — chase payment",
      href: "/finance/invoices",
      tone: "danger",
    });
    expect(summary.attentionItems[2].label).toBe("3 new leads are waiting for triage");
    expect(summary.attentionItems[3].label).toBe("1 support contract renews within 30 days");
  });

  it("renders an empty pipeline as a concern, not a neutral zero", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [],
      opportunityCounts: [{ stage: "closed_won", count: 4, expectedValue: 40000 }],
      quoteCounts: [],
      orderCounts: [],
      staleOpportunityCount: 0,
      marketingWork: { campaignBriefsOpen: 0, assetTasksOpen: 0, automationCandidatesOpen: 0 },
    });

    const pipeline = summary.metrics.find((m) => m.id === "pipeline");
    expect(pipeline).toEqual({
      id: "pipeline",
      label: "Pipeline",
      value: "0",
      detail: "No open pipeline — nothing in motion",
      href: "/customer/opportunities",
      tone: "warning",
    });
  });

  it("keeps the pipeline tile neutral-positive when there is open pipeline", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [],
      opportunityCounts: [{ stage: "proposal", count: 2, expectedValue: 8000 }],
      quoteCounts: [],
      orderCounts: [],
      staleOpportunityCount: 0,
      marketingWork: { campaignBriefsOpen: 0, assetTasksOpen: 0, automationCandidatesOpen: 0 },
    });

    const pipeline = summary.metrics.find((m) => m.id === "pipeline");
    expect(pipeline?.tone).toBe("accent");
    expect(pipeline?.detail).toBe("$8,000 open");
  });

  it("omits inbox items when the optional counts are absent (back-compat)", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [],
      opportunityCounts: [],
      quoteCounts: [],
      orderCounts: [],
      staleOpportunityCount: 0,
      marketingWork: { campaignBriefsOpen: 0, assetTasksOpen: 0, automationCandidatesOpen: 0 },
    });
    expect(summary.attentionItems).toEqual([]);
  });
});
