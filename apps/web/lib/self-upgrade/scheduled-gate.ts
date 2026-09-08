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

import { resolveOperatingScheduleForSystem } from "@/lib/operating-hours-read";
import { resolveAutoUpgradeWindow } from "@/lib/self-upgrade/auto-window";
import { getActiveSelfUpgradeBlackout } from "@/lib/self-upgrade/blackout";
import type { SelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { getLastCheckedAt, isCheckIntervalElapsed } from "@/lib/self-upgrade/last-check";
import { isUpgradeWindowOpen } from "@/lib/self-upgrade/window";

const DECLINE_CONFIG_KEY = "self_upgrade.lastScheduledDecline";

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
 * no more often than the operator configured.
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
  const { schedule, timezone, timezoneKnown, lowTrafficWindows } =
    await resolveOperatingScheduleForSystem();
  const auto = config.maintenanceWindows.length > 0
    ? null
    : resolveAutoUpgradeWindow({ schedule, timeZone: timezone, timezoneKnown, lowTrafficWindows });
  if (auto?.kind === "needs-timezone") return { reason: "no-window-needs-timezone" };
  const explicitWindows = config.maintenanceWindows.length > 0
    ? config.maintenanceWindows
    : auto?.kind === "auto-overnight" ? auto.windows : undefined;
  if (!isUpgradeWindowOpen({ explicitWindows, schedule, timeZone: timezone })) {
    return { reason: "outside-window" };
  }
  if (!args.dryRun) {
    const lastCheckedAt = await getLastCheckedAt();
    if (!isCheckIntervalElapsed(lastCheckedAt, config.checkIntervalHours, now)) {
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
 * When the next unattended check becomes due. Null when it is due now (never
 * checked, or a non-positive interval, which means no throttle). Mirrors
 * `isCheckIntervalElapsed` exactly so the status a caller reads and the gate
 * the cron applies can never disagree.
 */
export function nextScheduledCheckAt(
  lastCheckedAt: Date | null,
  intervalHours: number,
  now: Date,
): Date | null {
  if (!lastCheckedAt) return null;
  if (!(intervalHours > 0)) return null;
  const next = new Date(lastCheckedAt.getTime() + intervalHours * 60 * 60 * 1000);
  return next.getTime() <= now.getTime() ? null : next;
}

/** True when the unattended path is throttled right now. */
export function scheduledCheckIsThrottled(
  lastCheckedAt: Date | null,
  intervalHours: number,
  now: Date,
): boolean {
  return nextScheduledCheckAt(lastCheckedAt, intervalHours, now) !== null;
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

/** Record why an unattended tick declined. Never throws into the caller. */
export async function recordScheduledDecline(reason: string, now: Date): Promise<void> {
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
}

export async function getScheduledDecline(): Promise<ScheduledDecline | null> {
  const row = await prisma.platformConfig.findUnique({ where: { key: DECLINE_CONFIG_KEY } });
  const value = row?.value as { reason?: unknown; at?: unknown } | null;
  const reason = typeof value?.reason === "string" ? value.reason : null;
  const at = typeof value?.at === "string" ? value.at : null;
  return reason && at ? { reason, at } : null;
}
