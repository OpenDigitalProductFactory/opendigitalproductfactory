// apps/web/lib/self-upgrade/blackout.ts
//
// Whether an operator-declared BlackoutPeriod currently pauses the UNATTENDED
// scheduled self-upgrade (BI-59591B14). A self-upgrade drains + restarts the
// customer's portal and registers as a (standard) ChangeRequest, so it respects
// the same operator blackout windows that gate other changes (deployment-windows.ts)
// — UNLESS the blackout explicitly excepts self-upgrade. Manual / forced upgrades
// bypass (the operator is choosing this moment), exactly like the maintenance-window
// gate. Quiescence already defers an upgrade that collides with ACTIVE work; this
// adds the proactive "operator declared a no-change period" guard quiescence
// cannot see (the period may be declared days ahead, with nothing yet running).
//
// Pure predicate + a fail-open DB reader (a best-effort guard must never throw
// into the cron gate or the status read).

import { prisma } from "@dpf/db";

export type ActiveBlackout = { name: string; endAt: Date };

type BlackoutRow = {
  name: string;
  startAt: Date;
  endAt: Date;
  exceptions: string[];
};

// Change-type labels that, when present in a blackout's `exceptions`, let the
// self-upgrade proceed during that blackout. Mirrors the exceptions rule in
// deployment-windows.ts (a blackout blocks a change unless its type is excepted);
// self-upgrade registers as a "standard" change.
const SELF_UPGRADE_EXCEPTION_KEYS = ["self-upgrade", "standard"];

/**
 * The active blackout blocking a scheduled self-upgrade at `now`, or null. A
 * blackout is active when `startAt <= now <= endAt`; it blocks unless its
 * `exceptions` opt self-upgrade out. Pure + deterministic.
 */
export function findActiveSelfUpgradeBlackout(
  blackouts: BlackoutRow[],
  now: Date,
): ActiveBlackout | null {
  for (const b of blackouts) {
    if (b.startAt <= now && now <= b.endAt) {
      const excepted = b.exceptions.some((e) => SELF_UPGRADE_EXCEPTION_KEYS.includes(e));
      if (!excepted) return { name: b.name, endAt: b.endAt };
    }
  }
  return null;
}

/**
 * System (no-auth) reader: the active self-upgrade blackout for the active
 * business profile at `now`, or null. Fail-open.
 */
export async function getActiveSelfUpgradeBlackout(now?: Date): Promise<ActiveBlackout | null> {
  const at = now ?? new Date();
  try {
    const profile = await prisma.businessProfile.findFirst({
      where: { isActive: true },
      select: {
        blackoutPeriods: {
          where: { endAt: { gte: at } },
          select: { name: true, startAt: true, endAt: true, exceptions: true },
        },
      },
    });
    if (!profile) return null;
    return findActiveSelfUpgradeBlackout(profile.blackoutPeriods, at);
  } catch {
    return null;
  }
}
