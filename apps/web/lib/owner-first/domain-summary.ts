// apps/web/lib/owner-first/domain-summary.ts
//
// Pure owner-first summary builders (BI-3BCAF95F, EP-UX-COGLOAD). Each major
// business-domain page must OPEN with the owner's daily job: what needs action
// today, why it matters, and the safest next action — before any CRM / HR /
// accountant / platform structure. These builders take the counts a page already
// fetches and project them into an ordered, owner-language action list. No DB and
// no React here, so the shape is unit-testable and the UX checks can run against
// the rendered output deterministically.

import type { OwnerDomainVocabulary } from "./vocabulary";

export type OwnerFirstDomain = "workspace" | "customer" | "employee" | "finance";

/** Urgency tone — drives colour, and orders the list (urgent first). */
export type OwnerFirstTone = "urgent" | "attention" | "info" | "calm";

const TONE_RANK: Record<OwnerFirstTone, number> = {
  urgent: 0,
  attention: 1,
  info: 2,
  calm: 3,
};

export type OwnerFirstAction = {
  id: string;
  /** What needs action today, in owner language (carries the count). */
  title: string;
  /** Why it matters — the one-line consequence, owner language. */
  why: string;
  /** The single safest next action. */
  nextAction: { label: string; href: string };
  tone: OwnerFirstTone;
};

export type OwnerFirstSummary = {
  domain: OwnerFirstDomain;
  /** The owner-language heading for the whole surface. */
  headline: string;
  /** One line of context under the heading. */
  subhead: string;
  /** Ordered most-urgent first; empty when nothing needs the owner today. */
  actions: OwnerFirstAction[];
  /** Shown when `actions` is empty — always explains WHY it is clear. */
  clearMessage: string;
};

/** Order most-urgent first, stable within a tone. */
function orderActions(actions: OwnerFirstAction[]): OwnerFirstAction[] {
  return actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => TONE_RANK[x.a.tone] - TONE_RANK[y.a.tone] || x.i - y.i)
    .map(({ a }) => a);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// ─── Customer / guest follow-up ──────────────────────────────────────────────

export type CustomerSummaryInput = {
  pendingReservations: number;
  pendingOrders: number;
  newInquiries: number;
  unworkedEngagements: number;
  overdueInvoices: number;
  renewalsDueSoon: number;
};

export function buildCustomerOwnerSummary(
  input: CustomerSummaryInput,
  vocab: OwnerDomainVocabulary,
): OwnerFirstSummary {
  const actions: OwnerFirstAction[] = [];

  if (input.pendingReservations > 0) {
    const n = input.pendingReservations;
    actions.push({
      id: "reservations",
      title: `${n} ${plural(n, vocab.reservationsLabel.replace(/s$/, ""), vocab.reservationsLabel)} to confirm`,
      why: `${plural(n, "A guest is", "Guests are")} waiting to hear their ${plural(n, "table", "tables")} ${plural(n, "is", "are")} held.`,
      nextAction: { label: "Review reservations", href: "/customer/funnel" },
      tone: "urgent",
    });
  }

  if (input.pendingOrders > 0) {
    const n = input.pendingOrders;
    actions.push({
      id: "orders",
      title: `${n} ${plural(n, vocab.ordersLabel.replace(/s$/, ""), vocab.ordersLabel)} to fulfil`,
      why: `${plural(n, "An order is", "Orders are")} placed and waiting to be actioned.`,
      nextAction: { label: "Review orders", href: "/customer/funnel" },
      tone: "attention",
    });
  }

  if (input.newInquiries > 0) {
    const n = input.newInquiries;
    actions.push({
      id: "inquiries",
      title: `${n} new ${plural(n, vocab.inquiriesLabel.replace(/ies$/, "y"), vocab.inquiriesLabel)} to answer`,
      why: `${plural(n, "Someone reached", "People reached")} out and ${plural(n, "has", "have")} not had a reply.`,
      nextAction: { label: "Open inquiries", href: "/customer/funnel" },
      tone: "attention",
    });
  }

  if (input.unworkedEngagements > 0) {
    const n = input.unworkedEngagements;
    actions.push({
      id: "engagements",
      title: `${n} ${vocab.guestsLabel} to follow up`,
      why: `${plural(n, "A guest has", "Guests have")} an open conversation with no next step logged.`,
      nextAction: { label: "Open follow-ups", href: "/customer" },
      tone: "info",
    });
  }

  if (input.overdueInvoices > 0) {
    const n = input.overdueInvoices;
    actions.push({
      id: "overdue",
      title: `${n} overdue ${plural(n, vocab.invoicesLabel.replace(/s$/, ""), vocab.invoicesLabel)} to chase`,
      why: "Money you have earned has not arrived yet.",
      nextAction: { label: "See who owes you", href: "/finance/reports/aged-debtors" },
      tone: "info",
    });
  }

  return {
    domain: "customer",
    headline: vocab.guestFollowUpLabel,
    subhead: vocab.customerSummarySubhead,
    actions: orderActions(actions),
    clearMessage: `No ${vocab.guestsLabel} are waiting on a reply right now. New ${vocab.reservationsLabel} and ${vocab.inquiriesLabel} will appear here first.`,
  };
}

// ─── Employee / service staffing ─────────────────────────────────────────────

export type EmployeeSummaryInput = {
  submittedTimesheets: number;
  teamSize: number;
  unassignedRoles: number;
};

export function buildEmployeeOwnerSummary(
  input: EmployeeSummaryInput,
  vocab: OwnerDomainVocabulary,
): OwnerFirstSummary {
  const actions: OwnerFirstAction[] = [];

  if (input.submittedTimesheets > 0) {
    const n = input.submittedTimesheets;
    actions.push({
      id: "timesheets",
      title: `${n} ${vocab.timesheetLabel} ${plural(n, "sheet", "sheets")} to approve`,
      why: `Your ${vocab.staffLabel} cannot be paid until ${plural(n, "this is", "these are")} approved.`,
      nextAction: { label: "Approve hours", href: "/employee?view=timesheets" },
      tone: "attention",
    });
  }

  if (input.unassignedRoles > 0) {
    const n = input.unassignedRoles;
    actions.push({
      id: "coverage",
      title: `${n} ${plural(n, "role has", "roles have")} nobody assigned`,
      why: "A gap in coverage means work has no owner for the next service.",
      nextAction: { label: "Check coverage", href: "/employee?view=workforce" },
      tone: "info",
    });
  }

  return {
    domain: "employee",
    headline: vocab.serviceReadinessLabel,
    subhead: vocab.isRestaurant
      ? `Who is on and what needs sign-off before the next service — ${vocab.staffLabel} of ${input.teamSize}.`
      : `Who is on and what needs sign-off — ${vocab.staffLabel} of ${input.teamSize}.`,
    actions: orderActions(actions),
    clearMessage: `Your ${vocab.staffLabel} are set for the next service. Role governance and the directory are below.`,
  };
}

// ─── Finance / bills, deposits, invoices ─────────────────────────────────────

export type FinanceSummaryInput = {
  billsDue: number;
  overdueInvoices: number;
  pendingExpenses: number;
  oldestOverdueName: string | null;
  currencySymbol: string;
  moneyOwedToYou: number;
};

function formatMoney(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

export function buildFinanceOwnerSummary(
  input: FinanceSummaryInput,
  vocab: OwnerDomainVocabulary,
): OwnerFirstSummary {
  const actions: OwnerFirstAction[] = [];

  if (input.billsDue > 0) {
    const n = input.billsDue;
    actions.push({
      id: "bills",
      title: `${n} ${plural(n, vocab.billsLabel.replace(/s$/, ""), vocab.billsLabel)} to pay`,
      why: "Suppliers are waiting to be paid for what you have already received.",
      nextAction: { label: "Review bills", href: "/finance/bills" },
      tone: "urgent",
    });
  }

  if (input.overdueInvoices > 0) {
    const n = input.overdueInvoices;
    const who = input.oldestOverdueName ? ` Oldest: ${input.oldestOverdueName}.` : "";
    actions.push({
      id: "collect",
      title: `${n} overdue ${plural(n, vocab.invoicesLabel.replace(/s$/, ""), vocab.invoicesLabel)} to collect`,
      why: `${formatMoney(input.moneyOwedToYou, input.currencySymbol)} is owed to you.${who}`,
      nextAction: { label: "See who owes you", href: "/finance/reports/aged-debtors" },
      tone: "attention",
    });
  }

  if (input.pendingExpenses > 0) {
    const n = input.pendingExpenses;
    actions.push({
      id: "expenses",
      title: `${n} expense ${plural(n, "claim", "claims")} to approve`,
      why: `Your ${vocab.staffLabel} are waiting to be reimbursed.`,
      nextAction: { label: "Approve claims", href: "/finance/expense-claims?status=submitted" },
      tone: "info",
    });
  }

  return {
    domain: "finance",
    headline: "Money today",
    subhead: vocab.isRestaurant
      ? `What must be paid, collected, or approved — ${vocab.billsLabel}, ${vocab.depositsLabel}, and ${vocab.invoicesLabel}.`
      : "What must be paid, collected, or approved today.",
    actions: orderActions(actions),
    clearMessage:
      "Nothing needs paying, collecting, or approving today. The full finance workspace is below.",
  };
}

// ─── Workspace / storefront reconciliation ───────────────────────────────────
//
// Storefront bookings and inquiries are real owner work, but the workspace home
// only surfaced them indirectly (a `RESERVATIONS 0` rail chip) while generic
// coworker decisions took the top cards. This projects the pending storefront
// signals into the SAME owner-first shape so they render BEFORE the generic
// cockpit decisions (BI-3BCAF95F acceptance: reconcile storefront/funnel signals
// before generic coworker decisions).

export type WorkspaceStorefrontInput = {
  pendingReservations: number;
  pendingOrders: number;
  newInquiries: number;
};

export function buildWorkspaceStorefrontSummary(
  input: WorkspaceStorefrontInput,
  vocab: OwnerDomainVocabulary,
): OwnerFirstSummary {
  const summary = buildCustomerOwnerSummary(
    {
      pendingReservations: input.pendingReservations,
      pendingOrders: input.pendingOrders,
      newInquiries: input.newInquiries,
      unworkedEngagements: 0,
      overdueInvoices: 0,
      renewalsDueSoon: 0,
    },
    vocab,
  );
  return {
    ...summary,
    domain: "workspace",
    headline: vocab.inboundHeadline,
    subhead: vocab.inboundSubhead,
  };
}

/** True when the summary has at least one owner-first next action. */
export function hasOwnerFirstAction(summary: OwnerFirstSummary): boolean {
  return summary.actions.length > 0;
}
