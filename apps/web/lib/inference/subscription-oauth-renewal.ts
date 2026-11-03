// Background renewal of subscription OAuth sign-ins (BI-A53C594E).
//
// Subscription accounts (Claude, ChatGPT/Codex) were renewed only inline, when
// a routed call found the token near expiry. On 2026-10-21 one refused renewal
// took anthropic-sub out of routing; with no traffic and no page view, nothing
// tried again for six days. This pass runs on the existing Inngest cron
// (queue/functions/subscription-oauth-renewal.ts) and, per account:
//   - renews ahead of expiry through the guarded account path
//     (getProviderBearerToken with forceRefresh), never a separate grant writer;
//   - retries a failed renewal with capped exponential backoff;
//   - stops only on a confirmed refusal (invalid_grant, or nothing to renew
//     with) and records "sign-in-required", which the provider-credential
//     attention source projects as one "sign in again" item.
// State lives in one ScheduledJob row per account, the same substrate as
// provider recovery (routing/provider-auto-disable.ts). No token value is read
// or written here.

import type { prisma } from "@dpf/db";
import { isConfirmedReauthenticationRequired } from "@/lib/govern/oauth-renewal-errors";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export const SUBSCRIPTION_RENEWAL_JOB_PREFIX = "subscription-oauth-renewal:";
export const SIGN_IN_REQUIRED_STATUS = "sign-in-required";
/** Renew this long before expiry; anthropic-sub tokens live about 8 hours. */
export const RENEWAL_LEAD_MS = 2 * 60 * 60 * 1000;
const RETRY_BASE_MS = 10 * 60 * 1000;
const RETRY_MAX_MS = 2 * 60 * 60 * 1000;
const RENEWABLE_AUTH_METHODS = ["oauth", "oauth2_authorization_code"];

export function subscriptionRenewalJobId(connectionId: string): string {
  return `${SUBSCRIPTION_RENEWAL_JOB_PREFIX}${connectionId}`;
}

/** Wait before the next attempt after `failuresBefore` earlier consecutive failures. */
export function renewalRetryDelayMs(failuresBefore: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failuresBefore), RETRY_MAX_MS);
}

export type RenewalAttempt = { kind: "renewed" } | { kind: "refused" | "failed"; reason: string };
export type RenewalOutcome = "renewed" | "not-due" | "backing-off" | "retry-scheduled" | "sign-in-required" | "awaiting-sign-in";

type RenewalState = { kind: "subscription-oauth-renewal"; providerId: string; failures: number };
type Db = {
  aiProviderConnection: Pick<typeof prisma.aiProviderConnection, "findMany" | "findUnique">;
  scheduledJob: Pick<typeof prisma.scheduledJob, "findUnique" | "upsert">;
};

function failuresOf(metadata: unknown): number {
  const row = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : null;
  return typeof row?.failures === "number" && Number.isFinite(row.failures) ? row.failures : 0;
}

/** Default renewal: the guarded account path the router itself uses. */
async function renewThroughAccountPath(providerId: string, connectionId: string): Promise<RenewalAttempt> {
  const { getProviderBearerToken } = await import("./provider-account-credentials");
  const result = await getProviderBearerToken(providerId, connectionId, undefined, { forceRefresh: true });
  if ("token" in result) return { kind: "renewed" };
  return { kind: isConfirmedReauthenticationRequired(result.error) ? "refused" : "failed", reason: result.error };
}

export async function runSubscriptionOAuthRenewal(deps: {
  db?: Db;
  renew?: (providerId: string, connectionId: string) => Promise<RenewalAttempt>;
  now?: Date;
} = {}): Promise<{ checked: number; outcomes: Array<{ connectionId: string; providerId: string; outcome: RenewalOutcome }> }> {
  const db = deps.db ?? (await import("@dpf/db")).prisma;
  const renew = deps.renew ?? renewThroughAccountPath;
  const now = deps.now ?? new Date();
  const candidates = await db.aiProviderConnection.findMany({
    where: {
      authMethod: { in: RENEWABLE_AUTH_METHODS },
      status: { in: ["active", "degraded"] },
      credentialEntry: { is: { refreshToken: { not: null } } },
    },
    select: { connectionId: true, providerId: true },
    orderBy: { connectionId: "asc" },
  });

  const outcomes: Array<{ connectionId: string; providerId: string; outcome: RenewalOutcome }> = [];
  for (const { connectionId, providerId } of candidates) {
    // Re-read each account: renewing one shared default (codex) renews its sibling.
    const current = await db.aiProviderConnection.findUnique({ where: { connectionId }, include: { credentialEntry: true } });
    const credential = current?.credentialEntry;
    if (!current || !credential?.refreshToken || !RENEWABLE_AUTH_METHODS.includes(current.authMethod)) continue;
    const jobId = subscriptionRenewalJobId(connectionId);
    const prior = await db.scheduledJob.findUnique({ where: { jobId } });
    const write = (data: { lastStatus: string; nextRunAt: Date | null; lastError: string | null; lastRunSummary: string; failures: number }) => {
      const metadata: RenewalState = { kind: "subscription-oauth-renewal", providerId, failures: data.failures };
      const row = { lastRunAt: now, nextRunAt: data.nextRunAt, lastStatus: data.lastStatus, lastError: data.lastError, lastRunSummary: data.lastRunSummary, metadata };
      return db.scheduledJob.upsert({
        where: { jobId },
        create: { jobId, name: `Renew the ${providerId} sign-in (${connectionId})`, schedule: "once", ...row },
        update: row,
      });
    };

    const record = (outcome: RenewalOutcome) => outcomes.push({ connectionId, providerId, outcome });
    let failures = prior?.lastStatus === "retrying" ? failuresOf(prior.metadata) : 0;
    if (prior?.lastStatus === SIGN_IN_REQUIRED_STATUS) {
      // Stopped on a confirmed refusal: wait for a person to sign in again,
      // which writes a fresh credential after the refusal was recorded.
      const signedInAgain = credential.status === "ok" && (!prior.lastRunAt || credential.updatedAt > prior.lastRunAt);
      if (!signedInAgain) { record("awaiting-sign-in"); continue; }
      await write({ lastStatus: "ok", nextRunAt: null, lastError: null, lastRunSummary: "Signed in again; background renewal resumed.", failures: 0 });
      failures = 0;
    } else if (prior?.lastStatus === "retrying" && prior.nextRunAt && prior.nextRunAt > now) {
      record("backing-off");
      continue;
    }

    const expiresAt = credential.tokenExpiresAt?.getTime() ?? null;
    const due = credential.status === "expired" || failures > 0 || (expiresAt !== null && expiresAt - now.getTime() <= RENEWAL_LEAD_MS);
    if (!due) { record("not-due"); continue; }

    let attempt: RenewalAttempt;
    try { attempt = await renew(providerId, connectionId); }
    catch (error) { attempt = { kind: "failed", reason: getErrorMessage(error) }; }

    if (attempt.kind === "renewed") {
      await write({ lastStatus: "ok", nextRunAt: null, lastError: null, lastRunSummary: "Renewed ahead of expiry.", failures: 0 });
      record("renewed");
    } else if (attempt.kind === "refused") {
      await write({
        lastStatus: SIGN_IN_REQUIRED_STATUS, nextRunAt: null, lastError: attempt.reason.slice(0, 300), failures,
        lastRunSummary: `The ${providerId} sign-in was refused when renewing; a person must sign in again.`,
      });
      console.warn(`[subscription-oauth-renewal] ${JSON.stringify(connectionId)} needs sign-in: ${JSON.stringify(attempt.reason.slice(0, 120))}`);
      record("sign-in-required");
    } else {
      const delayMs = renewalRetryDelayMs(failures);
      await write({
        lastStatus: "retrying", nextRunAt: new Date(now.getTime() + delayMs), lastError: attempt.reason.slice(0, 300), failures: failures + 1,
        lastRunSummary: `Renewal failed (${failures + 1} in a row); retrying in ${Math.round(delayMs / 60_000)} min.`,
      });
      record("retry-scheduled");
    }
  }
  return { checked: candidates.length, outcomes };
}
