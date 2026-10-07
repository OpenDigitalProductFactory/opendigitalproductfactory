// apps/web/lib/self-upgrade/effective-window.ts
//
// The ONE resolver for "which maintenance window governs self-upgrade right
// now, is it open, and when does it next open". The precedence used to be
// re-derived in three places (the status read, the scheduled gate and the
// agent request gate) with small differences in what each returned. A request
// that is deferred to the window (BI-2128872C) must promise the same window the
// status panel shows and the scheduled cron applies, so they share this.
//
// Precedence: an explicit operator-configured maintenanceWindows array wins;
// otherwise, for an effectively-24/7 store with a known timezone, an
// auto-selected low-traffic overnight window (BI-A6382FB9); otherwise the
// operating-hours "store closed" derivation. A 24/7 store with no derivable
// timezone reports `needs-timezone`: no window can be scheduled safely.

import { resolveOperatingScheduleForSystem } from "@/lib/operating-hours-read";
import type { WeeklySchedule } from "@/lib/operating-hours-types";
import { nextAutoWindowOpen, resolveAutoUpgradeWindow } from "@/lib/self-upgrade/auto-window";
import {
  nextMaintenanceWindowStart,
  type MaintenanceWindow,
  type SelfUpgradeConfig,
} from "@/lib/self-upgrade/config";
import { isUpgradeWindowOpen, nextUpgradeWindowOpen } from "@/lib/self-upgrade/window";

export type EffectiveWindowSource = "explicit" | "operating-hours" | "auto-overnight" | "needs-timezone";

export type EffectiveUpgradeWindow = {
  source: EffectiveWindowSource;
  /**
   * Whether upgrades may run at `now`. Always false for `needs-timezone`: that
   * source only arises for an effectively-24/7 store, which never closes, and
   * no window is evaluated for it.
   */
  open: boolean;
  /** Next instant the window opens. Null while open, for `needs-timezone`, or when none is found. */
  nextWindowStart: Date | null;
  /** The explicit or auto-selected windows in force (undefined for operating-hours). */
  windows: MaintenanceWindow[] | undefined;
  schedule: WeeklySchedule;
  timezone: string;
};

export async function resolveEffectiveUpgradeWindow(args: {
  config: Pick<SelfUpgradeConfig, "maintenanceWindows">;
  now: Date;
}): Promise<EffectiveUpgradeWindow> {
  const { config, now } = args;
  const { schedule, timezone, timezoneKnown, lowTrafficWindows } =
    await resolveOperatingScheduleForSystem();
  const hasExplicitWindows = config.maintenanceWindows.length > 0;
  const auto = hasExplicitWindows
    ? null
    : resolveAutoUpgradeWindow({ schedule, timeZone: timezone, timezoneKnown, lowTrafficWindows, now });
  const windows = hasExplicitWindows
    ? config.maintenanceWindows
    : auto?.kind === "auto-overnight"
      ? auto.windows
      : undefined;
  const source: EffectiveWindowSource = hasExplicitWindows
    ? "explicit"
    : auto?.kind === "auto-overnight"
      ? "auto-overnight"
      : auto?.kind === "needs-timezone"
        ? "needs-timezone"
        : "operating-hours";
  const open = source !== "needs-timezone" &&
    isUpgradeWindowOpen({ explicitWindows: windows, schedule, timeZone: timezone, now });

  let nextWindowStart: Date | null = null;
  if (source === "explicit") {
    nextWindowStart = nextMaintenanceWindowStart(config as SelfUpgradeConfig, now, timezone);
  } else if (!open && source === "auto-overnight" && windows) {
    nextWindowStart = nextAutoWindowOpen(windows, now, timezone);
  } else if (!open && source === "operating-hours") {
    nextWindowStart = nextUpgradeWindowOpen(schedule, now, timezone);
  }

  return { source, open, nextWindowStart, windows, schedule, timezone };
}
