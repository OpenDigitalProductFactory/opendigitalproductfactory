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
  /** Monthly Recurring Revenue from active recurring commitments (retain-stage instrumentation). */
  mrr?: number;
  /** Annual Recurring Revenue (MRR × 12). */
  arr?: number;
  /** Retain-stage accounts the health signal flags as at churn risk. */
  atRiskAccountCount?: number;
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
  const pipelineEmpty = pipelineCount === 0;

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

  // Retention-first: protecting existing recurring revenue outranks new-lead triage.
  const atRiskAccounts = input.atRiskAccountCount ?? 0;
  if (atRiskAccounts > 0) {
    attentionItems.push({
      id: "accounts-at-risk",
      label: `${atRiskAccounts} customer${atRiskAccounts === 1 ? " is" : "s are"} at churn risk — reach out before renewal`,
      href: "/customer",
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

  // Marketing work products split by the queue that actually lists them, so the
  // pill lands on the reviewable items — not the marketing overview hub.
  const campaignWorkCount =
    input.marketingWork.campaignBriefsOpen + input.marketingWork.assetTasksOpen;
  const automationWorkCount = input.marketingWork.automationCandidatesOpen;
  if (campaignWorkCount > 0) {
    attentionItems.push({
      id: "marketing-campaign-work",
      label: `${campaignWorkCount} campaign work product${campaignWorkCount === 1 ? " is" : "s are"} waiting for review`,
      href: "/customer/marketing/campaigns",
      tone: "accent",
    });
  }
  if (automationWorkCount > 0) {
    attentionItems.push({
      id: "marketing-automation-work",
      label: `${automationWorkCount} automation candidate${automationWorkCount === 1 ? " is" : "s are"} waiting for review`,
      href: "/customer/marketing/automation",
      tone: "accent",
    });
  }

  const mrr = input.mrr ?? 0;
  return {
    metrics: [
      // Recurring revenue is the retain-stage center of gravity — lead with it when present.
      ...(mrr > 0
        ? [
            {
              id: "recurring-revenue",
              label: "Recurring revenue",
              value: formatRevenueAmount(mrr, currency),
              detail: `${formatRevenueAmount(input.arr ?? mrr * 12, currency)} ARR`,
              href: "/customer",
              tone: "success" as CrmTone,
            },
          ]
        : []),
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
        // An empty pipeline is a revenue red flag, not a neutral zero — say so.
        detail: pipelineEmpty
          ? "No open pipeline — nothing in motion"
          : `${formatRevenueAmount(pipelineValue, currency)} open`,
        href: "/customer/opportunities",
        tone: pipelineEmpty ? "warning" : "accent",
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
