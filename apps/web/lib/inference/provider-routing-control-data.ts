import { prisma } from "@dpf/db";
import type { ProviderWithCredential } from "./ai-provider-types";
import { getLocalOnlyInference } from "./local-only";
import { projectProviderRoutingControl } from "@/lib/routing/provider-routing-control";
import { loadProviderHealthBatch } from "@/lib/routing/provider-health-loader";
import { getEndpointRuntimeState } from "@/lib/routing/rate-tracker";
import { cliAdapterTypeForProvider } from "@/lib/routing/provider-routing-eligibility";
import { getAllCliPoolStatuses, formatWeeklyAllocationHint } from "@/lib/routing/cli-pool-status";
import { readRecoveryState, providerRecoveryJobId } from "@/lib/routing/provider-auto-disable";

/** Shared catalog/detail read model; no status mutation or page-driven recovery. */
export async function loadProviderRoutingControls(providers: ProviderWithCredential[], modelCounts: ReadonlyMap<string, number>, now = new Date()) {
  const ids = providers.map(p => p.provider.providerId);
  const [health, pools, localOnly, capacities, recoveries] = await Promise.all([
    loadProviderHealthBatch(ids, { now: now.getTime(), runtimeState: getEndpointRuntimeState }),
    getAllCliPoolStatuses(), getLocalOnlyInference(),
    prisma.providerCapacityStatus.findMany({ where: { providerId: { in: ids } } }),
    prisma.scheduledJob.findMany({ where: { jobId: { in: ids.flatMap(id => [providerRecoveryJobId(id), `provider-reenable-${id}`]) }, lastStatus: "scheduled", schedule: { not: "disabled" } } }),
  ]);
  const capacityById = new Map(capacities.map(c => [c.providerId, c]));
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
      weeklyHint: pool ? formatWeeklyAllocationHint(pool, now) : null,
    })] as const;
  }));
}
