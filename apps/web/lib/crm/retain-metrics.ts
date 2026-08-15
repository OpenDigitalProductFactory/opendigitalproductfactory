// Pure utility — instruments the recurring "retain" stage (BI-A72D29BE / EP-VSL-SURFACE):
// MRR/ARR rollup from active recurring commitments, and a per-account health / churn-risk
// signal that feeds the account grammar's `active`-stage `at_risk` state. No server imports.
//
// Two recurring sources exist and use slightly different period spellings:
//   - Subscription.billingCadence: monthly | quarterly | annual  (totalValue is per period)
//   - RecurringSchedule.frequency: weekly | biweekly | monthly | quarterly | annually
// Both normalise to a monthly-recurring figure here.

/** Months represented by one period of a given cadence/frequency term. */
const MONTHS_PER_PERIOD: Record<string, number> = {
  weekly: 12 / 52,
  biweekly: 12 / 26,
  monthly: 1,
  quarterly: 3,
  annual: 12,
  annually: 12,
  yearly: 12,
};

/** Normalise a per-period amount to its monthly-recurring contribution. Unknown terms → monthly. */
export function monthlyRecurringValue(amountPerPeriod: number, term: string): number {
  const months = MONTHS_PER_PERIOD[term] ?? 1;
  if (!Number.isFinite(amountPerPeriod) || amountPerPeriod <= 0 || months <= 0) return 0;
  return amountPerPeriod / months;
}

export type RecurringSubscriptionInput = {
  id?: string;
  status: string;
  billingCadence: string;
  totalValue: number;
};
export type RecurringScheduleInput = {
  status: string;
  frequency: string;
  amount: number;
  /** The Subscription this schedule renews, when linked. */
  subscriptionId?: string | null;
};

/**
 * Monthly Recurring Revenue from ACTIVE recurring commitments. A RecurringSchedule is the
 * invoicing engine's finer-grained truth, so it SUPERSEDES only the specific Subscription it
 * renews (via subscriptionId) — not every subscription on the account. MRR = all active schedules
 * + every active subscription that has no active schedule covering it. This avoids both
 * double-counting a scheduled contract and dropping a standalone add-on subscription.
 */
export function computeMrr(input: {
  subscriptions: readonly RecurringSubscriptionInput[];
  schedules: readonly RecurringScheduleInput[];
}): number {
  const activeSchedules = input.schedules.filter((s) => s.status === "active");
  const coveredSubscriptionIds = new Set(
    activeSchedules.map((s) => s.subscriptionId).filter((id): id is string => Boolean(id)),
  );
  const scheduleMrr = activeSchedules.reduce(
    (sum, s) => sum + monthlyRecurringValue(Number(s.amount), s.frequency),
    0,
  );
  const uncoveredSubscriptionMrr = input.subscriptions
    .filter((s) => s.status === "active" && !(s.id && coveredSubscriptionIds.has(s.id)))
    .reduce((sum, s) => sum + monthlyRecurringValue(Number(s.totalValue), s.billingCadence), 0);
  return scheduleMrr + uncoveredSubscriptionMrr;
}

/** Annual Recurring Revenue = MRR × 12. */
export function computeArr(mrr: number): number {
  return mrr * 12;
}

// ─── Customer health / churn-risk ─────────────────────────────────────────────────────

export const HEALTH_BANDS = ["healthy", "watch", "at-risk"] as const;
export type HealthBand = (typeof HEALTH_BANDS)[number];

export type AccountHealthInput = {
  /** Current stored account status (active / at_risk / suspended / …). */
  status: string;
  /** Days until the next renewal (negative = overdue); null when no renewal is known. */
  renewalInDays: number | null;
  /** Whether the contract auto-renews. */
  autoRenew: boolean;
  /** Days since the last recorded engagement/activity; null when never engaged. */
  lastActivityInDays: number | null;
  /** Whether the account has any active recurring commitment. */
  hasActiveRecurring: boolean;
};

export type AccountHealthResult = {
  band: HealthBand;
  reasons: string[];
  /** True when the signal recommends the account be moved to the `at_risk` state. */
  suggestAtRisk: boolean;
};

const RENEWAL_AT_RISK_DAYS = 30;
const RENEWAL_WATCH_DAYS = 60;
const ACTIVITY_AT_RISK_DAYS = 90;
const ACTIVITY_WATCH_DAYS = 45;

/**
 * Assess an active account's churn risk from renewal proximity, auto-renew, engagement recency,
 * and recurring-commitment presence. Deterministic and side-effect free — the caller decides
 * whether to prompt an at_risk transition (kept human-in-the-loop, never auto-applied).
 */
export function assessAccountHealth(input: AccountHealthInput): AccountHealthResult {
  const reasons: string[] = [];

  // An already-flagged status is authoritative.
  if (input.status === "at_risk") return { band: "at-risk", reasons: ["Account is flagged at risk"], suggestAtRisk: false };
  if (input.status === "suspended") return { band: "at-risk", reasons: ["Account is suspended"], suggestAtRisk: false };

  // Track severity numerically (0 healthy · 1 watch · 2 at-risk) so escalation composes without
  // control-flow narrowing pitfalls; map to a band at the end.
  const BANDS: HealthBand[] = ["healthy", "watch", "at-risk"];
  let severity = 0;
  const escalate = (to: number) => {
    severity = Math.max(severity, to);
  };

  if (input.renewalInDays !== null) {
    if (input.renewalInDays < 0) {
      escalate(2);
      reasons.push("Renewal is overdue");
    } else if (input.renewalInDays <= RENEWAL_AT_RISK_DAYS && !input.autoRenew) {
      escalate(2);
      reasons.push(`Manual renewal due in ${input.renewalInDays} days`);
    } else if (input.renewalInDays <= RENEWAL_WATCH_DAYS) {
      escalate(1);
      reasons.push(`Renewal within ${RENEWAL_WATCH_DAYS} days`);
    }
  }

  if (input.lastActivityInDays !== null) {
    if (input.lastActivityInDays >= ACTIVITY_AT_RISK_DAYS) {
      escalate(2);
      reasons.push(`No engagement for ${input.lastActivityInDays} days`);
    } else if (input.lastActivityInDays >= ACTIVITY_WATCH_DAYS) {
      escalate(1);
      reasons.push(`Low engagement (${input.lastActivityInDays} days)`);
    }
  }

  if (!input.hasActiveRecurring) {
    escalate(1);
    reasons.push("No active recurring commitment");
  }

  const band = BANDS[severity];
  if (band === "healthy") reasons.push("On track");
  // Only prompt a transition when the account is genuinely active (not already flagged).
  return { band, reasons, suggestAtRisk: band === "at-risk" && input.status === "active" };
}
