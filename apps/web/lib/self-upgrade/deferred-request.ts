// apps/web/lib/self-upgrade/deferred-request.ts
//
// BI-2128872C. An agent that asks for an upgrade outside the maintenance window
// is not refused and not run now: its request is recorded here, and the
// scheduled cron honours it at the next window even when checkIntervalHours has
// not elapsed. Without that waiver a deferred request could miss the window it
// was promised (the interval clock is reset by every check), which would make
// "queued for the next window" untrue.
//
// Deliberately NOT a SelfUpgradeRun row. A run in `queued`/`pending` is ACTIVE
// to every consumer: the admission reconciler dispatches it, redeploy-portal
// refuses to run beside it, and the operator's "Upgrade now" answers
// "already-queued". A row parked for hours would therefore block the operator's
// immediate path (AC-2) and be dispatched straight away by the reconciler. The
// request lives in PlatformConfig beside the other scheduler state
// (lastCheckedAt, lastScheduledDecline) instead.
//
// Self-clearing: the request is pending only while no check has run since it
// was made. The next real check (scheduled at the window, or an operator's
// "Upgrade now") fulfils it, so nothing has to delete it.

import { prisma } from "@dpf/db";

const DEFERRED_REQUEST_CONFIG_KEY = "self_upgrade.deferredRequest";

export type DeferredUpgradeRequest = {
  /** Audit identity of the requester, e.g. "mcp:codex". */
  requestedBy: string;
  /** ISO time the request was deferred. */
  requestedAt: string;
  /** ISO time the scheduled cron is expected to pick it up, or null when unknown. */
  runAt: string | null;
};

/**
 * True while the deferred request still waits for a check: it exists and no
 * check has run at or after the moment it was made. Pure.
 */
export function isDeferredRequestPending(
  request: DeferredUpgradeRequest | null,
  lastCheckedAt: Date | null,
): boolean {
  if (!request) return false;
  const requestedAt = new Date(request.requestedAt);
  if (Number.isNaN(requestedAt.getTime())) return false;
  if (!lastCheckedAt) return true;
  return lastCheckedAt.getTime() < requestedAt.getTime();
}

export async function recordDeferredUpgradeRequest(request: DeferredUpgradeRequest): Promise<void> {
  const value = { ...request };
  await prisma.platformConfig.upsert({
    where: { key: DEFERRED_REQUEST_CONFIG_KEY },
    update: { value },
    create: { key: DEFERRED_REQUEST_CONFIG_KEY, value },
  });
}

/** The recorded deferred request, or null. Never throws: a gate must not break on it. */
export async function getDeferredUpgradeRequest(): Promise<DeferredUpgradeRequest | null> {
  try {
    const row = await prisma.platformConfig.findUnique({ where: { key: DEFERRED_REQUEST_CONFIG_KEY } });
    const value = row?.value as Record<string, unknown> | null | undefined;
    const requestedBy = typeof value?.requestedBy === "string" ? value.requestedBy : null;
    const requestedAt = typeof value?.requestedAt === "string" ? value.requestedAt : null;
    const runAt = typeof value?.runAt === "string" ? value.runAt : null;
    return requestedBy && requestedAt ? { requestedBy, requestedAt, runAt } : null;
  } catch {
    return null;
  }
}
