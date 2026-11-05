// Automatic disable of ONE provider account that recovers on its own (BI-0ADD46C3).
//
// Since #6380, routing dispatches through provider accounts
// (AiProviderConnection). An auth or billing error on an account-bound call
// set that connection to "unconfigured" and nothing else: no recorded cause,
// no recovery. Routing then skipped the account, background OAuth renewal
// skipped it and its token lapsed, and the capacity watch never saw it,
// because it got no calls. On 2026-11-02 and 2026-11-03 a per-agent daily
// token budget, refused as "billing", stranded anthropic-sub, codex, chatgpt
// and anthropic this way. anthropic-sub served nothing for 6+ hours with a
// valid sign-in.
//
// This module gives an account the same contract the provider-level disable
// has (provider-auto-disable.ts, BI-D28A4F55): record why, schedule recovery
// on the shared ops/provider.recover event, reopen half-open with backoff.
// adoptStrandedProviderAccounts brings accounts already stranded with no
// recovery under it. No token value is read or written here.

import { prisma } from "@dpf/db";
import { jobs } from "@/lib/jobs";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { PROVIDER_RECOVERY_EVENT, nextAttempt, readRecoveryState, recoveryDelayMs, type AutoDisableCause, type AutoDisableSource } from "./provider-auto-disable";

export type AccountDisableCause = AutoDisableCause | "unrecorded";
export type AccountDisableSource = AutoDisableSource | "boot-adoption";
export type AccountRecoveryState = { kind: "auto-disable"; cause: AccountDisableCause; source: AccountDisableSource; attempt: number; connectionId: string };
export type AccountRecoveryOutcome = "recovered" | "still-failing" | "not-auto-disabled";

const DISABLED_STATUS = "unconfigured";
const OAUTH_AUTH_METHODS = ["oauth", "oauth2_authorization_code"];

type Db = Pick<typeof prisma, "aiProviderConnection" | "scheduledJob">;
type Send = (event: { name: string; data: Record<string, unknown> }) => unknown;
/** Renews an OAuth account through the guarded account path; supplied by the caller (routing may not import inference). */
export type AccountRenewal = (providerId: string, connectionId: string) => Promise<{ renewed: true } | { renewed: false; reason: string }>;

export function providerAccountRecoveryJobId(connectionId: string): string {
  return `provider-recover-account-${connectionId}`;
}

function readAccountState(metadata: unknown, connectionId: string): AccountRecoveryState | null {
  const state = readRecoveryState(metadata) as AccountRecoveryState | null;
  return state && state.connectionId === connectionId ? state : null;
}

/** Record the automatic disable and send the durable recovery event. */
async function scheduleAccountRecovery(
  input: { providerId: string; connectionId: string; cause: AccountDisableCause; source: AccountDisableSource; detail?: string; now: Date },
  db: Db, send: Send,
): Promise<{ attempt: number; nextRunAt: Date }> {
  const jobId = providerAccountRecoveryJobId(input.connectionId);
  const prior = await db.scheduledJob.findUnique({ where: { jobId } });
  const attempt = nextAttempt(prior, input.now);
  const delayMs = recoveryDelayMs(attempt);
  const nextRunAt = new Date(input.now.getTime() + delayMs);
  const why = (input.cause === "unrecorded"
    ? `Found switched off by an earlier automatic disable that recorded no recovery (${input.source})`
    : `Automatically switched off after a ${input.cause} error (${input.source})${input.detail ? `: ${input.detail}` : ""}`)
    + ". Recovery is scheduled; it does not need an administrator unless it keeps failing.";
  const metadata: AccountRecoveryState = { kind: "auto-disable", cause: input.cause, source: input.source, attempt, connectionId: input.connectionId };
  const row = { schedule: "once", nextRunAt, lastStatus: "scheduled", lastError: why.slice(0, 500), metadata };
  await db.scheduledJob.upsert({
    where: { jobId },
    create: { jobId, name: `Recover the ${input.providerId} account ${input.connectionId} after an automatic disable`, ...row },
    update: row,
  });
  await Promise.resolve(send({ name: PROVIDER_RECOVERY_EVENT, data: { providerId: input.providerId, connectionId: input.connectionId, attempt, delayMs } }));
  console.warn(`[provider-account-auto-disable] ${JSON.stringify(input.connectionId)} off (${input.cause}, ${input.source}); recovery attempt ${attempt} at ${nextRunAt.toISOString()}`);
  return { attempt, nextRunAt };
}

/**
 * Switch one account off after an auth or billing error, guarded by the row
 * version routing selected, and schedule its recovery. A row that changed
 * since selection is left alone: someone else already acted on it.
 */
export async function autoDisableProviderAccount(
  input: { providerId: string; connectionId: string; credentialEntryId: string | null; updatedAt: Date; cause: AutoDisableCause; source: AutoDisableSource; detail?: string; now?: Date },
  deps: { db?: Db; send?: Send } = {},
): Promise<{ disabled: boolean }> {
  const db = deps.db ?? prisma;
  const send = deps.send ?? ((event) => jobs.send(event as never));
  const written = await db.aiProviderConnection.updateMany({
    where: { connectionId: input.connectionId, providerId: input.providerId, credentialEntryId: input.credentialEntryId, updatedAt: input.updatedAt, status: { in: ["active", "degraded"] } },
    data: { status: DISABLED_STATUS },
  });
  if (written.count === 0) return { disabled: false };
  await scheduleAccountRecovery({ ...input, now: input.now ?? new Date() }, db, send);
  return { disabled: true };
}

/**
 * One recovery attempt for an account. It stands down if the account is no
 * longer switched off, or if the job no longer expects this attempt; either
 * means an administrator or a newer disable acted since.
 */
export async function runProviderAccountRecovery(
  input: { providerId: string; connectionId: string; attempt: number; now?: Date },
  deps: { db?: Db; send?: Send; renew: AccountRenewal },
): Promise<AccountRecoveryOutcome> {
  const db = deps.db ?? prisma;
  const now = input.now ?? new Date();
  const jobId = providerAccountRecoveryJobId(input.connectionId);
  const [connection, job] = await Promise.all([
    db.aiProviderConnection.findUnique({ where: { connectionId: input.connectionId } }),
    db.scheduledJob.findUnique({ where: { jobId } }),
  ]);
  const state = job ? readAccountState(job.metadata, input.connectionId) : null;
  if (!connection || connection.providerId !== input.providerId || connection.status !== DISABLED_STATUS
    || !job || job.lastStatus !== "scheduled" || !state || state.attempt !== input.attempt) return "not-auto-disabled";

  if (OAUTH_AUTH_METHODS.includes(connection.authMethod)) {
    let renewed: Awaited<ReturnType<AccountRenewal>>;
    try { renewed = await deps.renew(input.providerId, input.connectionId); } catch (error) { renewed = { renewed: false, reason: getErrorMessage(error) }; }
    if (!renewed.renewed) {
      const attempt = input.attempt + 1;
      const delayMs = recoveryDelayMs(attempt);
      await db.scheduledJob.update({ where: { jobId }, data: {
        lastRunAt: now, nextRunAt: new Date(now.getTime() + delayMs), metadata: { ...state, attempt },
        lastError: `Renewing the sign-in failed: ${renewed.reason}. Still off; if this persists, an administrator must sign in to ${input.providerId} again.`.slice(0, 500),
      } });
      const send = deps.send ?? ((event) => jobs.send(event as never));
      await Promise.resolve(send({ name: PROVIDER_RECOVERY_EVENT, data: { providerId: input.providerId, connectionId: input.connectionId, attempt, delayMs } }));
      return "still-failing";
    }
  }

  const reopened = await db.aiProviderConnection.updateMany({
    where: { connectionId: input.connectionId, providerId: input.providerId, credentialEntryId: connection.credentialEntryId, status: DISABLED_STATUS },
    data: { status: "active" },
  });
  if (reopened.count === 0) return "not-auto-disabled";
  await db.scheduledJob.update({ where: { jobId }, data: {
    lastRunAt: now, lastStatus: "half-open",
    lastError: "Switched back on automatically; a further failure switches it off again with a longer wait.",
  } });
  console.warn(`[provider-account-auto-disable] ${JSON.stringify(input.connectionId)} back on (half-open) after attempt ${input.attempt}`);
  return "recovered";
}

/**
 * Bring stranded default accounts under recovery: switched off behind an
 * active provider, holding a working credential, and with no recovery pending.
 * An account with no credential, or a credential an administrator is replacing
 * ("pending"), stays as it is.
 */
export async function adoptStrandedProviderAccounts(deps: { db?: Db; send?: Send; now?: Date } = {}): Promise<{ adopted: string[] }> {
  const db = deps.db ?? prisma;
  const send = deps.send ?? ((event) => jobs.send(event as never));
  const now = deps.now ?? new Date();
  const stranded = await db.aiProviderConnection.findMany({
    where: {
      status: DISABLED_STATUS,
      connectionId: { startsWith: "provider-default-" },
      provider: { status: "active" },
      credentialEntry: { is: { status: "ok" } },
    },
    select: { connectionId: true, providerId: true },
    orderBy: { connectionId: "asc" },
  });
  const adopted: string[] = [];
  for (const { connectionId, providerId } of stranded) {
    const job = await db.scheduledJob.findUnique({ where: { jobId: providerAccountRecoveryJobId(connectionId) } });
    if (job?.lastStatus === "scheduled") continue;
    await scheduleAccountRecovery({ providerId, connectionId, cause: "unrecorded", source: "boot-adoption", now }, db, send);
    adopted.push(connectionId);
  }
  return { adopted };
}
