import {
  openIntent,
  resolveNextSteps,
  type NextStepPointer,
  type ResolvedNextStep,
} from "@/lib/backlog/next-step-pointer";
import {
  buildQuickBooksReadinessDescriptor,
  type QuickBooksReadinessConnection,
} from "@/lib/integrations/quickbooks/readiness";
import { loadQuickBooksReadinessConnection } from "@/lib/integrations/quickbooks/connection-state";
import {
  TAX_REMITTANCE_PRODUCT_ID,
  TAX_REMITTANCE_TAXONOMY_NODE_ID,
} from "@dpf/db/workforce-portfolio";

type LaneRoute = {
  label: string;
  href: string;
};

export type AccountantWorkstream = {
  key: string;
  label: string;
  dailyWork: string;
  digitalProductId?: string;
  taxonomyNodeId?: string;
  routes: LaneRoute[];
  handoffRule: string;
};

export type AccountantLaneHandoff = {
  actorId: string;
  actorKind: "ai-coworker" | "employee-role" | "missing-coworker";
  label: string;
  responsibility: string;
  boundary: string;
};

export type AccountantProviderBoundary<Step = NextStepPointer> = {
  provider: string;
  label: string;
  href: string;
  posture: "read-first" | "import-staging" | "reconciliation-anchor" | "not-mapped";
  currentCoverage: string[];
  missingCoverage: string[];
  writeBoundary: string;
  nextStep: Step;
};

export type AccountantWorkLane<Step = NextStepPointer> = {
  roleId: "bookkeeper_accountant";
  roleLabel: string;
  taxonomyNodeId: string;
  posture: "hybrid";
  maturityTarget: "observe";
  workstreams: AccountantWorkstream[];
  handoffs: AccountantLaneHandoff[];
  providerBoundaries: AccountantProviderBoundary<Step>[];
  promotionGuardrail: string;
  nextWorkflow: {
    nextStep: Step;
    title: string;
    route: string;
    reason: string;
  };
};

/**
 * Build the bookkeeper/accountant work lane from a REAL QuickBooks connection.
 * QuickBooks coverage is derived from the live readiness descriptor for the
 * passed connection — an unconfigured install yields empty current coverage,
 * not a fabricated "connected / Example company" fixture.
 */
export function buildBookkeeperAccountantWorkLane(
  quickBooksConnection: QuickBooksReadinessConnection,
): AccountantWorkLane {
  const quickBooksReadiness = buildQuickBooksReadinessDescriptor({
    connection: quickBooksConnection,
  });

  const quickBooksReadCoverage = quickBooksReadiness.capabilities
    .filter((capability) => capability.state === "read" || capability.state === "import-ready")
    .map((capability) => capability.label);

  const quickBooksMissingCoverage = quickBooksReadiness.capabilities
    .filter((capability) => capability.state !== "read" && capability.state !== "import-ready")
    .map((capability) => capability.label);

  return {
  roleId: "bookkeeper_accountant",
  roleLabel: "Bookkeeper / Accountant",
  taxonomyNodeId: "for_employees/financial_management",
  posture: "hybrid",
  maturityTarget: "observe",
  workstreams: [
    {
      key: "receivables",
      label: "Receivables and payments",
      dailyWork: "Review invoices, customer balances, payment status, and collections pressure.",
      routes: [
        { label: "Invoices", href: "/finance/invoices" },
        { label: "Payments", href: "/finance/payments" },
        { label: "Revenue hub", href: "/finance/revenue" },
      ],
      handoffRule:
        "Finance Agent can prepare invoice/payment evidence; owner approval is required before any collection or write-back action.",
    },
    {
      key: "payables",
      label: "Payables, suppliers, and expenses",
      dailyWork: "Track vendors, bills, expense claims, purchase orders, and payment-run readiness.",
      routes: [
        { label: "Bills", href: "/finance/bills" },
        { label: "Suppliers", href: "/finance/suppliers" },
        { label: "Expense claims", href: "/finance/expense-claims" },
        { label: "Purchase orders", href: "/finance/purchase-orders" },
        { label: "Payment runs", href: "/finance/payment-runs" },
      ],
      handoffRule:
        "Finance Controller owns approval thresholds and exception review; Finance Agent can assemble draft packets.",
    },
    {
      key: "banking-close",
      label: "Banking, reports, tax, and close",
      dailyWork: "Check cash position, bank imports, reconciliation candidates, reports, tax exposure, and close tasks.",
      digitalProductId: TAX_REMITTANCE_PRODUCT_ID,
      taxonomyNodeId: TAX_REMITTANCE_TAXONOMY_NODE_ID,
      routes: [
        { label: "Banking", href: "/finance/banking" },
        { label: "Bank rules", href: "/finance/banking/rules" },
        { label: "Reports", href: "/finance/reports" },
        { label: "Tax settings", href: "/finance/settings/tax" },
        { label: "VAT summary", href: "/finance/reports/vat-summary" },
        { label: "Close hub", href: "/finance/close" },
      ],
      handoffRule:
        "Accountant review gates must exist before DPF claims close, tax, or reconciliation authority.",
    },
  ],
  handoffs: [
    {
      actorId: "finance-agent",
      actorKind: "ai-coworker",
      label: "Finance Agent",
      responsibility: "Prepare invoice, payment, bill, and report evidence for review.",
      boundary: "Proposal mode only for accounting-impacting actions until write gates exist.",
    },
    {
      actorId: "finance-controller",
      actorKind: "ai-coworker",
      label: "Finance Controller",
      responsibility: "Own controls, reconciliation posture, approval thresholds, and close readiness.",
      boundary: "Escalates ambiguous accounting ownership rather than silently promoting records.",
    },
    {
      actorId: "owner_operator",
      actorKind: "employee-role",
      label: "Owner / Operator",
      responsibility: "Approve provider connections, cash-sensitive actions, and DPF-primary promotion decisions.",
      boundary: "Keeps business authority separate from coworker preparation work.",
    },
    {
      actorId: "future-bookkeeper-accountant-specialist",
      actorKind: "missing-coworker",
      label: "Future bookkeeper/accountant specialist",
      responsibility: "Review accountant evidence packets and provider reconciliation exceptions.",
      boundary: "Missing coworker; track as a later capability once the lane is visible.",
    },
  ],
  providerBoundaries: [
    {
      provider: "quickbooks",
      label: "QuickBooks Online",
      href: "/platform/tools/integrations/quickbooks",
      posture: "import-staging",
      currentCoverage: quickBooksReadCoverage,
      missingCoverage: quickBooksMissingCoverage,
      writeBoundary:
        "QuickBooks staging is source-attributed and non-editable; no write-back or DPF-primary accounting ownership until entity links, reconciliation evidence, rollback/export, and accountant review are proven.",
      nextStep: openIntent("Entity links and review queue"),
    },
    {
      provider: "stripe",
      label: "Stripe Billing & Payments",
      href: "/platform/tools/integrations/stripe",
      posture: "reconciliation-anchor",
      currentCoverage: ["Balance", "Customers", "Invoices", "Payment intents"],
      missingCoverage: ["Fees", "Payout deposits", "Invoice allocation matching", "QuickBooks reconciliation"],
      writeBoundary:
        "Stripe remains the payment processor; DPF should reconcile payment evidence before promoting billing records.",
      nextStep: openIntent("Fee and payout reconciliation"),
    },
    {
      provider: "bank-feed-provider",
      label: "Bank-feed provider",
      href: "/finance/banking",
      posture: "not-mapped",
      currentCoverage: ["Manual bank accounts", "CSV import posture"],
      missingCoverage: ["Direct bank feeds", "Statement source custody", "Automated reconciliation evidence"],
      writeBoundary:
        "Bank feeds stay unmapped until DPF chooses provider ownership and proves rollback/export expectations.",
      nextStep: openIntent("Provider ownership decision"),
    },
  ],
  promotionGuardrail:
    "DPF does not become the accounting system of record until read coverage, import staging, reconciliation evidence, rollback/export, and accountant review workflows are proven in dual-run.",
  nextWorkflow: {
    nextStep: openIntent("Entity links and review queue"),
    title: "QuickBooks import review queue and accounting entity links",
    route: "/platform/tools/integrations/quickbooks",
    reason:
      "The accountant lane needs persisted review candidates and explicit entity links before reconciliation or write-back gates.",
  },
  };
}

/** The lane once every declared next step has been checked against the backlog. */
export type ResolvedAccountantWorkLane = AccountantWorkLane<ResolvedNextStep>;

/**
 * Load the accountant work lane with the install's REAL QuickBooks connection
 * state. Async because it reads the integration-credential substrate, and
 * because a declared next step is a claim about the backlog that this lane
 * checks before any surface renders it (BI-5BF97BAA).
 */
export async function getBookkeeperAccountantWorkLane(): Promise<ResolvedAccountantWorkLane> {
  const quickBooksConnection = await loadQuickBooksReadinessConnection();
  const lane = buildBookkeeperAccountantWorkLane(quickBooksConnection);

  const declared = [
    ...lane.providerBoundaries.map((boundary) => boundary.nextStep),
    lane.nextWorkflow.nextStep,
  ];
  const resolved = await resolveNextSteps(declared);

  return {
    ...lane,
    providerBoundaries: lane.providerBoundaries.map((boundary, index) => ({
      ...boundary,
      nextStep: resolved[index],
    })),
    nextWorkflow: { ...lane.nextWorkflow, nextStep: resolved[resolved.length - 1] },
  };
}

export function getAccountantLaneRouteHrefs<Step>(lane: AccountantWorkLane<Step>): string[] {
  return Array.from(new Set(lane.workstreams.flatMap((workstream) => workstream.routes.map((route) => route.href))));
}
