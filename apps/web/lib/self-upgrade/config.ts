import { prisma } from "@dpf/db";

export type MaintenanceWindow = {
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
};

export type SelfUpgradeConfig = {
  enabled: boolean;
  channel: string;
  checkIntervalHours: number;
  healthTarget: number;
  maintenanceWindows: MaintenanceWindow[];
};

const DEFAULTS: SelfUpgradeConfig = {
  enabled: false,
  channel: "stable",
  checkIntervalHours: 24,
  healthTarget: 100,
  maintenanceWindows: [],
};

/**
 * Returns true if `now` (defaults to current time) falls within any of the
 * configured maintenance windows. Uses local timezone for day/time checks
 * (same semantics as the shared isInWindow in deployment-windows.ts).
 */
export function isInMaintenanceWindow(config: SelfUpgradeConfig, now?: Date): boolean {
  const d = now ?? new Date();
  const currentDay = d.getDay();
  const currentTime = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return config.maintenanceWindows.some((w) => {
    if (!w.dayOfWeek.includes(currentDay)) return false;
    if (w.startTime <= w.endTime) {
      return currentTime >= w.startTime && currentTime < w.endTime;
    }
    // Overnight window: e.g. 22:00-06:00 → matches >= 22:00 OR < 06:00
    return currentTime >= w.startTime || currentTime < w.endTime;
  });
}

export const SELF_UPGRADE_CONFIG_KEY = "portal.selfUpgrade";

export async function getSelfUpgradeConfig(): Promise<SelfUpgradeConfig> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: "portal.selfUpgrade" },
  });
  return parseSelfUpgradeConfig(row?.value ?? null);
}

export function parseSelfUpgradeConfig(raw: unknown): SelfUpgradeConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const cfg = raw as Record<string, unknown>;
  return {
    enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : DEFAULTS.enabled,
    channel:
      typeof cfg.channel === "string" && cfg.channel.length > 0
        ? cfg.channel
        : DEFAULTS.channel,
    checkIntervalHours:
      typeof cfg.checkIntervalHours === "number" && cfg.checkIntervalHours > 0
        ? cfg.checkIntervalHours
        : DEFAULTS.checkIntervalHours,
    healthTarget:
      typeof cfg.healthTarget === "number" &&
      cfg.healthTarget >= 0 &&
      cfg.healthTarget <= 100
        ? cfg.healthTarget
        : DEFAULTS.healthTarget,
    maintenanceWindows: parseWindows(cfg.maintenanceWindows),
  };
}

function parseWindows(raw: unknown): MaintenanceWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidWindow);
}

function isValidWindow(w: unknown): w is MaintenanceWindow {
  if (!w || typeof w !== "object") return false;
  const win = w as Record<string, unknown>;
  return (
    Array.isArray(win.dayOfWeek) &&
    win.dayOfWeek.every((d) => typeof d === "number" && d >= 0 && d <= 6) &&
    typeof win.startTime === "string" &&
    /^\d{2}:\d{2}$/.test(win.startTime) &&
    typeof win.endTime === "string" &&
    /^\d{2}:\d{2}$/.test(win.endTime)
  );
}
