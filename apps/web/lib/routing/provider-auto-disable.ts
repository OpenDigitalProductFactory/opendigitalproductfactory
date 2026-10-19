// Automatic provider disable that recovers on its own (BI-D28A4F55).
//
// A single auth or billing error used to set ModelProvider.status "disabled"
// and nothing ever re-enabled it. The quota path's re-enable ran only when
// someone opened the providers page, so platform recovery depended on a page
// view. On 2026-09-26 that silently took anthropic-sub out of routing for
// five days and left every room on the local model.
//
// Now an automatic disable records why and from where (distinct from an
// administrator's disable, which writes "inactive" and schedules nothing) and
// sends a durable recovery event. The recovery job (queue/functions/provider-recovery.ts)
// refreshes an OAuth credential, or re-opens the provider half-open, with
// exponential backoff. A further failure re-disables it at the next attempt.

import { prisma } from "@dpf/db";
import { jobs } from "@/lib/jobs";

export type AutoDisableCause = "auth" | "billing";
export type AutoDisableSource = "fallback-chain" | "task-dispatcher";

export const PROVIDER_RECOVERY_EVENT = "ops/provider.recover";
const BASE_DELAY_MS = 15 * 60 * 1000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;
/** A re-disable this long after the last recovery starts the backoff over. */
const ATTEMPT_MEMORY_MS = 24 * 60 * 60 * 1000;

export function providerRecoveryJobId(providerId: string): string {
  return `provider-recover-${providerId}`;
}

export function recoveryDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt), MAX_DELAY_MS);
}

export type RecoveryJobState = {
  kind: "auto-disable";
  cause: AutoDisableCause;
  source: AutoDisableSource;
  attempt: number;
};

export function readRecoveryState(metadata: unknown): RecoveryJobState | null {
  const row = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : null;
  if (row?.kind !== "auto-disable" || typeof row.attempt !== "number") return null;
  return row as unknown as RecoveryJobState;
}

/** The next attempt number, continuing the backoff only while recovery is recent. */
export function nextAttempt(prior: { lastStatus: string | null; lastRunAt: Date | null; metadata: unknown } | null, now: Date): number {
  const state = prior ? readRecoveryState(prior.metadata) : null;
  if (!prior || !state) return 0;
  if (prior.lastStatus === "scheduled") return state.attempt;
  const recent = prior.lastRunAt && now.getTime() - prior.lastRunAt.getTime() < ATTEMPT_MEMORY_MS;
  return prior.lastStatus === "half-open" && recent ? state.attempt + 1 : 0;
}

type Db = Pick<typeof prisma, "modelProvider" | "scheduledJob">;
type Send = (event: { name: string; data: Record<string, unknown> }) => unknown;

export async function autoDisableProvider(
  input: { providerId: string; cause: AutoDisableCause; source: AutoDisableSource; detail?: string; now?: Date },
  deps: { db?: Db; send?: Send } = {},
): Promise<{ attempt: number; nextRunAt: Date }> {
  const db = deps.db ?? prisma;
  const send = deps.send ?? ((event) => jobs.send(event as never));
  const now = input.now ?? new Date();
  const jobId = providerRecoveryJobId(input.providerId);
  const prior = await db.scheduledJob.findUnique({ where: { jobId } });
  const attempt = nextAttempt(prior, now);
  const delayMs = recoveryDelayMs(attempt);
  const nextRunAt = new Date(now.getTime() + delayMs);
  const why = `Automatically disabled after a ${input.cause} error (${input.source})`
    + `${input.detail ? `: ${input.detail}` : ""}. Recovery is scheduled; it does not need an administrator unless it keeps failing.`;
  const metadata: RecoveryJobState = { kind: "auto-disable", cause: input.cause, source: input.source, attempt };

  await db.modelProvider.update({ where: { providerId: input.providerId }, data: { status: "disabled" } });
  await db.scheduledJob.upsert({
    where: { jobId },
    create: { jobId, name: `Recover ${input.providerId} after an automatic disable`, schedule: "once", nextRunAt, lastStatus: "scheduled", lastError: why.slice(0, 500), metadata },
    update: { schedule: "once", nextRunAt, lastStatus: "scheduled", lastError: why.slice(0, 500), metadata },
  });
  await Promise.resolve(send({ name: PROVIDER_RECOVERY_EVENT, data: { providerId: input.providerId, attempt, delayMs } }));
  console.warn(`[provider-auto-disable] ${input.providerId} disabled (${input.cause}, ${input.source}); recovery attempt ${attempt} at ${nextRunAt.toISOString()}`);
  return { attempt, nextRunAt };
}

export type RecoveryOutcome = "recovered" | "still-failing" | "not-auto-disabled";

/**
 * One recovery attempt. Stands down if an administrator acted since (the
 * provider is no longer disabled, or the job no longer expects this attempt).
 */
export async function runProviderRecovery(
  input: { providerId: string; attempt: number; now?: Date },
  deps: { db?: Db; send?: Send; refresh?: (providerId: string) => Promise<{ token: string } | { error: string }> } = {},
): Promise<RecoveryOutcome> {
  const db = deps.db ?? prisma;
  const now = input.now ?? new Date();
  const jobId = providerRecoveryJobId(input.providerId);
  const [provider, job] = await Promise.all([
    db.modelProvider.findUnique({ where: { providerId: input.providerId } }),
    db.scheduledJob.findUnique({ where: { jobId } }),
  ]);
  const state = job ? readRecoveryState(job.metadata) : null;
  if (!provider || provider.status !== "disabled" || !job || job.lastStatus !== "scheduled" || state?.attempt !== input.attempt) {
    return "not-auto-disabled";
  }
  if (provider.authMethod?.startsWith("oauth2")) {
    const refresh = deps.refresh ?? (async (id: string) => (await import("@/lib/provider-oauth")).refreshOAuthToken(id));
    const refreshed = await refresh(input.providerId);
    if (!("token" in refreshed)) {
      const attempt = input.attempt + 1;
      const delayMs = recoveryDelayMs(attempt);
      await db.scheduledJob.update({
        where: { jobId },
        data: {
          lastRunAt: now,
          nextRunAt: new Date(now.getTime() + delayMs),
          lastError: `Credential refresh failed: ${refreshed.error}. Still disabled; if this persists, an administrator must sign in to ${input.providerId} again.`.slice(0, 500),
          metadata: { ...state, attempt },
        },
      });
      const send = deps.send ?? ((event) => jobs.send(event as never));
      await Promise.resolve(send({ name: PROVIDER_RECOVERY_EVENT, data: { providerId: input.providerId, attempt, delayMs } }));
      return "still-failing";
    }
  }
  await db.modelProvider.update({ where: { providerId: input.providerId }, data: { status: "active" } });
  await db.scheduledJob.update({
    where: { jobId },
    data: { lastRunAt: now, lastStatus: "half-open", lastError: `Re-enabled automatically after a ${state.cause} error; a further failure disables it again with a longer wait.` },
  });
  console.warn(`[provider-auto-disable] ${input.providerId} re-enabled (half-open) after attempt ${input.attempt}`);
  return "recovered";
}
