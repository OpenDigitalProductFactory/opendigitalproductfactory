// Loader for the subscription effective-cost estimator (BI-F98BBE4F).
//
// Fee: the active subscription contract that covers the provider, written by
// the "Record AI subscription payment" form (recordAiProviderSubscriptionPayment).
// One fee covers every provider the plan lists, so their usage and limit hits
// are pooled. Usage: TokenUsage. Limit hits: RouteOutcome rate_limit rows.
// Read-only.

import { prisma } from "@dpf/db";
import {
  ESTIMATE_LOOKBACK_DAYS,
  estimateSubscriptionUnitCost,
  mergeWindowObservations,
  monthlyFeeFromContract,
  resetWindowHoursFor,
  type SubscriptionCostEstimate,
} from "./subscription-cost-estimator";

export type SubscriptionPlanEstimate = {
  contractId: string;
  planName: string | null;
  coveredProviderIds: string[];
  currency: string;
  estimate: SubscriptionCostEstimate;
};

type ContractRow = {
  id: string;
  contractId: string;
  notes: string | null;
  currency: string;
  billingCadence: string;
  monthlyCommittedAmount: unknown;
  coveredProviderIds: unknown;
  startDate: Date | null;
};

type ContractReader = { supplierContract: { findMany: (args: object) => Promise<ContractRow[]> } };

/** A subscription contract the business is paying for right now. */
const ACTIVE_SUBSCRIPTION_WHERE = { status: "active", contractType: "subscription", commitmentKind: "ai_provider" } as const;

function providerIdsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

async function activeSubscriptionContracts(database: ContractReader = prisma as unknown as ContractReader): Promise<ContractRow[]> {
  return database.supplierContract.findMany({
    where: ACTIVE_SUBSCRIPTION_WHERE,
    select: { id: true, contractId: true, notes: true, currency: true, billingCadence: true,
      monthlyCommittedAmount: true, coveredProviderIds: true, startDate: true },
    orderBy: { startDate: "desc" },
  });
}

/**
 * Providers covered by an active subscription contract. Their calls cost no
 * extra cash, so the daily paid-AI allowance neither counts nor refuses them;
 * portfolio budgets meter them at the estimate instead (WWMD DI-223FEAA53080).
 */
export async function subscriptionCoveredProviderIds(database?: ContractReader): Promise<string[]> {
  const contracts = await activeSubscriptionContracts(database);
  return [...new Set(contracts.flatMap((c) => providerIdsOf(c.coveredProviderIds)))];
}

async function windowObservations(providerIds: string[], windowHours: number, since: Date) {
  const seconds = windowHours * 3600;
  const [usage, hits, first] = await Promise.all([
    prisma.$queryRaw<Array<{ window: bigint; tokens: bigint | null }>>`
      SELECT floor(extract(epoch from "createdAt") / ${seconds})::bigint AS "window",
             sum("inputTokens" + "outputTokens")::bigint AS "tokens"
      FROM "TokenUsage"
      WHERE "providerId" = ANY(${providerIds}) AND "createdAt" >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ window: bigint; hits: bigint }>>`
      SELECT floor(extract(epoch from "createdAt") / ${seconds})::bigint AS "window", count(*)::bigint AS "hits"
      FROM "RouteOutcome"
      WHERE "providerId" = ANY(${providerIds}) AND "createdAt" >= ${since} AND "providerErrorCode" = 'rate_limit'
      GROUP BY 1`,
    prisma.tokenUsage.findFirst({
      where: { providerId: { in: providerIds }, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    windows: mergeWindowObservations(
      usage.map((r) => ({ window: Number(r.window), tokens: Number(r.tokens ?? 0) })),
      hits.map((r) => ({ window: Number(r.window), hits: Number(r.hits) })),
    ),
    firstObservedAt: first?.createdAt ?? null,
  };
}

async function estimateContract(contract: ContractRow, now: Date): Promise<SubscriptionPlanEstimate> {
  const coveredProviderIds = providerIdsOf(contract.coveredProviderIds);
  const windowHours = resetWindowHoursFor(coveredProviderIds);
  const since = new Date(now.getTime() - ESTIMATE_LOOKBACK_DAYS * 86_400_000);
  const { windows, firstObservedAt } = coveredProviderIds.length
    ? await windowObservations(coveredProviderIds, windowHours, since)
    : { windows: [], firstObservedAt: null };
  const observedDays = firstObservedAt ? (now.getTime() - firstObservedAt.getTime()) / 86_400_000 : 0;
  const amount = contract.monthlyCommittedAmount == null ? null : Number(contract.monthlyCommittedAmount);
  return {
    contractId: contract.contractId,
    planName: contract.notes,
    coveredProviderIds,
    currency: contract.currency,
    estimate: estimateSubscriptionUnitCost({
      monthlyFeeUsd: monthlyFeeFromContract({ monthlyCommittedAmount: amount, billingCadence: contract.billingCadence }),
      currency: contract.currency,
      windowHours,
      observedDays,
      windows,
    }),
  };
}

/** Every active subscription plan with its effective-cost estimate. */
export async function loadSubscriptionCostEstimates(now = new Date()): Promise<SubscriptionPlanEstimate[]> {
  const contracts = await activeSubscriptionContracts();
  return Promise.all(contracts.map((c) => estimateContract(c, now)));
}

const CACHE_TTL_MS = 15 * 60_000;
let cache: { at: number; byProvider: Map<string, SubscriptionCostEstimate> } | null = null;

/**
 * The estimate that prices a call on this provider, or null when no active
 * subscription covers it. Cached briefly: logTokenUsage runs on every call and
 * the estimate moves slowly. The most recent contract wins when two cover the
 * same provider.
 */
export async function subscriptionEstimateForProvider(providerId: string, now = new Date()): Promise<SubscriptionCostEstimate | null> {
  if (!cache || now.getTime() - cache.at > CACHE_TTL_MS) {
    const plans = await loadSubscriptionCostEstimates(now);
    const byProvider = new Map<string, SubscriptionCostEstimate>();
    for (const plan of plans) for (const id of plan.coveredProviderIds) if (!byProvider.has(id)) byProvider.set(id, plan.estimate);
    cache = { at: now.getTime(), byProvider };
  }
  return cache.byProvider.get(providerId) ?? null;
}

/** Test seam. */
export function resetSubscriptionEstimateCache(): void {
  cache = null;
}

/**
 * Active providers recorded at a zero token price (a flat-rate plan) that no
 * active subscription contract covers: their use is still counted at $0 until
 * the owner records the plan's payment.
 */
export async function loadUnpricedSubscriptionProviders(): Promise<Array<{ providerId: string; name: string }>> {
  const [zeroPriced, covered] = await Promise.all([
    prisma.modelProvider.findMany({
      where: { status: "active", costModel: "token", inputPricePerMToken: 0, outputPricePerMToken: 0 },
      select: { providerId: true, name: true },
      orderBy: { name: "asc" },
    }),
    subscriptionCoveredProviderIds(),
  ]);
  const coveredSet = new Set(covered);
  return zeroPriced.filter((p) => !coveredSet.has(p.providerId));
}
