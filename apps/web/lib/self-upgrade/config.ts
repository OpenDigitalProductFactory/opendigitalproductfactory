import { prisma } from "@dpf/db";

export type MaintenanceWindow = {
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
};

/**
 * Where the bytes of an upgrade come from. See the governed-upgrade-lifecycle
 * spec §5.0.
 * - `upstream` (default): the install tracks an upstream release train. On
 *   upgrade the orchestrator fetches the upstream target and MERGES it into the
 *   durable install branch in the host clone, preserving local commits, then
 *   builds the merged tree. The deployed stamp is the real merge-commit SHA.
 * - `local`: self-hosted / contributor / air-gapped. The working tree is built
 *   as-is and stamped with its own HEAD (plus `-dirty` when uncommitted), never
 *   labelled with an upstream SHA it does not contain.
 */
export type UpgradeSourceMode = "upstream" | "local";

export const DEFAULT_INSTALL_BRANCH = "dpf/install";

export type SelfUpgradeConfig = {
  enabled: boolean;
  channel: string;
  checkIntervalHours: number;
  healthTarget: number;
  maintenanceWindows: MaintenanceWindow[];
  hostInstallPath?: string;
  hostSourceMountPath?: string;
  composeProject?: string;
  portalContainerName?: string;
  dbContainerName?: string;
  repositoryRemote?: string;
  repositoryBranch?: string;
  healthUrl?: string;
  promoterImage?: string;
  /** How the upgrade source is resolved. Defaults to "upstream". */
  sourceMode: UpgradeSourceMode;
  /**
   * The durable per-install branch in the host clone that carries local
   * commits and receives the upstream merge. Defaults to `dpf/install`.
   */
  installBranch: string;
};

const DEFAULTS: SelfUpgradeConfig = {
  enabled: false,
  channel: "stable",
  checkIntervalHours: 24,
  healthTarget: 100,
  maintenanceWindows: [],
  sourceMode: "upstream",
  installBranch: DEFAULT_INSTALL_BRANCH,
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

/**
 * Returns the next datetime a maintenance window opens, scanning the next 7
 * days. If a window is currently active, returns `now` (the scheduled upgrade
 * can run on the next hourly cron tick). Returns null when no windows are
 * configured — meaning scheduled upgrades will never fire on their own.
 */
export function nextMaintenanceWindowStart(
  config: SelfUpgradeConfig,
  now?: Date,
): Date | null {
  if (config.maintenanceWindows.length === 0) return null;
  const base = now ?? new Date();
  if (isInMaintenanceWindow(config, base)) return base;

  let best: Date | null = null;
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(base);
    day.setDate(base.getDate() + offset);
    const dow = day.getDay();
    for (const w of config.maintenanceWindows) {
      if (!w.dayOfWeek.includes(dow)) continue;
      const [h, m] = w.startTime.split(":").map(Number);
      const start = new Date(day);
      start.setHours(h, m, 0, 0);
      if (start.getTime() > base.getTime() && (!best || start < best)) {
        best = start;
      }
    }
  }
  return best;
}

export const SELF_UPGRADE_CONFIG_KEY = "self_upgrade";
const LEGACY_SELF_UPGRADE_CONFIG_KEY = "portal.selfUpgrade";

export async function getSelfUpgradeConfig(): Promise<SelfUpgradeConfig> {
  const row =
    (await prisma.platformConfig.findUnique({
      where: { key: SELF_UPGRADE_CONFIG_KEY },
    })) ??
    (await prisma.platformConfig.findUnique({
      where: { key: LEGACY_SELF_UPGRADE_CONFIG_KEY },
    }));
  return parseSelfUpgradeConfig(row?.value ?? null);
}

export function parseSelfUpgradeConfig(raw: unknown): SelfUpgradeConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  const cfg = raw as Record<string, unknown>;
  const parsed: SelfUpgradeConfig = {
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
    // Only "upstream" | "local" are valid; anything else falls back to the
    // safe default rather than silently building an unknown source posture.
    sourceMode: cfg.sourceMode === "local" ? "local" : DEFAULTS.sourceMode,
    installBranch:
      typeof cfg.installBranch === "string" && cfg.installBranch.trim().length > 0
        ? cfg.installBranch.trim()
        : DEFAULTS.installBranch,
  };
  for (const key of [
    "hostInstallPath",
    "hostSourceMountPath",
    "composeProject",
    "portalContainerName",
    "dbContainerName",
    "repositoryRemote",
    "repositoryBranch",
    "healthUrl",
    "promoterImage",
  ] as const) {
    if (typeof cfg[key] === "string" && cfg[key].trim().length > 0) {
      parsed[key] = cfg[key];
    }
  }
  return parsed;
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
