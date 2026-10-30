import { randomUUID } from "node:crypto";
import { isRecord } from "@/lib/shared/coerce";
import { QUOTA_PROOF_TTL_MS, currentExecutionProof, type ExecutionProof } from "@/lib/routing/provider-capacity/execution-proof";

export const QUOTA_RECOVERY_JOB_PREFIX = "subscription-quota-recovery:";
export const quotaRecoveryJobId = (connectionId: string) => `${QUOTA_RECOVERY_JOB_PREFIX}${connectionId}`;

export function nextQuotaRecheckAt(now: number, resets: Array<Date | null>): number {
  const short = resets.map(reset => reset?.getTime()).filter((time): time is number => typeof time === "number" && time > now && time <= now + QUOTA_PROOF_TTL_MS);
  return short.length ? Math.max(...short) : now + QUOTA_PROOF_TTL_MS;
}
export function quotaRecoveryCommission(value: unknown): { modelId: string; hourly: boolean } | null {
  return isRecord(value) && value.kind === "subscription-quota-recovery" && value.version === 1
    && typeof value.modelId === "string" && value.modelId.trim().length > 0 && value.modelId.length <= 200 && typeof value.hourly === "boolean"
    ? { modelId: value.modelId, hourly: value.hourly } : null;
}

export type QuotaRecheckResult = { ok: boolean; message: string; nextCheckAt?: string; modelId?: string; observationCompleted?: boolean };

/** Reduce an existing commission only. No account activation or inference. */
export async function stopSubscriptionQuotaRecovery(connectionId: string): Promise<QuotaRecheckResult> {
  if (!connectionId || connectionId.length > 200) return { ok: false, message: "Choose an existing account." };
  const [{ prisma }, { isDefaultSubscriptionIdentity }] = await Promise.all([import("@dpf/db"), import("@/lib/inference/active-provider-account-verification")]);
  const account = await prisma.aiProviderConnection.findUnique({ where: { connectionId }, select: { providerId: true, connectionId: true, organizationId: true } });
  if (!account || account.organizationId !== null || !isDefaultSubscriptionIdentity(account.providerId, account.connectionId))
    return { ok: false, message: "Choose an install-owned default subscription account." };
  const prior = await prisma.scheduledJob.findUnique({ where: { jobId: quotaRecoveryJobId(connectionId) } });
  const commission = quotaRecoveryCommission(prior?.metadata);
  if (!prior || !commission) return { ok: false, message: "This account has no recorded recovery commission." };
  const stopped = await prisma.scheduledJob.updateMany({ where: { jobId: prior.jobId, updatedAt: prior.updatedAt },
    data: { metadata: { kind: "subscription-quota-recovery", version: 1, modelId: commission.modelId, hourly: false } } });
  return { ok: stopped.count === 1, observationCompleted: false, message: stopped.count === 1
    ? "Hourly recovery is stopped. No provider request was sent." : "The recovery commission changed. Refresh its status." };
}

/** One explicit synthetic request. Restoring an account or original work is never implied. */
export async function recheckSubscriptionQuota(connectionId: string, modelId: string, hourly?: boolean, options: { scheduled?: boolean } = {}): Promise<QuotaRecheckResult> {
  if (!connectionId || connectionId.length > 200 || !modelId.trim() || modelId.length > 200) return { ok: false, message: "Choose an existing account and model." };
  const [{ prisma }, proofStore] = await Promise.all([import("@dpf/db"), import("@/lib/routing/provider-capacity/execution-proof.server")]);
  const eligibility = await proofStore.inspectExecutionProofBinding(connectionId, modelId);
  if (eligibility.blockedReason === "owned-account-quota") return { ok: false, observationCompleted: false,
    message: "This account has an unsupported account-level quota record. Reconciliation is required before checking capacity; the record is unchanged." };
  const captured = eligibility.captured;
  if (!captured) return { ok: false, message: "This check requires an active subscription account and model, with no sign-in or billing restriction." };
  const now = new Date(), jobId = quotaRecoveryJobId(connectionId);
  let prior = await prisma.scheduledJob.upsert({ where: { jobId },
    create: { jobId, name: "Subscription capacity recheck", schedule: "once", metadata: { kind: "subscription-quota-recovery", version: 1, modelId, hourly: hourly === true } }, update: {} });
  if (!prior.enabled || prior.schedule === "disabled") return { ok: false, message: "Capacity rechecks are paused. Review the existing scheduled job." };
  if (options.scheduled && !quotaRecoveryCommission(prior.metadata)?.hourly)
    return { ok: false, observationCompleted: false, message: "Hourly recovery is stopped. No provider request was sent." };
  if (hourly !== undefined) {
    const changed = await prisma.scheduledJob.updateMany({ where: { jobId, updatedAt: prior.updatedAt, enabled: true },
      data: { metadata: { kind: "subscription-quota-recovery", version: 1,
        modelId: prior.lastStatus === "running" ? quotaRecoveryCommission(prior.metadata)?.modelId ?? modelId : modelId, hourly } } });
    if (changed.count !== 1) return { ok: false, message: "The recovery commission changed. Refresh its status." };
    prior = await prisma.scheduledJob.findUniqueOrThrow({ where: { jobId } });
  }
  const recent = prior.lastRunAt && prior.lastRunAt.getTime() + 60_000 > now.getTime();
  const running = prior.lastStatus === "running" && (!prior.lastRunAt || prior.lastRunAt.getTime() + 90_000 > now.getTime());
  if (running || recent || options.scheduled && prior.nextRunAt && prior.nextRunAt > now) return hourly !== undefined
    ? { ok: true, observationCompleted: false, message: hourly ? "Hourly recovery is scheduled. Capacity was not checked again." : "Hourly recovery is stopped. Capacity was not checked again.", ...(hourly && prior.nextRunAt ? { nextCheckAt: prior.nextRunAt.toISOString() } : {}) }
    : { ok: false, observationCompleted: false, message: "A capacity check just ran or is still in progress. Wait a minute before checking again.", ...(prior.nextRunAt ? { nextCheckAt: prior.nextRunAt.toISOString() } : {}) };
  const runCursor = randomUUID();
  const commissioned = hourly ?? quotaRecoveryCommission(prior.metadata)?.hourly ?? false;
  const nextRunAt = new Date(nextQuotaRecheckAt(now.getTime(), captured.resetTimes));
  // Atomic durable admission prevents overlapping clicks, sweep retries and client loss.
  const claimed = await prisma.scheduledJob.updateMany({ where: { jobId, updatedAt: prior.updatedAt, enabled: true, schedule: { not: "disabled" },
    ...(options.scheduled ? { OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }
      : { OR: [{ lastRunAt: null }, { lastRunAt: { lte: new Date(now.getTime() - 60_000) } }] }) },
    data: { runCursor, lastStatus: "running", lastRunAt: now, nextRunAt,
      metadata: { kind: "subscription-quota-recovery", version: 1, modelId, hourly: commissioned } } });
  if (claimed.count !== 1) return { ok: false, message: "This account's check changed or is already in progress. Refresh its status." };
  const assertCurrent = async () => {
    const [{ assertGovernedInferenceAuthority }, { assertProviderDispatchCapacity }, job, current] = await Promise.all([
      import("@/lib/routing/governed-inference-deadline"), import("@/lib/routing/local-provider-capacity"),
      prisma.scheduledJob.findUnique({ where: { jobId } }), proofStore.captureExecutionProofBinding(connectionId, modelId),
    ]);
    await assertGovernedInferenceAuthority();
    await assertProviderDispatchCapacity(captured.binding.providerId);
    const expected: ExecutionProof = { version: 1, ...captured.binding, observedAt: now.getTime(), expiresAt: now.getTime() + QUOTA_PROOF_TTL_MS };
    if (!job?.enabled || job.schedule === "disabled" || job.runCursor !== runCursor || options.scheduled && !quotaRecoveryCommission(job.metadata)?.hourly || !current
      || !currentExecutionProof(expected, current.binding, Date.now())) throw new Error("Capacity check ownership or restrictions changed");
  };
  let recovered = false;
  try {
    // Short Retry-After/reset windows stay authoritative; distant forecasts may be tested now.
    if (captured.resetTimes.some(reset => reset && reset > now && reset.getTime() <= now.getTime() + QUOTA_PROOF_TTL_MS)) {
      await prisma.scheduledJob.updateMany({ where: { jobId, runCursor }, data: { lastStatus: "waiting", lastRunSummary: "Waiting for the current short limit before checking again." } });
      return { ok: false, message: "The provider requested a short wait. A check is scheduled after it.", nextCheckAt: nextRunAt.toISOString(), modelId };
    }
    await assertCurrent();
    await proofStore.invalidateExecutionProof(connectionId, captured.binding.credentialRevision);
    const { testProviderAuthInternal } = await import("@/lib/actions/provider-auth-test");
    const result = await testProviderAuthInternal(captured.binding.providerId, false, connectionId, { verificationOnly: true,
      observation: { modelId, beforeDispatch: assertCurrent, completed: async () => {
        await assertCurrent();
        recovered = await proofStore.persistExecutionProof(captured, Date.now(), { jobId, runCursor });
        if (!recovered) throw new Error("Capacity evidence changed before persistence");
      } } });
    if (!result.ok) recovered = false;
    if (recovered) {
      const persisted = await prisma.providerCapacityStatus.findUnique({ where: { ownedAccountId: captured.accountId }, select: { executionProof: true } });
      recovered = Boolean(persisted && await proofStore.readCurrentExecutionProof(connectionId, modelId, persisted.executionProof));
    }
  } catch { recovered = false; }
  if (!recovered) await proofStore.invalidateExecutionProof(connectionId, captured.binding.credentialRevision);
  const message = recovered
    ? "The selected model completed a Responses capacity check. Other models, CLI limits and work permissions remain separate."
    : "This check did not confirm capacity. Existing restrictions remain; inspect the account and the recorded check before retrying.";
  const settled = await prisma.scheduledJob.updateMany({ where: { jobId, runCursor, enabled: true },
    data: { lastStatus: recovered ? "recovered" : "unconfirmed", lastRunSummary: message, lastError: null } });
  return { ok: recovered && settled.count === 1, observationCompleted: recovered, message, modelId, ...(commissioned ? { nextCheckAt: nextRunAt.toISOString() } : {}) };
}

/** Only persisted owner commissions wake; account discovery and page loads never opt in. */
export async function runSubscriptionQuotaRecovery() {
  const { prisma } = await import("@dpf/db");
  const now = new Date();
  const jobs = await prisma.scheduledJob.findMany({ where: { jobId: { startsWith: QUOTA_RECOVERY_JOB_PREFIX }, enabled: true,
    schedule: { not: "disabled" }, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }, orderBy: { nextRunAt: "asc" }, take: 2 });
  const outcomes: QuotaRecheckResult[] = [];
  for (const job of jobs) {
    const commission = quotaRecoveryCommission(job.metadata);
    if (!commission?.hourly) continue;
    const { captureExecutionProofBinding } = await import("@/lib/routing/provider-capacity/execution-proof.server");
    const binding = await captureExecutionProofBinding(job.jobId.slice(QUOTA_RECOVERY_JOB_PREFIX.length), commission.modelId);
    if (!binding?.hasQuota) continue;
    outcomes.push(await recheckSubscriptionQuota(job.jobId.slice(QUOTA_RECOVERY_JOB_PREFIX.length), commission.modelId, undefined, { scheduled: true }));
  }
  return { checked: outcomes.length, outcomes };
}

/** Safe read data only; viewing account status never schedules or calls a provider. */
export async function loadSubscriptionQuotaRecoveryViews(connectionIds: string[]) {
  const { prisma } = await import("@dpf/db");
  const [jobs, models] = await Promise.all([
    prisma.scheduledJob.findMany({ where: { jobId: { in: connectionIds.map(quotaRecoveryJobId) } } }),
    prisma.modelProfile.findMany({ where: { providerId: { in: ["chatgpt", "codex"] }, modelStatus: "active", modelClass: { in: ["chat", "reasoning", "code"] } },
      select: { providerId: true, modelId: true, friendlyName: true }, orderBy: [{ providerId: "asc" }, { modelId: "asc" }] }),
  ]);
  return new Map(connectionIds.map(connectionId => {
    const job = jobs.find(row => row.jobId === quotaRecoveryJobId(connectionId));
    const commission = quotaRecoveryCommission(job?.metadata);
    const providerId = connectionId === "provider-default-chatgpt" ? "chatgpt" : "codex";
    const choices = models.filter(model => model.providerId === providerId).map(model => ({ modelId: model.modelId, name: model.friendlyName || model.modelId }));
    return [connectionId, { models: choices, selectedModelId: commission?.modelId ?? null,
      hourly: Boolean(commission?.hourly && job?.enabled && job.schedule !== "disabled"),
      lastCheckAt: job?.lastRunAt?.toISOString() ?? null, nextCheckAt: commission?.hourly ? job?.nextRunAt?.toISOString() ?? null : null,
      // Only this runner's fixed summaries are persisted here; no provider body.
      lastResult: job?.lastRunSummary ?? null }];
  }));
}
