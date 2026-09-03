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
// "food-hospitality") to an owner-first finance surface, and further narrows it
// by the archetype SUBTYPE (StorefrontArchetype.archetypeId — restaurant,
// catering, bakery) so a caterer sees quotes/event balances and a bakery sees
// custom-order deposits rather than one generic food set.
//
// Every job/link points at a REAL finance route. There are no Restaurant money
// tables today, so the surface is an honest re-framing of the existing
// Invoice/Payment/Bill/BankTransaction data, not a promise of new records. Each
// live metric is used by AT MOST ONE money job per subtype — the same figure is
// never shown twice under two different names.
//
// Dependency-free on purpose (no prisma/@dpf/db, no react) so it unit-tests in
// isolation and never pulls a server-only module into a client bundle. The
// server resolves the org's archetype and calls resolveFinanceSurface.

import { PET_RESCUE_ENTRY_POINTS, PET_RESCUE_MONEY_JOBS } from "./pet-rescue-finance";

export type FinanceSurfaceMode = "owner-first" | "standard";

/**
 * Food-hospitality archetype subtypes (StorefrontArchetype.archetypeId).
 * `generic` is the fallback for a food-hospitality install whose archetypeId is
 * not one of the three known subtypes.
 */
export type FoodHospitalitySubtype = "restaurant" | "catering" | "bakery" | "generic";
export type FinanceSurfaceSubtype = FoodHospitalitySubtype | "pet-rescue";

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
  /** Subtype-facing name for this money job. */
  label: string;
  /** Owner-first phrasing of the money question this job answers. */
  question: string;
  /** Real finance route this job opens. */
  href: string;
  /**
   * "monitor" jobs show a running figure the owner watches; "action" jobs are a
   * thing the owner starts (e.g. quote a catering job).
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
  | "quote"
  | "event-deposit"
  | "event-balance"
  | "custom-order"
  | "counter-sale"
  | "delivery"
  | "donation"
  | "grant"
  | "sponsorship"
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
  /** Null in standard mode. */
  subtype: FinanceSurfaceSubtype | null;
  mode: FinanceSurfaceMode;
  headline: string;
  subhead: string;
  /** Foregrounded subtype money jobs (empty in standard mode). */
  moneyJobs: FinanceMoneyJob[];
  /** Subtype invoice entry points (empty in standard mode). */
  invoiceEntryPoints: FinanceInvoiceEntryPoint[];
  /** Deferred accounting/back-office internals (empty in standard mode). */
  advancedSections: FinanceAdvancedSection[];
  primaryActionLabel: string;
  entryPointSectionLabel: string;
  advancedSectionLabel: string;
  advancedSectionDescription: string;
  navigationLabels: Record<"revenue" | "spend" | "close" | "configuration", string>;
  recentRecordsLabel: string;
  recentRecordsEmpty: string;
};

// Archetype categories that get the owner-first money-jobs surface. Keyed on
// StorefrontArchetype.category so every food-hospitality archetype inherits it.
const OWNER_FIRST_CATEGORIES: ReadonlySet<string> = new Set(["food-hospitality"]);

const KNOWN_SUBTYPES: ReadonlySet<string> = new Set(["restaurant", "catering", "bakery"]);

/** Narrow a StorefrontArchetype.archetypeId to a known food-hospitality subtype. */
export function resolveFoodHospitalitySubtype(
  archetypeId: string | null | undefined,
): FoodHospitalitySubtype {
  return archetypeId != null && KNOWN_SUBTYPES.has(archetypeId)
    ? (archetypeId as FoodHospitalitySubtype)
    : "generic";
}

// ─── Money jobs per subtype ───────────────────────────────────────────────────
// Shared shape across subtypes: receivables, money-in, overdue, supplier bills,
// payouts, plus one subtype-specific action. The METRICS are the same real
// figures; the LABEL and QUESTION carry the subtype's actual money job.

const PAYOUTS_RECONCILIATION: FinanceMoneyJob = {
  id: "payouts-reconciliation",
  label: "Payouts & reconciliation",
  question: "Card payouts landing in the bank, matched back to sales.",
  href: "/finance/banking",
  kind: "monitor",
  metricKey: "cash-position",
};

const MONEY_JOBS_BY_SUBTYPE: Record<FoodHospitalitySubtype, FinanceMoneyJob[]> = {
  restaurant: [
    {
      id: "deposits-balances",
      label: "Deposits & event balances",
      question: "Booking deposits and private-dining balances still to collect.",
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
      question: "Guest and private-dining payments now past their due date.",
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
    PAYOUTS_RECONCILIATION,
    {
      id: "no-show-cancellation-fees",
      label: "No-show & cancellation fees",
      question: "Charge a fee when a guest no-shows or cancels late.",
      href: "/finance/invoices/new?from=no-show",
      kind: "action",
    },
  ],

  catering: [
    {
      id: "event-deposits-balances",
      label: "Event deposits & balances",
      question: "Deposits securing dates, and balances due after events are delivered.",
      href: "/finance/invoices",
      kind: "monitor",
      metricKey: "outstanding-receivables",
    },
    {
      id: "event-payments",
      label: "Event payments received",
      question: "Money in from catering jobs and events this month.",
      href: "/finance/payments",
      kind: "monitor",
      metricKey: "money-in-month",
    },
    {
      id: "overdue-event-payments",
      label: "Overdue event payments",
      question: "Corporate and event invoices now past their due date.",
      href: "/finance/reports/aged-debtors",
      kind: "monitor",
      metricKey: "overdue-count",
    },
    {
      id: "ingredient-staffing-bills",
      label: "Ingredient & staffing bills",
      question: "Food, drink, and staffing costs for upcoming events.",
      href: "/finance/bills",
      kind: "monitor",
      metricKey: "supplier-bills-due",
    },
    PAYOUTS_RECONCILIATION,
    {
      id: "quote-catering-job",
      label: "Quote a catering job",
      question: "Price a corporate, wedding, or private event before you commit.",
      href: "/finance/invoices/new?from=quote",
      kind: "action",
    },
  ],

  bakery: [
    {
      id: "custom-order-deposits-balances",
      label: "Custom order deposits & balances",
      question: "Deposits and balances on celebration and wedding cakes.",
      href: "/finance/invoices",
      kind: "monitor",
      metricKey: "outstanding-receivables",
    },
    {
      id: "counter-order-takings",
      label: "Counter & order takings",
      question: "Money in from counter sales and collected orders this month.",
      href: "/finance/payments",
      kind: "monitor",
      metricKey: "money-in-month",
    },
    {
      id: "overdue-order-payments",
      label: "Overdue order payments",
      question: "Custom and wholesale orders now past their due date.",
      href: "/finance/reports/aged-debtors",
      kind: "monitor",
      metricKey: "overdue-count",
    },
    {
      id: "ingredient-supplier-bills",
      label: "Ingredient & supplier bills",
      question: "Flour, dairy, packaging, and supplier bills waiting to be paid.",
      href: "/finance/bills",
      kind: "monitor",
      metricKey: "supplier-bills-due",
    },
    PAYOUTS_RECONCILIATION,
    {
      id: "bill-custom-order",
      label: "Bill a custom order",
      question: "Take a deposit on a celebration or wedding cake.",
      href: "/finance/invoices/new?from=custom-order",
      kind: "action",
    },
  ],

  // Food-hospitality install whose archetypeId is not one of the three known
  // subtypes — neutral food/drink language, no subtype-specific claims.
  generic: [
    {
      id: "deposits-balances",
      label: "Deposits & balances",
      question: "Deposits and outstanding balances still to collect from customers.",
      href: "/finance/invoices",
      kind: "monitor",
      metricKey: "outstanding-receivables",
    },
    {
      id: "order-payments",
      label: "Order payments",
      question: "Money in from orders and sales this month.",
      href: "/finance/payments",
      kind: "monitor",
      metricKey: "money-in-month",
    },
    {
      id: "overdue-collections",
      label: "Overdue payments",
      question: "Customer payments now past their due date.",
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
    PAYOUTS_RECONCILIATION,
    {
      id: "bill-a-job",
      label: "Bill a job",
      question: "Raise an invoice for an order, booking, or event.",
      href: "/finance/invoices/new?from=order",
      kind: "action",
    },
  ],
};

// ─── Invoice entry points per subtype ─────────────────────────────────────────

const BLANK_ENTRY_POINT: FinanceInvoiceEntryPoint = {
  id: "blank",
  label: "Blank invoice",
  description: "Start from a blank invoice with no context.",
  href: "/finance/invoices/new",
};

const ENTRY_POINTS_BY_SUBTYPE: Record<FoodHospitalitySubtype, FinanceInvoiceEntryPoint[]> = {
  restaurant: [
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
    BLANK_ENTRY_POINT,
  ],

  catering: [
    {
      id: "quote",
      label: "Quote",
      description: "Price a job before it is confirmed — nothing is owed yet.",
      href: "/finance/invoices/new?from=quote",
    },
    {
      id: "event-deposit",
      label: "Event deposit",
      description: "Take the deposit that secures the date.",
      href: "/finance/invoices/new?from=event-deposit",
    },
    {
      id: "event-balance",
      label: "Event balance",
      description: "Bill the remaining balance after the event is delivered.",
      href: "/finance/invoices/new?from=event-balance",
    },
    {
      id: "private-event",
      label: "Private event",
      description: "Invoice a wedding, party, or private celebration.",
      href: "/finance/invoices/new?from=private-event",
    },
    BLANK_ENTRY_POINT,
  ],

  bakery: [
    {
      id: "custom-order",
      label: "Custom order",
      description: "Bill a celebration or wedding cake — deposit up front.",
      href: "/finance/invoices/new?from=custom-order",
    },
    {
      id: "counter-sale",
      label: "Counter sale",
      description: "Record a standard over-the-counter sale.",
      href: "/finance/invoices/new?from=counter-sale",
    },
    {
      id: "delivery",
      label: "Pickup or delivery",
      description: "Add a pickup or delivery fee to an order.",
      href: "/finance/invoices/new?from=delivery",
    },
    BLANK_ENTRY_POINT,
  ],

  generic: [
    {
      id: "order",
      label: "From an order",
      description: "Bill an order or sale.",
      href: "/finance/invoices/new?from=order",
    },
    {
      id: "booking",
      label: "From a booking",
      description: "Turn a booking into a deposit or balance invoice.",
      href: "/finance/invoices/new?from=booking",
    },
    BLANK_ENTRY_POINT,
  ],
};

// ─── Deferred accounting internals ────────────────────────────────────────────
// Kept as clearly-labelled advanced sections so a bookkeeper/accountant can
// still reach VAT, dunning, payment runs, the general ledger, bank rules, and AI
// spend — they are one disclosure away, not on the first screen.

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

const SUBHEAD_BY_SUBTYPE: Record<FoodHospitalitySubtype, string> = {
  restaurant:
    "Deposits to collect, payments coming in, supplier bills to pay, and payouts to reconcile — the accounting detail is one tap away below.",
  catering:
    "Quotes to send, deposits securing dates, balances due after events, and ingredient and staffing bills — the accounting detail is one tap away below.",
  bakery:
    "Custom-order deposits and balances, counter takings, and ingredient bills — the accounting detail is one tap away below.",
  generic:
    "Deposits to collect, payments coming in, supplier bills to pay, and payouts to reconcile — the accounting detail is one tap away below.",
};

/**
 * Resolve the finance overview surface for an archetype.
 *
 * Owner-first (food-hospitality) returns foregrounded money jobs narrowed to the
 * archetype subtype, subtype invoice entry points, and deferred advanced
 * sections. Every other archetype (and an unknown/null category) returns the
 * "standard" mode with empty collections — the page keeps its existing generic
 * layout for those.
 *
 * @param category    StorefrontArchetype.category (e.g. "food-hospitality")
 * @param archetypeId StorefrontArchetype.archetypeId (e.g. "catering"); when
 *                    omitted or unknown the neutral food-hospitality set is used.
 */
export function resolveFinanceSurface(
  category: string | null | undefined,
  archetypeId?: string | null,
): FinanceSurfaceModel {
  const normalized = category ?? null;

  if (["pet-rescue", "animal-shelter"].includes((archetypeId ?? "").toLowerCase())) {
    return {
      archetypeCategory: normalized,
      subtype: "pet-rescue",
      mode: "owner-first",
      headline: "Funding & stewardship",
      subhead: "Donations and grants coming in, animal-care costs going out, and funds available for the mission.",
      moneyJobs: PET_RESCUE_MONEY_JOBS,
      invoiceEntryPoints: PET_RESCUE_ENTRY_POINTS,
      advancedSections: foodHospitalityAdvancedSections(),
      primaryActionLabel: "Record contribution",
      entryPointSectionLabel: "Record funding",
      advancedSectionLabel: "Finance administration",
      advancedSectionDescription: "Accounting, banking, reporting, and compliance detail.",
      navigationLabels: {
        revenue: "Funding",
        spend: "Care spending",
        close: "Stewardship",
        configuration: "Configuration",
      },
      recentRecordsLabel: "Recent contributions",
      recentRecordsEmpty: "No contributions recorded yet. Record a donation, grant, or sponsorship to get started.",
    };
  }

  if (normalized != null && OWNER_FIRST_CATEGORIES.has(normalized)) {
    const subtype = resolveFoodHospitalitySubtype(archetypeId);
    return {
      archetypeCategory: normalized,
      subtype,
      mode: "owner-first",
      headline: "What money needs attention today?",
      subhead: SUBHEAD_BY_SUBTYPE[subtype],
      moneyJobs: MONEY_JOBS_BY_SUBTYPE[subtype],
      invoiceEntryPoints: ENTRY_POINTS_BY_SUBTYPE[subtype],
      advancedSections: foodHospitalityAdvancedSections(),
      primaryActionLabel: "New Invoice",
      entryPointSectionLabel: "Start a bill",
      advancedSectionLabel: "Accounting & admin",
      advancedSectionDescription: "VAT, dunning, payment runs, ledger reports, bank rules, and AI spend — the back-office detail, out of the way until you need it.",
      navigationLabels: { revenue: "Revenue", spend: "Spend", close: "Close", configuration: "Configuration" },
      recentRecordsLabel: "Recent Invoices",
      recentRecordsEmpty: "No invoices yet. Bill a booking, order, or catering job to get started.",
    };
  }

  return {
    archetypeCategory: normalized,
    subtype: null,
    mode: "standard",
    headline: "Finance",
    subhead: "Run cash, receivables, payables, and close work from one place.",
    moneyJobs: [],
    invoiceEntryPoints: [],
    advancedSections: [],
    primaryActionLabel: "New Invoice",
    entryPointSectionLabel: "Start a bill",
    advancedSectionLabel: "Accounting & admin",
    advancedSectionDescription: "Accounting and back-office detail.",
    navigationLabels: { revenue: "Revenue", spend: "Spend", close: "Close", configuration: "Configuration" },
    recentRecordsLabel: "Recent Invoices",
    recentRecordsEmpty: "No invoices yet. Create your first invoice to get started.",
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
// archetype so a restaurant, caterer, or bakery sees its own wording instead.

export type FinanceInvoiceContext =
  | "booking"
  | "order"
  | "catering"
  | "private-event"
  | "no-show"
  | "quote"
  | "event-deposit"
  | "event-balance"
  | "custom-order"
  | "counter-sale"
  | "delivery"
  | "donation"
  | "grant"
  | "sponsorship";

export type FinanceInvoiceCopy = {
  /** Subhead under the "New Invoice" heading. */
  newInvoiceSubhead: string;
  /** Helper line under "require signature before payment". */
  signatureHint: string;
  /** Label for the account/customer picker. */
  customerLabel: string;
  /**
   * Per-entry-point framing shown when the form is opened with ?from=<context>.
   * Partial: an unmapped context falls back to the generic heading + subhead.
   */
  contexts: Partial<Record<FinanceInvoiceContext, { title: string; description: string }>>;
};

const PROFESSIONAL_INVOICE_COPY: FinanceInvoiceCopy = {
  newInvoiceSubhead: "Create a draft invoice to send to a customer.",
  signatureHint:
    "The customer signs on the payment page before they can pay. Recommended for engagement letters and service agreements.",
  customerLabel: "Customer",
  contexts: {},
};

const SHARED_FOOD_CONTEXTS: FinanceInvoiceCopy["contexts"] = {
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
};

const INVOICE_COPY_BY_SUBTYPE: Record<FoodHospitalitySubtype, FinanceInvoiceCopy> = {
  restaurant: {
    newInvoiceSubhead: "Bill a booking, order, catering job, or private event.",
    signatureHint:
      "The guest signs on the payment page before they can pay. Useful for catering and private-event agreements where you want sign-off before the deposit.",
    customerLabel: "Guest or customer",
    contexts: SHARED_FOOD_CONTEXTS,
  },

  catering: {
    newInvoiceSubhead: "Quote a job, take the deposit that secures the date, or bill the balance.",
    signatureHint:
      "The client signs on the payment page before they can pay. Useful for wedding and corporate event agreements where you want sign-off before the deposit.",
    customerLabel: "Client",
    contexts: {
      ...SHARED_FOOD_CONTEXTS,
      quote: {
        title: "Catering quote",
        description: "Price the job before it is confirmed — nothing is owed until the client accepts.",
      },
      "event-deposit": {
        title: "Event deposit",
        description: "Take the deposit that secures the date in your diary.",
      },
      "event-balance": {
        title: "Event balance",
        description: "Bill the remaining balance now the event has been delivered.",
      },
    },
  },

  bakery: {
    newInvoiceSubhead: "Bill a custom order, a counter sale, or a pickup and delivery fee.",
    signatureHint:
      "The customer signs on the payment page before they can pay. Useful for wedding-cake orders where you want sign-off before the deposit.",
    customerLabel: "Customer",
    contexts: {
      ...SHARED_FOOD_CONTEXTS,
      "custom-order": {
        title: "Custom order invoice",
        description: "Bill a celebration or wedding cake — deposit up front, balance on collection.",
      },
      "counter-sale": {
        title: "Counter sale",
        description: "Record a standard over-the-counter sale.",
      },
      delivery: {
        title: "Pickup or delivery fee",
        description: "Add a pickup or delivery charge to an order.",
      },
    },
  },

  generic: {
    newInvoiceSubhead: "Bill an order, booking, or event.",
    signatureHint:
      "The customer signs on the payment page before they can pay. Useful for event and catering agreements where you want sign-off before the deposit.",
    customerLabel: "Customer",
    contexts: SHARED_FOOD_CONTEXTS,
  },
};

export function resolveFinanceInvoiceCopy(
  category: string | null | undefined,
  archetypeId?: string | null,
): FinanceInvoiceCopy {
  if (["pet-rescue", "animal-shelter"].includes((archetypeId ?? "").toLowerCase())) {
    return {
      newInvoiceSubhead: "Record a contribution, grant, or sponsorship supporting animal care.",
      signatureHint: "The supporter or funder can acknowledge the contribution before payment.",
      customerLabel: "Supporter or funder",
      contexts: {
        donation: {
          title: "Record a donation",
          description: "Record a donation from an individual or community supporter.",
        },
        grant: {
          title: "Record a grant",
          description: "Record awarded grant funding and its expected payment.",
        },
        sponsorship: {
          title: "Record a sponsorship",
          description: "Record sponsorship for an animal or rescue programme.",
        },
      },
    };
  }
  if (!isOwnerFirstFinanceCategory(category)) return PROFESSIONAL_INVOICE_COPY;
  return INVOICE_COPY_BY_SUBTYPE[resolveFoodHospitalitySubtype(archetypeId)];
}

const FINANCE_INVOICE_CONTEXTS: ReadonlySet<string> = new Set<FinanceInvoiceContext>([
  "booking",
  "order",
  "catering",
  "private-event",
  "no-show",
  "quote",
  "event-deposit",
  "event-balance",
  "custom-order",
  "counter-sale",
  "delivery",
  "donation",
  "grant",
  "sponsorship",
]);

export function isFinanceInvoiceContext(
  value: string | null | undefined,
): value is FinanceInvoiceContext {
  return value != null && FINANCE_INVOICE_CONTEXTS.has(value);
}
