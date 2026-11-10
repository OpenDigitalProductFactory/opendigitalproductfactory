// apps/web/lib/self-upgrade/scheduled-gate.ts
//
// BI-3CA18934. The scheduled cron fires hourly but declines most ticks:
// checkIntervalHours (default 24) throttles it, and the window, cooldown,
// blackout and promoter prechecks decline before that. Every one of those
// declines used to vanish — `skipAttempt` persists only through
// `skipRun(runId, …)` and the cron passes no runId — so the sole evidence was
// the ABSENCE of a run, which reads exactly like a broken scheduler. It was
// read that way: a merged fix sat undeployed and the operator was told the
// upgrade was eligible while the next unattended check was 22 hours out.
//
// Two pieces, both cheap: a durable trace of the last scheduled decline, and
// the pure arithmetic for when the next unattended check becomes due. Neither
// changes upgrade POLICY — the interval and window remain the operator's.

import { prisma } from "@dpf/db";

import { getActiveSelfUpgradeBlackout } from "@/lib/self-upgrade/blackout";
import type { SelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { getDeferredUpgradeRequest, isDeferredRequestPending } from "@/lib/self-upgrade/deferred-request";
import { currentWindowOpenedAt, resolveEffectiveUpgradeWindow } from "@/lib/self-upgrade/effective-window";
import { scheduledCheckEligibleAt } from "@/lib/self-upgrade/interval-anchor";
import { getLastCheckedAt, isCheckIntervalElapsed } from "@/lib/self-upgrade/last-check";

const DECLINE_CONFIG_KEY = "self_upgrade.lastScheduledDecline";
// BI-EF1AC111 (AC-3): the last decline made while the window was open and had
// not had its check. Kept apart from the latest decline so the next daytime
// "outside-window" tick cannot overwrite why the night was skipped.
const WINDOW_DECLINE_CONFIG_KEY = "self_upgrade.lastWindowDecline";

/** A gate declined the unattended tick: the reason, plus what the caller reports. */
export type ScheduledGateDecline = {
  reason: string;
  persistedReason?: string;
  extra?: Record<string, unknown>;
};

// Reuse the real config type: a hand-rolled shape here would drift from the
// window/interval contract the rest of the upgrade path applies.
type ScheduledGateConfig = Pick<SelfUpgradeConfig, "maintenanceWindows" | "checkIntervalHours">;

/**
 * Every gate that declines an UNATTENDED tick before any drain, in order.
 * Extracted from runSelfUpgrade so the gates and the status that reports them
 * live in one module and cannot drift (BI-3CA18934). Returns null when the
 * unattended path may proceed. Manual and forced runs never reach here: the
 * operator is asking now.
 *
 * Blackout (BI-59591B14): a declared no-change period pauses the unattended
 * upgrade, since a self-upgrade is a disruptive change; it resumes on its own
 * once the blackout ends.
 *
 * Window: an explicit operator-configured maintenanceWindows array wins;
 * otherwise, for an effectively-24/7 store with a known timezone, an
 * auto-selected low-traffic overnight window (BI-A6382FB9) — without which a
 * 24/7 store would never open a window and scheduled upgrades would never run;
 * otherwise the operating-hours "store closed" derivation. A 24/7 store with no
 * derivable timezone cannot be scheduled safely (any local hour could be peak),
 * so it declines with a distinct reason and the Upgrade Center prompts for a
 * timezone — never a silent never-runs.
 *
 * Interval: only the scheduled cron is rate-limited, so the hourly tick polls
 * no more often than the operator configured. The interval is anchored to the
 * window opening (BI-EF1AC111): an opening with no check yet forgives up to a
 * day of it, so a daytime manual upgrade or last night's 23:02 run does not
 * skip tonight's window. A request an agent deferred to
 * the window (BI-2128872C) waives the interval while no check has run since it
 * was made, so the first in-window tick honours it.
 *
 * Every decline here is a clean no-op: no drain, no cooldown.
 */
export async function evaluateScheduledGate(args: {
  config: ScheduledGateConfig;
  now: Date;
  dryRun?: boolean;
}): Promise<ScheduledGateDecline | null> {
  const { config, now } = args;
  const blackout = await getActiveSelfUpgradeBlackout(now);
  if (blackout) {
    return {
      reason: "blackout-period",
      persistedReason: `blackout-period: ${blackout.name} until ${blackout.endAt.toISOString()}`,
      extra: { blackoutUntil: blackout.endAt.toISOString() },
    };
  }
  const window = await resolveEffectiveUpgradeWindow({ config, now });
  if (window.source === "needs-timezone") return { reason: "no-window-needs-timezone" };
  if (!window.open) return { reason: "outside-window" };
  if (!args.dryRun) {
    const lastCheckedAt = await getLastCheckedAt();
    const windowOpenedAt = currentWindowOpenedAt(window, now);
    if (
      !isCheckIntervalElapsed(lastCheckedAt, config.checkIntervalHours, now, windowOpenedAt) &&
      !isDeferredRequestPending(await getDeferredUpgradeRequest(), lastCheckedAt)
    ) {
      return { reason: "interval-not-elapsed" };
    }
  }
  return null;
}

export type ScheduledDecline = {
  reason: string;
  at: string;
};

/**
 * When the interval next lets an unattended check run. Null when it does not
 * hold the check back now (never checked, a non-positive interval, or already
 * elapsed). `windowOpenedAt` is the opening the check would run in (see
 * `schedulingWindowOpening`). Mirrors `isCheckIntervalElapsed` exactly so the
 * status a caller reads and the gate the cron applies can never disagree.
 */
export function nextScheduledCheckAt(
  lastCheckedAt: Date | null,
  intervalHours: number,
  now: Date,
  windowOpenedAt: Date | null = null,
): Date | null {
  const next = scheduledCheckEligibleAt(lastCheckedAt, intervalHours, windowOpenedAt);
  if (!next) return null;
  return next.getTime() <= now.getTime() ? null : next;
}

/** True when the unattended path is throttled right now. */
export function scheduledCheckIsThrottled(
  lastCheckedAt: Date | null,
  intervalHours: number,
  now: Date,
  windowOpenedAt: Date | null = null,
): boolean {
  return nextScheduledCheckAt(lastCheckedAt, intervalHours, now, windowOpenedAt) !== null;
}

/**
 * Keep a decline only while it still explains the present. A decline recorded
 * before the last successful check describes a throttle that has since lifted,
 * and reporting it would be its own kind of lie.
 */
export function declineIsCurrent(
  decline: ScheduledDecline | null,
  lastCheckedAt: Date | null,
): boolean {
  if (!decline) return false;
  const at = new Date(decline.at);
  if (Number.isNaN(at.getTime())) return false;
  if (!lastCheckedAt) return true;
  return at.getTime() >= lastCheckedAt.getTime();
}

/**
 * Record why an unattended tick declined. Never throws into the caller.
 *
 * With `config`, a decline made while the window is open and has not had its
 * check is also kept as the window decline (BI-EF1AC111, AC-3): that is the
 * reason the window may pass without an upgrade, and the daytime ticks that
 * follow must not erase it.
 */
export async function recordScheduledDecline(
  reason: string,
  now: Date,
  config?: Pick<SelfUpgradeConfig, "maintenanceWindows">,
): Promise<void> {
  const value = { reason, at: now.toISOString() };
  try {
    await prisma.platformConfig.upsert({
      where: { key: DECLINE_CONFIG_KEY },
      update: { value },
      create: { key: DECLINE_CONFIG_KEY, value },
    });
  } catch {
    // Observability must never break the upgrade path it observes.
  }
  if (!config || !reasonMayMissWindow(reason)) return;
  try {
    const window = await resolveEffectiveUpgradeWindow({ config, now });
    if (!window.open || window.source === "needs-timezone") return;
    const windowOpenedAt = currentWindowOpenedAt(window, now);
    const lastCheckedAt = await getLastCheckedAt();
    if (windowOpeningHasHadCheck(lastCheckedAt, windowOpenedAt)) return;
    const windowValue = {
      reason,
      at: now.toISOString(),
      windowOpenedAt: windowOpenedAt?.toISOString() ?? null,
    };
    await prisma.platformConfig.upsert({
      where: { key: WINDOW_DECLINE_CONFIG_KEY },
      update: { value: windowValue },
      create: { key: WINDOW_DECLINE_CONFIG_KEY, value: windowValue },
    });
  } catch {
    // Observability must never break the upgrade path it observes.
  }
}

// Declines that never need the window record: they are either decided by the
// window itself (outside it, or no timezone to place it) or already shown to
// the operator on their own (a declared blackout, upgrades turned off). Not
// resolving the window for them also keeps the gate's ordering intact: a
// blackout or a missing timezone is decided without consulting the window.
const SELF_EXPLAINING_DECLINES = new Set([
  "outside-window",
  "no-window-needs-timezone",
  "blackout-period",
  "disabled",
]);

function reasonMayMissWindow(reason: string): boolean {
  const code = reason.split(":")[0]?.trim() ?? reason;
  return !SELF_EXPLAINING_DECLINES.has(code);
}

/**
 * True when the current opening already had its check, so a later decline in
 * it (the hourly interval throttle) is not a missed window. With no bounded
 * opening (an always-open window), any earlier check counts.
 */
export function windowOpeningHasHadCheck(lastCheckedAt: Date | null, windowOpenedAt: Date | null): boolean {
  if (!lastCheckedAt) return false;
  return windowOpenedAt === null || lastCheckedAt.getTime() >= windowOpenedAt.getTime();
}

export type WindowDecline = ScheduledDecline & {
  /** Start of the window opening it declined in, or null when unbounded. */
  windowOpenedAt: string | null;
};

/** The last in-window decline, or null. Never throws: a status read must not break on it. */
export async function getWindowDecline(): Promise<WindowDecline | null> {
  try {
    const row = await prisma.platformConfig.findUnique({ where: { key: WINDOW_DECLINE_CONFIG_KEY } });
    const value = row?.value as { reason?: unknown; at?: unknown; windowOpenedAt?: unknown } | null;
    const reason = typeof value?.reason === "string" ? value.reason : null;
    const at = typeof value?.at === "string" ? value.at : null;
    const windowOpenedAt = typeof value?.windowOpenedAt === "string" ? value.windowOpenedAt : null;
    return reason && at ? { reason, at, windowOpenedAt } : null;
  } catch {
    return null;
  }
}

/**
 * The window decline the operator should still see: no check has run since it
 * was recorded, so that window went (or is going) without an upgrade check.
 */
export function missedWindowDecline(
  decline: WindowDecline | null,
  lastCheckedAt: Date | null,
): WindowDecline | null {
  return declineIsCurrent(decline, lastCheckedAt) ? decline : null;
}

export async function getScheduledDecline(): Promise<ScheduledDecline | null> {
  const row = await prisma.platformConfig.findUnique({ where: { key: DECLINE_CONFIG_KEY } });
  const value = row?.value as { reason?: unknown; at?: unknown } | null;
  const reason = typeof value?.reason === "string" ? value.reason : null;
  const at = typeof value?.at === "string" ? value.at : null;
  return reason && at ? { reason, at } : null;
}
