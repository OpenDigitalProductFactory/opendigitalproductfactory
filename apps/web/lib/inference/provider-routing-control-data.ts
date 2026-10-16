import { getT } from "@/lib/i18n/t.server";
import { inspectLocalProviderCapacity } from "@/lib/routing/local-provider-capacity";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { prisma } from "@dpf/db";
import type { ProviderWithCredential } from "./ai-provider-types";
import { getLocalOnlyInference } from "./local-only";
import { projectProviderRoutingControl, type ProviderRoutingControlView } from "@/lib/routing/provider-routing-control";
import { loadProviderHealthBatch } from "@/lib/routing/provider-health-loader";
import { getEndpointRuntimeState } from "@/lib/routing/rate-tracker";
import { cliAdapterTypeForProvider } from "@/lib/routing/provider-routing-eligibility";
import { getAllCliPoolStatuses, formatWeeklyAllocationHint } from "@/lib/routing/cli-pool-status";
import { capacityProviderIds, indexProviderCapacityByProvider } from "@/lib/routing/provider-capacity/store";
import { readRecoveryState, providerRecoveryJobId } from "@/lib/routing/provider-auto-disable";
import { nextSubscriptionQuotaCheck, subscriptionQuotaJobId } from "@/lib/routing/subscription-quota-policy";

/** Shared catalog/detail read model; no status mutation or page-driven recovery. */
export async function loadProviderRoutingControls(providers: ProviderWithCredential[], modelCounts: ReadonlyMap<string, number>, now = new Date()) {
  const ids = providers.map(p => p.provider.providerId);
  if (!ids.length) return new Map<string, ProviderRoutingControlView>();
  const [health, pools, localOnly, capacities, recoveries, hostCapacity, t] = await Promise.all([
    loadProviderHealthBatch(ids, { now: now.getTime(), runtimeState: getEndpointRuntimeState }),
    getAllCliPoolStatuses(), getLocalOnlyInference(),
    prisma.providerCapacityStatus.findMany({ where: { providerId: { in: capacityProviderIds(ids) } } }),
    prisma.scheduledJob.findMany({ where: { OR: [
      { jobId: { in: ids.flatMap(id => [providerRecoveryJobId(id), `provider-reenable-${id}`]) }, lastStatus: "scheduled", schedule: { not: "disabled" } },
      { jobId: { in: ids.map(subscriptionQuotaJobId) } },
    ] } }),
    ids.some(isLocalProviderId) ? inspectLocalProviderCapacity() : Promise.resolve(null),
    getT("setup"),
  ]);
  const capacityById = indexProviderCapacityByProvider(capacities, now.getTime());
  const recoveryById = new Map(recoveries.map(j => [j.jobId, j]));
  return new Map(providers.map(pw => {
    const id = pw.provider.providerId;
    const entry = health.get(id);
    const pool = pools.find(p => p.adapterType === cliAdapterTypeForProvider(id));
    const capacity = capacityById.get(id);
    const recovery = recoveryById.get(providerRecoveryJobId(id));
    const state = readRecoveryState(recovery?.metadata);
    const quotaJob = recoveryById.get(`provider-reenable-${id}`);
    return [id, projectProviderRoutingControl({
      pw, modelCount: modelCounts.get(id) ?? 0, now: now.getTime(), localOnly,
      health: entry?.status === "fulfilled" ? entry.value : undefined, pool,
      capacity: capacity ? { state: capacity.state, retryAtMs: capacity.retryAt?.getTime(), observedAtMs: capacity.lastObservedAt?.getTime(), safeSummary: capacity.safeSummary } : undefined,
      recovery: recovery && state && pw.provider.status === "disabled" ? { summary: `Automatic recovery after an ${state.cause === "auth" ? "authentication" : "account billing"} error.`, nextRunAt: recovery.nextRunAt?.toISOString() ?? null } : undefined,
      quotaRecovery: quotaJob ? { nextRunAt: quotaJob.nextRunAt?.toISOString() ?? null } : undefined,
      quotaRecheckAt: ["chatgpt", "codex"].includes(id) && capacity && ["rate_limited", "quota_resets_at"].includes(capacity.state)
        && ["active", "degraded"].includes(pw.provider.status) && pw.provider.defaultConnectionStatus === "active"
        ? nextSubscriptionQuotaCheck(capacity.lastObservedAt, recoveryById.get(subscriptionQuotaJobId(id))?.lastRunAt ?? null)?.toISOString() ?? null : null,
      hostRestriction: isLocalProviderId(id) && hostCapacity && !hostCapacity.available ? t(hostCapacity.reason === "local-ci-capacity-reservation-unavailable" ? "providerRouting.hostUnavailable" : "providerRouting.hostReserved") : null,
      weeklyHint: pool ? formatWeeklyAllocationHint(pool, now) : null,
    })] as const;
  }));
}
