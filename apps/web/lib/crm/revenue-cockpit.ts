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
  /** Workspace base currency (from OrgSettings). Defaults to "USD" when not passed. */
  currency?: string;
  staleOpportunityCount: number;
  /** Active support contracts whose renewalDate falls within the next 30 days. */
  renewalsDueSoonCount?: number;
  /** Customer invoices past their due date and not yet paid/void. */
  overdueInvoiceCount?: number;
  marketingWork: {
    campaignBriefsOpen: number;
    assetTasksOpen: number;
    automationCandidatesOpen: number;
  };
};

export function formatRevenueAmount(value: number, currency: string = "USD"): string {
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
  const currency = input.currency ?? "USD";
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

  // The engagement inbox: what to work NOW, each with a plain-language why,
  // ordered by urgency (money overdue > deals stalling > new leads > renewals).
  const attentionItems: RevenueCockpitAttentionItem[] = [];

  const overdueInvoices = input.overdueInvoiceCount ?? 0;
  if (overdueInvoices > 0) {
    attentionItems.push({
      id: "overdue-invoices",
      label: `${overdueInvoices} invoice${overdueInvoices === 1 ? " is" : "s are"} past due — chase payment`,
      href: "/finance/invoices",
      tone: "danger",
    });
  }

  if (input.staleOpportunityCount > 0) {
    attentionItems.push({
      id: "stale-opportunities",
      label: `${input.staleOpportunityCount} stale opportunit${input.staleOpportunityCount === 1 ? "y needs" : "ies need"} a next action`,
      href: "/customer/opportunities",
      tone: "warning",
    });
  }

  if (newEngagements > 0) {
    attentionItems.push({
      id: "new-leads",
      label: `${newEngagements} new lead${newEngagements === 1 ? " is" : "s are"} waiting for triage`,
      href: "/customer/engagements",
      tone: "attention",
    });
  }

  const renewalsDue = input.renewalsDueSoonCount ?? 0;
  if (renewalsDue > 0) {
    attentionItems.push({
      id: "renewals-due",
      label: `${renewalsDue} support contract${renewalsDue === 1 ? " renews" : "s renew"} within 30 days`,
      href: "/customer",
      tone: "info",
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
        detail: `${formatRevenueAmount(pipelineValue, currency)} open`,
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
