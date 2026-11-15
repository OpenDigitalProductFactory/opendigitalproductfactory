// Loader for the subscription effective-cost estimator (BI-F98BBE4F) and the
// plan's token-equivalent value across installs (BI-6361A930).
//
// Fee: the active subscription contract that covers the provider, written by
// the "Record AI subscription payment" form (recordAiProviderSubscriptionPayment).
// One fee covers every provider the plan lists, so their usage and limit hits
// are pooled. Usage: TokenUsage on this install, plus the paired
// same-organization install's usage pulled over the work-sync link
// (lib/federation/ai-usage-sync.ts). Limit hits: RouteOutcome rate_limit rows.
// List prices: ModelProvider input/output prices. Read-only.

import { prisma } from "@dpf/db";
import {
  ESTIMATE_LOOKBACK_DAYS,
  estimateSubscriptionPlan,
  LIST_PRICE_SIBLING,
  LOCAL_INSTALL,
  monthlyFeeFromContract,
  type InstallUsage,
  type PeerUsageStatus,
  type ProviderTokenPrice,
  type SubscriptionCostEstimate,
  type UsageBucket,
  type UsageCoverage,
  type UsageValuation,
} from "./subscription-cost-estimator";
import {
  parsePeerAiUsageRecord,
  PEER_AI_USAGE_KEY,
  peerUsageFromRecord,
  SAME_ORG_PEER_LINK_WHERE,
} from "@/lib/federation/ai-usage-exchange";

export type SubscriptionPlanEstimate = {
  contractId: string;
  planName: string | null;
  coveredProviderIds: string[];
  currency: string;
  estimate: SubscriptionCostEstimate;
  /** Token-equivalent value at list price and savings (BI-6361A930). */
  value: UsageValuation;
  /** Usage per install, this install first. */
  installs: InstallUsage[];
  /** The paired installs whose usage is (or should be) included. */
  peers: PeerUsageStatus[];
  usageCoverage: UsageCoverage;
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

/**
 * This install's own usage and limit hits per provider and clock hour. Served
 * to the paired install (GET /api/v1/federation/ai-usage) and used for the
 * local half of every plan. Without `providerIds`, every provider.
 */
export async function loadLocalHourlyAiUsage(input: { since: Date; providerIds?: readonly string[] }): Promise<{
  usage: Array<{ providerId: string; hour: number; inputTokens: number; outputTokens: number }>;
  hits: Array<{ providerId: string; hour: number; hits: number }>;
}> {
  const ids = input.providerIds ? [...input.providerIds] : null;
  const [usage, hits] = await Promise.all([
    prisma.$queryRaw<Array<{ providerId: string; hour: bigint; input: bigint | null; output: bigint | null }>>`
      SELECT "providerId", floor(extract(epoch from "createdAt") / 3600)::bigint AS "hour",
             sum("inputTokens")::bigint AS "input", sum("outputTokens")::bigint AS "output"
      FROM "TokenUsage"
      WHERE "createdAt" >= ${input.since} AND (${ids}::text[] IS NULL OR "providerId" = ANY(${ids}::text[]))
      GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ providerId: string; hour: bigint; hits: bigint }>>`
      SELECT "providerId", floor(extract(epoch from "createdAt") / 3600)::bigint AS "hour", count(*)::bigint AS "hits"
      FROM "RouteOutcome"
      WHERE "createdAt" >= ${input.since} AND "providerErrorCode" = 'rate_limit'
        AND (${ids}::text[] IS NULL OR "providerId" = ANY(${ids}::text[]))
      GROUP BY 1, 2`,
  ]);
  return {
    usage: usage.map((r) => ({ providerId: r.providerId, hour: Number(r.hour), inputTokens: Number(r.input ?? 0), outputTokens: Number(r.output ?? 0) })),
    hits: hits.map((r) => ({ providerId: r.providerId, hour: Number(r.hour), hits: Number(r.hits) })),
  };
}

function localBuckets(local: Awaited<ReturnType<typeof loadLocalHourlyAiUsage>>): UsageBucket[] {
  const byKey = new Map<string, UsageBucket>();
  const at = (providerId: string, hour: number) => {
    const key = `${providerId}\x00${hour}`;
    let b = byKey.get(key);
    if (!b) byKey.set(key, (b = { install: LOCAL_INSTALL, providerId, hour, inputTokens: 0, outputTokens: 0, limitHits: 0 }));
    return b;
  };
  for (const u of local.usage) {
    const b = at(u.providerId, u.hour);
    b.inputTokens += u.inputTokens;
    b.outputTokens += u.outputTokens;
  }
  for (const h of local.hits) at(h.providerId, h.hour).limitHits += h.hits;
  return [...byKey.values()];
}

/** The paired installs' last pulled usage. Never throws: an unreadable record reads as missing usage. */
async function loadPeerUsage(now: Date): Promise<{ peers: PeerUsageStatus[]; buckets: UsageBucket[] }> {
  try {
    const [links, row] = await Promise.all([
      prisma.federationLink.findMany({ where: SAME_ORG_PEER_LINK_WHERE, select: { linkId: true }, orderBy: { linkId: "asc" } }),
      prisma.platformConfig.findUnique({ where: { key: PEER_AI_USAGE_KEY }, select: { value: true } }),
    ]);
    return peerUsageFromRecord(parsePeerAiUsageRecord(row?.value), links.map((l) => l.linkId), now);
  } catch (error) {
    console.warn(`[subscription-cost] could not read the paired install's usage: ${error instanceof Error ? error.message : String(error)}`);
    return { peers: [], buckets: [] };
  }
}

async function loadListPrices(providerIds: readonly string[]): Promise<Map<string, ProviderTokenPrice>> {
  const ids = [...new Set(providerIds.flatMap((id) => [id, LIST_PRICE_SIBLING[id]].filter((v): v is string => !!v)))];
  if (!ids.length) return new Map();
  const rows = await prisma.modelProvider.findMany({
    where: { providerId: { in: ids } },
    select: { providerId: true, inputPricePerMToken: true, outputPricePerMToken: true },
  });
  return new Map(rows.map((r) => [r.providerId, { inputPerMToken: r.inputPricePerMToken, outputPerMToken: r.outputPricePerMToken }]));
}

/** Every active subscription plan with its value, savings and effective-cost estimate. */
export async function loadSubscriptionCostEstimates(now = new Date()): Promise<SubscriptionPlanEstimate[]> {
  const contracts = await activeSubscriptionContracts();
  if (!contracts.length) return [];
  const covered = [...new Set(contracts.flatMap((c) => providerIdsOf(c.coveredProviderIds)))];
  const since = new Date(now.getTime() - ESTIMATE_LOOKBACK_DAYS * 86_400_000);
  const [local, peer, listPrices] = await Promise.all([
    covered.length ? loadLocalHourlyAiUsage({ since, providerIds: covered }) : Promise.resolve({ usage: [], hits: [] }),
    loadPeerUsage(now),
    loadListPrices(covered),
  ]);
  const buckets = [...localBuckets(local), ...peer.buckets];
  return contracts.map((contract) => {
    const coveredProviderIds = providerIdsOf(contract.coveredProviderIds);
    const amount = contract.monthlyCommittedAmount == null ? null : Number(contract.monthlyCommittedAmount);
    const plan = estimateSubscriptionPlan({
      monthlyFeeUsd: monthlyFeeFromContract({ monthlyCommittedAmount: amount, billingCadence: contract.billingCadence }),
      currency: contract.currency,
      coveredProviderIds,
      buckets,
      listPrices,
      peers: peer.peers,
      now,
    });
    return {
      contractId: contract.contractId,
      planName: contract.notes,
      coveredProviderIds,
      currency: contract.currency,
      ...plan,
    };
  });
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
