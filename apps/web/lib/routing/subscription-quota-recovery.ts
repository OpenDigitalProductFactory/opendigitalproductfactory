import { prisma } from "@dpf/db";
import { isActiveDefaultSubscription, matchesCredentialRevision, type ActiveAccountSnapshot } from "@/lib/inference/active-provider-account-verification";
import { captureProviderQuotaObservation } from "@/lib/actions/provider-quota-revalidation";
import { testProviderAuthInternal } from "@/lib/actions/provider-auth-test";
import { reconcileProviderQuotaObservation, loadProviderCapacitySnapshots, recordProviderCapacityStatus, capacityAccountIdentity } from "./provider-capacity/store";
import { accountRuntimeKey } from "./provider-account-candidates";
import type { ProviderQuotaObservation } from "./provider-capacity/types";
import { nextSubscriptionQuotaCheck, subscriptionQuotaJobId, SUBSCRIPTION_RECHECK_MS } from "./subscription-quota-policy";

/** A completed probe cannot clear a newer limit, replaced sign-in or manual pause. */
export async function reconcileActiveSubscriptionQuota(snapshot: ActiveAccountSnapshot, observation: ProviderQuotaObservation) {
  return prisma.$transaction(async tx => {
    // Same account -> credential lock order as the canonical capacity writer.
    const locked = await tx.$queryRaw<Array<{ connectionId: string }>>`
      SELECT a."connectionId" FROM "AiProviderConnection" a
      JOIN "CredentialEntry" c ON c.id = a."credentialEntryId"
      WHERE a."connectionId" = ${snapshot.connectionId}
      FOR UPDATE OF a, c`;
    if (locked.length !== 1) return "changed" as const;
    const current = await tx.aiProviderConnection.findUnique({ where: { connectionId: snapshot.connectionId }, include: { credentialEntry: true } });
    if (!isActiveDefaultSubscription(current) || current.providerId !== snapshot.providerId
        || current.updatedAt.getTime() !== snapshot.updatedAt.getTime()
        || !matchesCredentialRevision(snapshot, current.credentialEntry)) return "changed" as const;
    return reconcileProviderQuotaObservation(tx, observation);
  });
}

/** Bounded to the two existing install-owned subscription paths, one probe each. */
export async function recheckSubscriptionQuotas(now = new Date()) {
  const outcomes: Array<{ providerId: string; outcome: string }> = [];
  const health = await loadProviderCapacitySnapshots();
  for (const providerId of ["chatgpt", "codex"]) {
    const [account, provider, capacity] = await Promise.all([
      prisma.aiProviderConnection.findUnique({ where: { connectionId: `provider-default-${providerId}` }, include: { credentialEntry: true } }),
      prisma.modelProvider.findUnique({ where: { providerId } }),
      prisma.providerCapacityStatus.findUnique({ where: { providerId } }),
    ]);
    if (!isActiveDefaultSubscription(account) || !account.credentialEntry
        || !provider || !["active", "degraded"].includes(provider.status)
        || !capacity || !["quota_resets_at", "rate_limited"].includes(capacity.state)
        || capacity.isHumanActionRequired) continue;
    const accountHealth = health.get(accountRuntimeKey(providerId, account.connectionId));
    if (accountHealth?.isHumanActionRequired || ["reauth_required", "billing_action_required", "unsupported_plan"].includes(accountHealth?.state ?? "")) continue;
    const jobId = subscriptionQuotaJobId(providerId);
    const job = await prisma.scheduledJob.findUnique({ where: { jobId } });
    const due = nextSubscriptionQuotaCheck(capacity.lastObservedAt, job?.lastRunAt ?? null);
    if (!due || due > now) continue;
    const observation = await captureProviderQuotaObservation(account);
    if (!observation || observation.id !== capacity.id || observation.updatedAt.getTime() !== capacity.updatedAt.getTime()) continue;
    // Persist the attempt before network I/O. A restart or repeated cron cannot
    // send another request inside the hour, including after an uncertain result.
    await prisma.scheduledJob.upsert({ where: { jobId },
      create: { jobId, name: `Recheck ${providerId} subscription capacity`, schedule: "hourly", nextRunAt: now }, update: {} });
    const claimed = await prisma.scheduledJob.updateMany({ where: { jobId, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }] },
      data: { schedule: "hourly", lastRunAt: now, nextRunAt: new Date(now.getTime() + SUBSCRIPTION_RECHECK_MS), lastStatus: "checking" } });
    if (claimed.count !== 1) continue;
    const snapshot: ActiveAccountSnapshot = { connectionId: account.connectionId, providerId,
      credentialEntryId: account.credentialEntry.id, updatedAt: account.updatedAt,
      credentialRevision: { updatedAt: account.credentialEntry.updatedAt, cachedToken: account.credentialEntry.cachedToken, refreshToken: account.credentialEntry.refreshToken } };
    let outcome = "still-limited";
    try {
      const probe = await testProviderAuthInternal(providerId, false, account.connectionId, { verificationOnly: true });
      if (probe.ok) outcome = await reconcileActiveSubscriptionQuota(snapshot, observation);
      else if (probe.capacityFailure?.isHumanActionRequired) {
        const identity = capacityAccountIdentity(account);
        if (identity) await recordProviderCapacityStatus({ providerId, account: identity, classification: probe.capacityFailure, source: "oauth" });
        outcome = "needs-attention";
      }
    } catch {
      outcome = "check-unavailable";
    }
    await prisma.scheduledJob.update({ where: { jobId }, data: {
      lastStatus: outcome, lastError: outcome === "cleared" ? null : "Availability was not confirmed; the existing restriction remains.",
      ...(outcome === "cleared" ? { nextRunAt: null, schedule: "disabled" } : {}),
    } });
    outcomes.push({ providerId, outcome });
  }
  return outcomes;
}
