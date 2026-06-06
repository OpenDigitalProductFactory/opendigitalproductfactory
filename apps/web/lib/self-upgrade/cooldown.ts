// apps/web/lib/self-upgrade/cooldown.ts
//
// Backoff after a self-upgrade drain DEFERS or FAILS. Without it, a deferred run
// (active operator/dev session blocked the drain) or a failed swap (e.g. the
// promoter image is missing) re-enters the quiescence drain within seconds — the
// portal cycles draining↔normal every few minutes and refuses every new
// MCP/UX action with PORTAL_QUIESCING. The cooldown makes the NEXT attempt wait
// a bounded interval regardless of what re-triggered it (scheduled cron, manual
// `ops/self-upgrade.run` event, autonomous deploy), so a single defer/fail can't
// re-drain the portal minutes later.
//
// Operator `force` / `dryRun` bypass the cooldown (the operator is asking now).
// A successful swap clears it.
//
// Sibling to last-check.ts (the checkIntervalHours throttle): that gate only
// governs the SCHEDULED poll cadence; this one governs re-attempts after a
// non-success terminal outcome and applies to every trigger source.

import { prisma } from "@dpf/db";

const COOLDOWN_CONFIG_KEY = "self_upgrade.cooldownUntil";

/** Default backoff window (minutes) after a deferred/failed drain. */
export const DEFAULT_COOLDOWN_MINUTES = 30;

/**
 * True when `now` is before the recorded cooldown deadline. Pure +
 * deterministic so the orchestrator gate is unit-testable without IO.
 */
export function isInCooldown(cooldownUntil: Date | null, now: Date): boolean {
  if (!cooldownUntil) return false;
  return now.getTime() < cooldownUntil.getTime();
}

/** The active cooldown deadline, or null if none recorded / malformed. */
export async function getCooldownUntil(): Promise<Date | null> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: COOLDOWN_CONFIG_KEY },
  });
  const until = (row?.value as { until?: string } | null)?.until;
  if (!until) return null;
  const d = new Date(until);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Record a cooldown deadline `minutes` after `now`. A non-positive `minutes`
 * falls back to {@link DEFAULT_COOLDOWN_MINUTES} so a misconfigured zero can
 * never disable the backoff and reopen the tight re-drain loop.
 */
export async function recordCooldown(now: Date, minutes: number): Promise<void> {
  const span = minutes > 0 ? minutes : DEFAULT_COOLDOWN_MINUTES;
  const until = new Date(now.getTime() + span * 60 * 1000).toISOString();
  const value = { until, recordedAt: now.toISOString() };
  await prisma.platformConfig.upsert({
    where: { key: COOLDOWN_CONFIG_KEY },
    update: { value },
    create: { key: COOLDOWN_CONFIG_KEY, value },
  });
}

/** Clear any recorded cooldown (e.g. after a successful swap). */
export async function clearCooldown(): Promise<void> {
  await prisma.platformConfig.deleteMany({ where: { key: COOLDOWN_CONFIG_KEY } });
}
