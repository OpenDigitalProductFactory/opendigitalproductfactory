// Server data layer for retain-stage instrumentation (BI-A72D29BE). Reads live recurring
// commitments + engagement recency and rolls them up through the pure retain-metrics helpers.
// Bounded queries only (a handful of aggregates over active accounts — no per-account N+1).

import { prisma } from "@dpf/db";
import { EXCLUDE_TOMBSTONED } from "@dpf/db/customer-lifecycle";
import {
  assessAccountHealth,
  computeArr,
  computeMrr,
  type HealthBand,
} from "./retain-metrics";

const DAY_MS = 86_400_000;
/** Account statuses that occupy the recurring back-half (OVSM retain), where MRR/health apply. */
const RETAIN_STATUSES = ["onboarding", "active", "at_risk", "suspended"];

function daysUntil(date: Date | null, now: number): number | null {
  if (!date) return null;
  return Math.round((date.getTime() - now) / DAY_MS);
}
function daysSince(date: Date | null, now: number): number | null {
  if (!date) return null;
  return Math.round((now - date.getTime()) / DAY_MS);
}

export type WorkspaceRetainMetrics = {
  mrr: number;
  arr: number;
  activeRecurringAccounts: number;
  healthCounts: Record<HealthBand, number>;
  /** Active accounts the signal flags for churn-risk OUTREACH (excludes already at_risk/suspended). */
  churnRiskOutreachCount: number;
};

/** The next renewal date + whether THAT subscription auto-renews (not "any sub auto-renews"). */
function nextRenewalOf(subs: readonly { renewalDate: Date | null; autoRenew: boolean }[]): {
  date: Date | null;
  autoRenew: boolean;
} {
  const soonest = subs
    .filter((s): s is { renewalDate: Date; autoRenew: boolean } => s.renewalDate != null)
    .sort((a, b) => a.renewalDate.getTime() - b.renewalDate.getTime())[0];
  return { date: soonest?.renewalDate ?? null, autoRenew: soonest?.autoRenew ?? true };
}

/**
 * Workspace retain rollup: MRR/ARR from active recurring commitments and a health-band tally
 * over retain-stage accounts. Four bounded queries, joined in memory.
 */
export async function getWorkspaceRetainMetrics(): Promise<WorkspaceRetainMetrics> {
  const now = Date.now();
  const [accounts, subscriptions, schedules, lastActivity] = await Promise.all([
    prisma.customerAccount.findMany({
      where: { ...EXCLUDE_TOMBSTONED, status: { in: RETAIN_STATUSES } },
      select: { id: true, status: true },
    }),
    prisma.subscription.findMany({
      where: { status: "active" },
      select: { id: true, accountId: true, status: true, billingCadence: true, totalValue: true, renewalDate: true, autoRenew: true },
    }),
    prisma.recurringSchedule.findMany({
      where: { status: "active" },
      select: { accountId: true, status: true, frequency: true, amount: true, subscriptionId: true },
    }),
    prisma.activity.groupBy({ by: ["accountId"], _max: { createdAt: true } }),
  ]);

  const subsByAccount = new Map<string, typeof subscriptions>();
  for (const s of subscriptions) {
    if (!s.accountId) continue;
    (subsByAccount.get(s.accountId) ?? subsByAccount.set(s.accountId, []).get(s.accountId)!).push(s);
  }
  const schedByAccount = new Map<string, typeof schedules>();
  for (const s of schedules) {
    if (!s.accountId) continue;
    (schedByAccount.get(s.accountId) ?? schedByAccount.set(s.accountId, []).get(s.accountId)!).push(s);
  }
  const lastActivityByAccount = new Map<string, Date | null>();
  for (const row of lastActivity) {
    if (row.accountId) lastActivityByAccount.set(row.accountId, row._max.createdAt ?? null);
  }

  let mrr = 0;
  let activeRecurringAccounts = 0;
  let churnRiskOutreachCount = 0;
  const healthCounts: Record<HealthBand, number> = { healthy: 0, watch: 0, "at-risk": 0 };

  for (const account of accounts) {
    const subs = subsByAccount.get(account.id) ?? [];
    const scheds = schedByAccount.get(account.id) ?? [];
    mrr += computeMrr({
      subscriptions: subs.map((s) => ({ id: s.id, status: s.status, billingCadence: s.billingCadence, totalValue: Number(s.totalValue) })),
      schedules: scheds.map((s) => ({ status: s.status, frequency: s.frequency, amount: Number(s.amount), subscriptionId: s.subscriptionId })),
    });
    const hasActiveRecurring = subs.length > 0 || scheds.length > 0;
    if (hasActiveRecurring) activeRecurringAccounts += 1;

    const renewal = nextRenewalOf(subs);
    const health = assessAccountHealth({
      status: account.status,
      renewalInDays: daysUntil(renewal.date, now),
      autoRenew: renewal.autoRenew,
      lastActivityInDays: daysSince(lastActivityByAccount.get(account.id) ?? null, now),
      hasActiveRecurring,
    });
    healthCounts[health.band] += 1;
    if (health.suggestAtRisk) churnRiskOutreachCount += 1;
  }

  return { mrr, arr: computeArr(mrr), activeRecurringAccounts, healthCounts, churnRiskOutreachCount };
}

export type AccountRetainSnapshot = {
  mrr: number;
  arr: number;
  currency: string;
  hasActiveRecurring: boolean;
  nextRenewal: Date | null;
  renewalInDays: number | null;
  health: ReturnType<typeof assessAccountHealth>;
};

/** Per-account retain snapshot for the account detail page. Targeted single-account queries. */
export async function getAccountRetainSnapshot(accountId: string): Promise<AccountRetainSnapshot> {
  const now = Date.now();
  const [account, subs, scheds, lastActivity] = await Promise.all([
    prisma.customerAccount.findUnique({ where: { id: accountId }, select: { status: true, currency: true } }),
    prisma.subscription.findMany({
      where: { accountId, status: "active" },
      select: { id: true, status: true, billingCadence: true, totalValue: true, renewalDate: true, autoRenew: true },
    }),
    prisma.recurringSchedule.findMany({
      where: { accountId, status: "active" },
      select: { status: true, frequency: true, amount: true, subscriptionId: true },
    }),
    prisma.activity.aggregate({ where: { accountId }, _max: { createdAt: true } }),
  ]);

  const mrr = computeMrr({
    subscriptions: subs.map((s) => ({ id: s.id, status: s.status, billingCadence: s.billingCadence, totalValue: Number(s.totalValue) })),
    schedules: scheds.map((s) => ({ status: s.status, frequency: s.frequency, amount: Number(s.amount), subscriptionId: s.subscriptionId })),
  });
  const hasActiveRecurring = subs.length > 0 || scheds.length > 0;
  const renewal = nextRenewalOf(subs);
  const renewalInDays = daysUntil(renewal.date, now);

  const health = assessAccountHealth({
    status: account?.status ?? "active",
    renewalInDays,
    autoRenew: renewal.autoRenew,
    lastActivityInDays: daysSince(lastActivity._max.createdAt ?? null, now),
    hasActiveRecurring,
  });

  return { mrr, arr: computeArr(mrr), currency: account?.currency ?? "USD", hasActiveRecurring, nextRenewal: renewal.date, renewalInDays, health };
}
