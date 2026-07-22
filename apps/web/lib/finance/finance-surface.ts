// Archetype-scoped finance surface model.
//
// The generic finance overview leads with accountant/back-office sections
// (receivables/payables/close, VAT, dunning, payment runs, GL reports, bank
// rules, AI spend). For an owner-operated food-hospitality business that is the
// wrong first screen: the owner wants to know "what money needs attention
// today?" — deposits to collect, order and ticket payments landing, supplier
// bills to pay, payouts to reconcile — not the ledger internals a bookkeeper
// works from.
//
// This module maps an archetype CATEGORY (StorefrontArchetype.category, e.g.
// "food-hospitality") to an owner-first finance surface that foregrounds the
// restaurant's real money jobs and defers the accounting internals behind clear
// advanced sections. Every job/link points at a REAL finance route — there are
// no Restaurant-specific money tables today, so the surface is an honest
// re-framing of the existing Invoice/Payment/Bill/BankTransaction data, not a
// promise of new records.
//
// Dependency-free on purpose (no prisma/@dpf/db, no react) so it unit-tests in
// isolation and never pulls a server-only module into a client bundle. The
// server resolves the org's archetype category and calls resolveFinanceSurface.

export type FinanceSurfaceMode = "owner-first" | "standard";

/**
 * A live figure the finance overview page computes and slots into a money job.
 * The surface model only names which figure a job wants; the page owns the
 * prisma queries and the formatting.
 */
export type FinanceMetricKey =
  | "outstanding-receivables"
  | "money-in-month"
  | "overdue-count"
  | "supplier-bills-due"
  | "cash-position";

export type FinanceMoneyJob = {
  id: string;
  /** Restaurant-facing name for this money job. */
  label: string;
  /** Owner-first phrasing of the money question this job answers. */
  question: string;
  /** Real finance route this job opens. */
  href: string;
  /**
   * "monitor" jobs show a running figure the owner watches; "action" jobs are a
   * thing the owner starts (e.g. charge a no-show fee).
   */
  kind: "monitor" | "action";
  /** Live figure to display, for monitor jobs backed by a running number. */
  metricKey?: FinanceMetricKey;
};

export type FinanceInvoiceEntryPointId =
  | "booking"
  | "order"
  | "catering"
  | "private-event"
  | "blank";

export type FinanceInvoiceEntryPoint = {
  id: FinanceInvoiceEntryPointId;
  label: string;
  description: string;
  href: string;
};

export type FinanceAdvancedLink = { label: string; href: string };

export type FinanceAdvancedSection = {
  id: string;
  label: string;
  description: string;
  links: FinanceAdvancedLink[];
};

export type FinanceSurfaceModel = {
  archetypeCategory: string | null;
  mode: FinanceSurfaceMode;
  headline: string;
  subhead: string;
  /** Foregrounded Restaurant money jobs (empty in standard mode). */
  moneyJobs: FinanceMoneyJob[];
  /** Restaurant-context invoice entry points (empty in standard mode). */
  invoiceEntryPoints: FinanceInvoiceEntryPoint[];
  /** Deferred accounting/back-office internals (empty in standard mode). */
  advancedSections: FinanceAdvancedSection[];
};

// Archetype categories that get the owner-first money-jobs surface. Keyed on
// StorefrontArchetype.category so every food-hospitality archetype (restaurant,
// café, bakery, catering) inherits it — not just one archetypeId.
const OWNER_FIRST_CATEGORIES: ReadonlySet<string> = new Set(["food-hospitality"]);

function foodHospitalityMoneyJobs(): FinanceMoneyJob[] {
  return [
    {
      id: "deposits-balances",
      label: "Deposits & event balances",
      question: "Booking deposits and catering or event balances still to collect.",
      href: "/finance/invoices",
      kind: "monitor",
      metricKey: "outstanding-receivables",
    },
    {
      id: "order-ticket-payments",
      label: "Order & ticket payments",
      question: "Money in from table orders, tickets, and covers this month.",
      href: "/finance/payments",
      kind: "monitor",
      metricKey: "money-in-month",
    },
    {
      id: "overdue-collections",
      label: "Overdue payments",
      question: "Guest, catering, and event payments now past their due date.",
      href: "/finance/reports/aged-debtors",
      kind: "monitor",
      metricKey: "overdue-count",
    },
    {
      id: "supplier-bills",
      label: "Supplier bills",
      question: "Food, drink, and supplier bills waiting to be paid.",
      href: "/finance/bills",
      kind: "monitor",
      metricKey: "supplier-bills-due",
    },
    {
      id: "payouts-reconciliation",
      label: "Payouts & reconciliation",
      question: "Card payouts landing in the bank, matched back to sales.",
      href: "/finance/banking",
      kind: "monitor",
      metricKey: "cash-position",
    },
    {
      id: "no-show-cancellation-fees",
      label: "No-show & cancellation fees",
      question: "Charge a fee when a guest no-shows or cancels late.",
      href: "/finance/invoices/new?from=no-show",
      kind: "action",
    },
  ];
}

function foodHospitalityInvoiceEntryPoints(): FinanceInvoiceEntryPoint[] {
  return [
    {
      id: "booking",
      label: "From a booking",
      description: "Turn a reservation into a deposit or balance invoice.",
      href: "/finance/invoices/new?from=booking",
    },
    {
      id: "order",
      label: "From an order",
      description: "Bill a table, takeaway, or delivery order.",
      href: "/finance/invoices/new?from=order",
    },
    {
      id: "catering",
      label: "Catering order",
      description: "Invoice a catering job — deposit up front, balance later.",
      href: "/finance/invoices/new?from=catering",
    },
    {
      id: "private-event",
      label: "Private event",
      description: "Invoice a private hire or event, deposit first.",
      href: "/finance/invoices/new?from=private-event",
    },
    {
      id: "blank",
      label: "Blank invoice",
      description: "Start from a blank invoice with no context.",
      href: "/finance/invoices/new",
    },
  ];
}

// Accounting internals a restaurant owner should not have to lead with. Kept as
// clearly-labelled advanced sections so a bookkeeper/accountant can still reach
// VAT, dunning, payment runs, the general ledger, bank rules, and AI spend —
// they are one disclosure away, not on the first screen.
function foodHospitalityAdvancedSections(): FinanceAdvancedSection[] {
  return [
    {
      id: "accounting-tax",
      label: "Accounting & tax",
      description: "Period-end, VAT, and ledger detail your bookkeeper or accountant works from.",
      links: [
        { label: "VAT summary", href: "/finance/reports/vat-summary" },
        { label: "VAT / tax remittance", href: "/finance/settings/tax" },
        { label: "General ledger", href: "/finance/reports/general-ledger" },
        { label: "Profit & loss", href: "/finance/reports/profit-loss" },
        { label: "All reports", href: "/finance/reports" },
        { label: "Period close", href: "/finance/close" },
      ],
    },
    {
      id: "automation-controls",
      label: "Automation & controls",
      description: "Set-and-forget rules and back-office runs — configured once, revisited rarely.",
      links: [
        { label: "Payment runs", href: "/finance/payment-runs" },
        { label: "Dunning reminders", href: "/finance/settings/dunning" },
        { label: "Bank rules", href: "/finance/banking/rules" },
        { label: "Recurring schedules", href: "/finance/recurring" },
        { label: "AI spend", href: "/finance/spend/ai" },
      ],
    },
  ];
}

/**
 * Resolve the finance overview surface for an archetype category.
 *
 * Owner-first (food-hospitality) returns foregrounded money jobs, Restaurant
 * invoice entry points, and deferred advanced sections. Every other archetype
 * (and an unknown/null category) returns the "standard" mode with empty
 * collections — the page keeps its existing generic layout for those.
 */
export function resolveFinanceSurface(
  category: string | null | undefined,
): FinanceSurfaceModel {
  const normalized = category ?? null;

  if (normalized != null && OWNER_FIRST_CATEGORIES.has(normalized)) {
    return {
      archetypeCategory: normalized,
      mode: "owner-first",
      headline: "What money needs attention today?",
      subhead:
        "Deposits to collect, payments coming in, supplier bills to pay, and payouts to reconcile — the accounting detail is one tap away below.",
      moneyJobs: foodHospitalityMoneyJobs(),
      invoiceEntryPoints: foodHospitalityInvoiceEntryPoints(),
      advancedSections: foodHospitalityAdvancedSections(),
    };
  }

  return {
    archetypeCategory: normalized,
    mode: "standard",
    headline: "Finance",
    subhead: "Run cash, receivables, payables, and close work from one place.",
    moneyJobs: [],
    invoiceEntryPoints: [],
    advancedSections: [],
  };
}

export function isOwnerFirstFinanceCategory(
  category: string | null | undefined,
): boolean {
  return category != null && OWNER_FIRST_CATEGORIES.has(category);
}

// ─── Archetype-appropriate invoice copy ───────────────────────────────────────
// The generic invoice form leads with professional-services language
// ("engagement letters and service agreements"). Resolve the copy from the
// archetype so a restaurant sees booking/order/catering wording instead.

export type FinanceInvoiceContext = "booking" | "order" | "catering" | "private-event" | "no-show";

export type FinanceInvoiceCopy = {
  /** Subhead under the "New Invoice" heading. */
  newInvoiceSubhead: string;
  /** Helper line under "require signature before payment". */
  signatureHint: string;
  /** Label for the account/customer picker. */
  customerLabel: string;
  /** Per-entry-point framing shown when the form is opened with ?from=<context>. */
  contexts: Record<FinanceInvoiceContext, { title: string; description: string }>;
};

const PROFESSIONAL_INVOICE_COPY: FinanceInvoiceCopy = {
  newInvoiceSubhead: "Create a draft invoice to send to a customer.",
  signatureHint:
    "The customer signs on the payment page before they can pay. Recommended for engagement letters and service agreements.",
  customerLabel: "Customer",
  contexts: {
    booking: { title: "New invoice", description: "Create a draft invoice to send to a customer." },
    order: { title: "New invoice", description: "Create a draft invoice to send to a customer." },
    catering: { title: "New invoice", description: "Create a draft invoice to send to a customer." },
    "private-event": { title: "New invoice", description: "Create a draft invoice to send to a customer." },
    "no-show": { title: "New invoice", description: "Create a draft invoice to send to a customer." },
  },
};

const FOOD_HOSPITALITY_INVOICE_COPY: FinanceInvoiceCopy = {
  newInvoiceSubhead: "Bill a booking, order, catering job, or private event.",
  signatureHint:
    "The guest signs on the payment page before they can pay. Useful for catering and private-event agreements where you want sign-off before the deposit.",
  customerLabel: "Guest or customer",
  contexts: {
    booking: {
      title: "Invoice from a booking",
      description: "Bill a reservation for its deposit now, or the balance after service.",
    },
    order: {
      title: "Invoice from an order",
      description: "Bill a table, takeaway, or delivery order.",
    },
    catering: {
      title: "Catering invoice",
      description: "Bill a catering job — take the deposit up front and the balance on delivery.",
    },
    "private-event": {
      title: "Private-event invoice",
      description: "Bill a private hire or event, with the deposit secured first.",
    },
    "no-show": {
      title: "No-show or cancellation fee",
      description: "Charge a guest for a no-show or a late cancellation.",
    },
  },
};

export function resolveFinanceInvoiceCopy(
  category: string | null | undefined,
): FinanceInvoiceCopy {
  return isOwnerFirstFinanceCategory(category)
    ? FOOD_HOSPITALITY_INVOICE_COPY
    : PROFESSIONAL_INVOICE_COPY;
}

export function isFinanceInvoiceContext(value: string | null | undefined): value is FinanceInvoiceContext {
  return (
    value === "booking" ||
    value === "order" ||
    value === "catering" ||
    value === "private-event" ||
    value === "no-show"
  );
}
