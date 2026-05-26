import type { CrmTone } from "./presentation";
import { isOpenOpportunityStage } from "./presentation";

export type CountByStatus = {
  status: string;
  count: number;
};

export type CountByStage = {
  stage: string;
  count: number;
  expectedValue: number;
};

export type RevenueCockpitMetric = {
  id: string;
  label: string;
  value: string;
  detail: string;
  href: string;
  tone: CrmTone;
};

export type RevenueCockpitAttentionItem = {
  id: string;
  label: string;
  href: string;
  tone: CrmTone;
};

export type RevenueCockpitSummary = {
  metrics: RevenueCockpitMetric[];
  attentionItems: RevenueCockpitAttentionItem[];
};

export type RevenueCockpitInput = {
  engagementCounts: CountByStatus[];
  opportunityCounts: CountByStage[];
  quoteCounts: CountByStatus[];
  orderCounts: CountByStatus[];
  staleOpportunityCount: number;
  marketingWork: {
    campaignBriefsOpen: number;
    assetTasksOpen: number;
    automationCandidatesOpen: number;
  };
};

// Default currency mirrors Opportunity.currency and Quote.currency Prisma defaults.
export function formatRevenueAmount(value: number, currency: string = "GBP"): string {
  const locale = currency === "GBP" ? "en-GB" : "en-US";

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function countWhere(items: CountByStatus[], statuses: string[]): number {
  return items
    .filter((item) => statuses.includes(item.status))
    .reduce((sum, item) => sum + item.count, 0);
}

export function buildRevenueCockpitSummary(input: RevenueCockpitInput): RevenueCockpitSummary {
  const engagementTotal = input.engagementCounts.reduce((sum, item) => sum + item.count, 0);
  const newEngagements = countWhere(input.engagementCounts, ["new"]);
  const openOpportunities = input.opportunityCounts.filter((item) => isOpenOpportunityStage(item.stage));
  const pipelineCount = openOpportunities.reduce((sum, item) => sum + item.count, 0);
  const pipelineValue = openOpportunities.reduce((sum, item) => sum + item.expectedValue, 0);
  const quoteCount = countWhere(input.quoteCounts, ["draft", "sent"]);
  const sentQuotes = countWhere(input.quoteCounts, ["sent"]);
  const activeOrders = countWhere(input.orderCounts, ["confirmed", "in_progress"]);
  const marketingWorkCount =
    input.marketingWork.campaignBriefsOpen +
    input.marketingWork.assetTasksOpen +
    input.marketingWork.automationCandidatesOpen;

  const attentionItems: RevenueCockpitAttentionItem[] = [];

  if (input.staleOpportunityCount > 0) {
    attentionItems.push({
      id: "stale-opportunities",
      label: `${input.staleOpportunityCount} stale opportunit${input.staleOpportunityCount === 1 ? "y needs" : "ies need"} a next action`,
      href: "/customer/opportunities",
      tone: "warning",
    });
  }

  if (marketingWorkCount > 0) {
    attentionItems.push({
      id: "marketing-work",
      label: `${marketingWorkCount} marketing work product${marketingWorkCount === 1 ? " is" : "s are"} waiting`,
      href: "/customer/marketing",
      tone: "accent",
    });
  }

  return {
    metrics: [
      {
        id: "engagements",
        label: "Engagements",
        value: String(engagementTotal),
        detail: `${newEngagements} new`,
        href: "/customer/engagements",
        tone: "attention",
      },
      {
        id: "pipeline",
        label: "Pipeline",
        value: String(pipelineCount),
        detail: `${formatRevenueAmount(pipelineValue)} open`,
        href: "/customer/opportunities",
        tone: "accent",
      },
      {
        id: "quotes",
        label: "Quotes",
        value: String(quoteCount),
        detail: `${sentQuotes} sent`,
        href: "/customer/quotes",
        tone: "info",
      },
      {
        id: "orders",
        label: "Orders",
        value: String(activeOrders),
        detail: "active",
        href: "/customer/sales-orders",
        tone: "success",
      },
    ],
    attentionItems,
  };
}
