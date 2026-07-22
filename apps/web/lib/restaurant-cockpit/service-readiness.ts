// apps/web/lib/restaurant-cockpit/service-readiness.ts
//
// The Restaurant owner's first daily answer: "Are we ready for the next service
// period, and what exactly needs me?" This is the single, pure, DB-free place
// that decides readiness severity, owner-readable copy, and the one exact next
// action. It is total and deterministic so the whole cockpit is unit-testable
// without a runtime (BI-075F731F).
//
// Vocabulary is INJECTED (never hardcoded) so the same model serves any archetype
// via getVocabulary(); the restaurant install passes food-hospitality nouns
// (Reservations / Guests / Staff / Venue Portal).
//
// This model deliberately does NOT reconcile into the /workspace attention
// surface (owned by BI-348766E5 / PR #3403) nor read the storefront reservation
// exception source (BI-3DA1DFDC / PR #3387). It is a read/compose surface.

export type ReadinessLevel = "ready" | "attention" | "blocked";

export type ReadinessSignalKey =
  | "demand"
  | "service-load"
  | "tables"
  | "staffing"
  | "finance";

/** Owner nouns the model renders with. Derived from getVocabulary() by the loader. */
export interface ReadinessVocabulary {
  /** e.g. "Reservations" (food-hospitality inboxLabel) */
  inboxLabel: string;
  /** e.g. "Guests" (stakeholderLabel) */
  stakeholderLabel: string;
  /** e.g. "Staff" (teamLabel) */
  teamLabel: string;
  /** e.g. "Venue Portal" (portalLabel) — used only in the technical block */
  portalLabel: string;
  /** Resource noun for the capacity signal, e.g. "Tables & capacity". */
  resourceLabel: string;
}

export interface ReadinessSignal {
  key: ReadinessSignalKey;
  /** Owner-readable heading, e.g. "New reservations & enquiries". */
  label: string;
  level: ReadinessLevel;
  /** One owner-readable line, e.g. "3 reservations waiting for you to confirm". */
  summary: string;
  /** Secondary line — hidden in Simple mode. */
  detail?: string;
  /** Drill-down link. */
  href: string;
  /** Optional action label for the drill-down. */
  actionLabel?: string;
}

export interface OwnerNextAction {
  /** e.g. "Confirm 3 reservations for the next service". */
  label: string;
  href: string;
  /** Why it matters, one owner-readable line. */
  why: string;
}

export interface ServiceReadinessSummary {
  /** e.g. "3 things need you before the next service" / "You're ready for the next service". */
  headline: string;
  level: ReadinessLevel;
  /** e.g. "the next service period" / "today's service". */
  servicePeriodLabel: string;
  /** Count of signals at attention or blocked. */
  needsYouCount: number;
  signals: ReadinessSignal[];
  nextAction: OwnerNextAction | null;
  /** Raw figures for progressive disclosure — never shown in Simple mode. */
  technical: { label: string; value: string }[];
}

export interface ServiceReadinessInput {
  vocabulary: ReadinessVocabulary;
  demand: {
    /** Inquiries with an unresolved status. */
    pendingInquiries: number;
    /** Bookings awaiting owner confirmation. */
    unconfirmedBookings: number;
  };
  serviceLoad: {
    /** Confirmed bookings scheduled for the upcoming service window. */
    confirmedUpcoming: number;
    /** Bookings scheduled within today (the "next service period" hint). */
    scheduledToday: number;
  };
  resources: {
    /** Bookable resources set up (tables, rooms, providers). */
    count: number;
    /** Operating hours confirmed. */
    operatingHoursConfigured: boolean;
  };
  staffing: {
    /** Active team members / providers on the roster. */
    rostered: number;
  };
  finance: {
    /** Supplier bills approved and awaiting payment. */
    billsDue: number;
    /** Invoices past their due date. */
    overdueInvoices: number;
  };
}

const HEADLINE_READY = "You're ready for the next service";

function worst(a: ReadinessLevel, b: ReadinessLevel): ReadinessLevel {
  const rank: Record<ReadinessLevel, number> = { ready: 0, attention: 1, blocked: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Derive the owner-readable service-readiness summary. Pure and total: given the
 * same input it always returns the same summary, with no I/O.
 */
export function deriveServiceReadiness(
  input: ServiceReadinessInput,
): ServiceReadinessSummary {
  const { vocabulary: v, demand, serviceLoad, resources, staffing, finance } = input;
  const reservationsWord = v.inboxLabel.toLowerCase();

  const signals: ReadinessSignal[] = [];

  // 1. Pending customer demand ------------------------------------------------
  {
    const total = demand.pendingInquiries + demand.unconfirmedBookings;
    const level: ReadinessLevel = total > 0 ? "attention" : "ready";
    const parts: string[] = [];
    if (demand.unconfirmedBookings > 0) {
      parts.push(`${plural(demand.unconfirmedBookings, reservationsWord, reservationsWord)} to confirm`);
    }
    if (demand.pendingInquiries > 0) {
      parts.push(`${plural(demand.pendingInquiries, "new enquiry", "new enquiries")} to answer`);
    }
    signals.push({
      key: "demand",
      label: `New ${reservationsWord} & enquiries`,
      level,
      summary:
        total > 0
          ? parts.join(" · ")
          : `No new ${reservationsWord} or enquiries waiting`,
      detail:
        total > 0
          ? `From ${v.stakeholderLabel.toLowerCase()} who reached out through your ${v.portalLabel.toLowerCase()}.`
          : undefined,
      href: "/storefront/inbox",
      actionLabel: total > 0 ? `Open ${v.inboxLabel}` : undefined,
    });
  }

  // 2. Confirmed service load -------------------------------------------------
  {
    const level: ReadinessLevel = "ready";
    const summary =
      serviceLoad.scheduledToday > 0
        ? `${plural(serviceLoad.scheduledToday, reservationsWord, reservationsWord)} booked in for today`
        : serviceLoad.confirmedUpcoming > 0
          ? `${plural(serviceLoad.confirmedUpcoming, reservationsWord, reservationsWord)} confirmed coming up`
          : `No confirmed ${reservationsWord} yet`;
    signals.push({
      key: "service-load",
      label: `Confirmed ${reservationsWord}`,
      level,
      summary,
      detail:
        serviceLoad.confirmedUpcoming > 0
          ? `${plural(serviceLoad.confirmedUpcoming, reservationsWord, reservationsWord)} confirmed across upcoming services.`
          : undefined,
      href: "/storefront/inbox",
    });
  }

  // 3. Tables & capacity ------------------------------------------------------
  {
    const configured = resources.count > 0 && resources.operatingHoursConfigured;
    const level: ReadinessLevel = configured
      ? "ready"
      : resources.count === 0
        ? "blocked"
        : "attention";
    let summary: string;
    if (resources.count === 0) {
      summary = `No ${v.resourceLabel.toLowerCase()} set up yet`;
    } else if (!resources.operatingHoursConfigured) {
      summary = `${plural(resources.count, v.resourceLabel.replace(/ &.*/, "").toLowerCase(), v.resourceLabel.toLowerCase())} ready — opening hours still needed`;
    } else {
      summary = `${plural(resources.count, "space", "spaces")} ready to seat ${v.stakeholderLabel.toLowerCase()}`;
    }
    signals.push({
      key: "tables",
      label: v.resourceLabel,
      level,
      summary,
      href: resources.operatingHoursConfigured
        ? "/storefront/team"
        : "/storefront/settings/operations",
      actionLabel: configured ? undefined : "Finish setup",
    });
  }

  // 4. Staffing readiness -----------------------------------------------------
  {
    const level: ReadinessLevel = staffing.rostered > 0 ? "ready" : "attention";
    signals.push({
      key: "staffing",
      label: `${v.teamLabel} on the roster`,
      level,
      summary:
        staffing.rostered > 0
          ? `${plural(staffing.rostered, "team member", "team members")} set up to work`
          : `No ${v.teamLabel.toLowerCase()} set up yet`,
      detail:
        staffing.rostered > 0
          ? "Check who is covering the next service in People."
          : undefined,
      href: "/employee",
      actionLabel: staffing.rostered > 0 ? "Open People" : `Add ${v.teamLabel}`,
    });
  }

  // 5. Finance exceptions -----------------------------------------------------
  {
    const total = finance.billsDue + finance.overdueInvoices;
    const level: ReadinessLevel =
      finance.overdueInvoices > 0 ? "attention" : finance.billsDue > 0 ? "attention" : "ready";
    const parts: string[] = [];
    if (finance.overdueInvoices > 0) {
      parts.push(`${plural(finance.overdueInvoices, "overdue invoice", "overdue invoices")} to chase`);
    }
    if (finance.billsDue > 0) {
      parts.push(`${plural(finance.billsDue, "supplier bill", "supplier bills")} to pay`);
    }
    signals.push({
      key: "finance",
      label: "Money that needs you",
      level,
      summary: total > 0 ? parts.join(" · ") : "No bills or invoices need you right now",
      detail: total > 0 ? "Draft figures — confirm the detail in your books." : undefined,
      href: finance.overdueInvoices > 0 ? "/finance/reports/aged-debtors" : "/finance/bills",
      actionLabel: total > 0 ? "Open Finance" : undefined,
    });
  }

  // Overall roll-up -----------------------------------------------------------
  const level = signals.reduce<ReadinessLevel>((acc, s) => worst(acc, s.level), "ready");
  const needsYouCount = signals.filter((s) => s.level !== "ready").length;

  const servicePeriodLabel =
    serviceLoad.scheduledToday > 0 ? "today's service" : "the next service period";

  const nextAction = pickNextAction(input, servicePeriodLabel, reservationsWord);

  const headline =
    needsYouCount === 0
      ? `${HEADLINE_READY}`
      : `${plural(needsYouCount, "thing needs", "things need")} you before ${servicePeriodLabel}`;

  const technical: { label: string; value: string }[] = [
    { label: "Unconfirmed bookings", value: String(demand.unconfirmedBookings) },
    { label: "Pending inquiries", value: String(demand.pendingInquiries) },
    { label: "Confirmed upcoming", value: String(serviceLoad.confirmedUpcoming) },
    { label: "Scheduled today", value: String(serviceLoad.scheduledToday) },
    { label: "Bookable resources", value: String(resources.count) },
    { label: "Operating hours configured", value: String(resources.operatingHoursConfigured) },
    { label: "Rostered team", value: String(staffing.rostered) },
    { label: "Bills awaiting payment", value: String(finance.billsDue) },
    { label: "Overdue invoices", value: String(finance.overdueInvoices) },
  ];

  return {
    headline,
    level,
    servicePeriodLabel,
    needsYouCount,
    signals,
    nextAction,
    technical,
  };
}

/**
 * The single most-urgent owner action. Priority reflects service-period risk:
 * unconfirmed reservations first (guests are waiting), then money overdue, then
 * bills to pay, then unanswered enquiries, then setup gaps.
 */
function pickNextAction(
  input: ServiceReadinessInput,
  servicePeriodLabel: string,
  reservationsWord: string,
): OwnerNextAction | null {
  const { demand, resources, staffing, finance, vocabulary: v } = input;

  if (demand.unconfirmedBookings > 0) {
    return {
      label: `Confirm ${plural(demand.unconfirmedBookings, reservationsWord, reservationsWord)} for ${servicePeriodLabel}`,
      href: "/storefront/inbox",
      why: `${v.stakeholderLabel} are waiting to hear back before they arrive.`,
    };
  }
  if (finance.overdueInvoices > 0) {
    return {
      label: `Chase ${plural(finance.overdueInvoices, "overdue invoice", "overdue invoices")}`,
      href: "/finance/reports/aged-debtors",
      why: "This is money already earned that hasn't landed yet.",
    };
  }
  if (finance.billsDue > 0) {
    return {
      label: `Review ${plural(finance.billsDue, "supplier bill", "supplier bills")} to pay`,
      href: "/finance/bills",
      why: "Keep suppliers current so the next service isn't disrupted.",
    };
  }
  if (demand.pendingInquiries > 0) {
    return {
      label: `Answer ${plural(demand.pendingInquiries, "new enquiry", "new enquiries")}`,
      href: "/storefront/inbox",
      why: `A quick reply turns an enquiry into a booked ${reservationsWord.replace(/s$/, "")}.`,
    };
  }
  if (staffing.rostered === 0) {
    return {
      label: `Add your ${v.teamLabel}`,
      href: "/employee",
      why: "You need someone rostered to run the next service.",
    };
  }
  if (resources.count === 0) {
    return {
      label: `Set up ${v.resourceLabel.toLowerCase()}`,
      href: "/storefront/team",
      why: `${v.stakeholderLabel} can't book until there's somewhere to seat them.`,
    };
  }
  if (!resources.operatingHoursConfigured) {
    return {
      label: "Set your opening hours",
      href: "/storefront/settings/operations",
      why: "Bookings follow your hours — confirm them so the next service is takeable.",
    };
  }
  return null;
}

/** Banned generic labels the owner-facing cockpit must never render (UX check). */
export const BANNED_GENERIC_LABELS = [
  "Make this business decision",
  "Make this business decision?",
  "Review this decision",
  "Approve this bill",
  "Approve this bill?",
  "Send this message",
  "Send this message?",
] as const;

/** Builder/technical tokens that must never leak into Simple-mode owner copy. */
export const BUILDER_TOKENS = ["HITL", "SLA", "Epic", "Feature build", "Blast radius"] as const;
