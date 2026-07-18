import { prisma } from "@dpf/db";
import { DEFAULT_COOLDOWN_MINUTES } from "./cooldown";
import {
  DEFAULT_BATCH_MIN_PENDING_PRS,
  DEFAULT_BATCH_MAX_WAIT_HOURS,
} from "./release-batch";
import { isWithinWindows, nextWindowStartForWindows } from "./windows-eval";

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
export type SelfUpgradeReadinessOwner = "bridge" | "portal" | "unavailable";
export type SelfUpgradeReadinessMode = "enforced" | "legacy-bootstrap";

export const DEFAULT_INSTALL_BRANCH = "dpf/install";

export type SelfUpgradeConfig = {
  enabled: boolean;
  channel: string;
  checkIntervalHours: number;
  /**
   * Backoff (minutes) before self-upgrade re-attempts a drain after a DEFERRED
   * or FAILED run. Stops the portal re-entering quiescence within minutes of a
   * defer (active session) or a failed swap (e.g. missing promoter image).
   * Applies to every trigger source, not just the scheduled poll. Defaults to
   * {@link DEFAULT_COOLDOWN_MINUTES}.
   */
  cooldownMinutes: number;
  /**
   * Release batching: routine (scheduled / agent-requested) upgrades wait
   * until at least this many merged upstream PRs have accumulated since the
   * deployed lineage marker, so the portal is not drained once per merged PR.
   * <=1 disables batching (any new commit upgrades). Operator manual and
   * force triggers are never batch-gated.
   */
  batchMinPendingPrs: number;
  /**
   * Bounded-staleness valve for release batching: once the OLDEST pending
   * merged commit has waited this many hours, the batch becomes eligible even
   * below `batchMinPendingPrs`, so low-traffic installs still converge.
   * 0 disables the valve (wait for a full batch or an operator trigger).
   */
  batchMaxWaitHours: number;
  healthTarget: number;
  maintenanceWindows: MaintenanceWindow[];
  hostInstallPath?: string;
  hostSourceMountPath?: string;
  composeProject?: string;
  /**
   * The platform-correct compose chain the install was created with (relative
   * filenames), recorded by install-dpf.sh in install-state.json's composeFiles
   * and surfaced here so the self-upgrade promoter recreates the portal with the
   * SAME overlays the install uses. Empty/unset => promote.sh uses its base-only
   * fallback (never a platform overlay). Resolved with a process.env fallback in
   * the orchestrator (DPF_SELF_UPGRADE_COMPOSE_FILES).
   */
  composeFiles?: string[];
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
  /**
   * Run the upstream merge in a dedicated, process-owned workspace tree
   * INSTEAD of the operator's install clone. The workspace lives under
   * `${hostSourceMountPath}/.upgrade-workspace/` (so it shares the existing
   * bind-mount — no docker-compose change needed) and is git-ignored.
   * Resolves BI-A8A7CCFD / BI-888435E5 / BI-57E77CB4: contributor installs
   * whose install clone doubles as a dirty dev tree no longer collide with
   * the upgrade merge.
   *
   * BI-4043A64B: ALWAYS true. The legacy direct-merge fallback this once
   * toggled is retired — it mutated the host clone's working tree and corrupted
   * it. `parseSelfUpgradeConfig` forces this true regardless of stored value,
   * and `prepareUpgradeSource` refuses an upstream merge without a workspace.
   * The field is retained (not removed) for callers and forward-compat.
   */
  useIsolatedWorkspace: boolean;
  /** Compatibility disclosure; legacy bootstrap must never claim portal validation. */
  readinessMode?: SelfUpgradeReadinessMode;
  readinessOwner?: SelfUpgradeReadinessOwner;
  callerProtocolVersion?: number;
  /**
   * Override the in-container path of the upgrade workspace. Defaults to
   * `${hostSourceMountPath}/.upgrade-workspace`. Only consulted when
   * `useIsolatedWorkspace` is true.
   */
  upgradeWorkspaceMountPath?: string;
  /**
   * Override the HOST path of the upgrade workspace. The promoter mounts
   * this as `/host-source` instead of the install clone, so the image is
   * built from the merged workspace tree. Defaults to
   * `${hostInstallPath}/.upgrade-workspace`. Only consulted when
   * `useIsolatedWorkspace` is true.
   */
  upgradeWorkspaceHostPath?: string;
};

const DEFAULTS: SelfUpgradeConfig = {
  enabled: false,
  channel: "stable",
  checkIntervalHours: 24,
  cooldownMinutes: DEFAULT_COOLDOWN_MINUTES,
  batchMinPendingPrs: DEFAULT_BATCH_MIN_PENDING_PRS,
  batchMaxWaitHours: DEFAULT_BATCH_MAX_WAIT_HOURS,
  healthTarget: 100,
  maintenanceWindows: [],
  sourceMode: "upstream",
  installBranch: DEFAULT_INSTALL_BRANCH,
  // BI-A8A7CCFD — default-on isolation. Operators on installs without a
  // doubling-as-dev-tree problem see the same outcome (a clean merge into
  // dpf/install), but on contributor installs (where ~/dpf is dirty/divergent)
  // the upgrade no longer fails on the operator's WIP.
  useIsolatedWorkspace: true,
};

/**
 * Returns true if `now` (defaults to current time) falls within any of the
 * configured maintenance windows. Day/time are evaluated against `timeZone`
 * (IANA) — the STORE's clock — so an operator's "02:00-04:00" window fires at
 * 02:00 local, not 02:00 on the portal container's host clock (UTC). When
 * `timeZone` is omitted it falls back to host-local time (backward compatible).
 * Delegates to the pure {@link isWithinWindows} primitive (windows-eval.ts),
 * shared with the auto-selected 24/7 overnight window (auto-window.ts).
 */
export function isInMaintenanceWindow(
  config: SelfUpgradeConfig,
  now?: Date,
  timeZone?: string,
): boolean {
  return isWithinWindows(config.maintenanceWindows, now ?? new Date(), timeZone);
}

/**
 * Returns the next datetime a maintenance window opens. If a window is currently
 * active, returns `now` (the scheduled upgrade can run on the next hourly cron
 * tick). Returns null when no windows are configured — meaning scheduled
 * upgrades will never fire on their own. Delegates to the pure
 * {@link nextWindowStartForWindows} primitive (windows-eval.ts) so day-of-week
 * and start times resolve against the store's `timeZone`, not the host clock.
 */
export function nextMaintenanceWindowStart(
  config: SelfUpgradeConfig,
  now?: Date,
  timeZone?: string,
): Date | null {
  return nextWindowStartForWindows(config.maintenanceWindows, now ?? new Date(), timeZone);
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
    cooldownMinutes:
      typeof cfg.cooldownMinutes === "number" && cfg.cooldownMinutes >= 0
        ? cfg.cooldownMinutes
        : DEFAULTS.cooldownMinutes,
    batchMinPendingPrs:
      typeof cfg.batchMinPendingPrs === "number" &&
      Number.isFinite(cfg.batchMinPendingPrs) &&
      cfg.batchMinPendingPrs >= 0
        ? Math.floor(cfg.batchMinPendingPrs)
        : DEFAULTS.batchMinPendingPrs,
    batchMaxWaitHours:
      typeof cfg.batchMaxWaitHours === "number" &&
      Number.isFinite(cfg.batchMaxWaitHours) &&
      cfg.batchMaxWaitHours >= 0
        ? cfg.batchMaxWaitHours
        : DEFAULTS.batchMaxWaitHours,
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
    // BI-4043A64B — isolation is FORCED on. A stored `false` is no longer
    // honored: the legacy direct-merge it selected mutated the host clone's
    // working tree and corrupted it (721 files lost, 2026-06-15). prepare-source
    // refuses an upstream merge without a workspace, so this must stay true.
    useIsolatedWorkspace: true,
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
    "upgradeWorkspaceMountPath",
    "upgradeWorkspaceHostPath",
  ] as const) {
    if (typeof cfg[key] === "string" && cfg[key].trim().length > 0) {
      parsed[key] = cfg[key];
    }
  }
  // composeFiles is a string[] (compose filenames), parsed separately from the
  // string-valued keys above. Keep only non-empty string entries.
  if (Array.isArray(cfg.composeFiles)) {
    const files = cfg.composeFiles.filter(
      (f): f is string => typeof f === "string" && f.trim().length > 0,
    );
    if (files.length > 0) parsed.composeFiles = files;
  }
  if (cfg.readinessMode === "enforced" || cfg.readinessMode === "legacy-bootstrap") {
    parsed.readinessMode = cfg.readinessMode;
  }
  if (cfg.readinessOwner === "bridge" || cfg.readinessOwner === "portal" || cfg.readinessOwner === "unavailable") {
    parsed.readinessOwner = cfg.readinessOwner;
  }
  if (typeof cfg.callerProtocolVersion === "number" && Number.isInteger(cfg.callerProtocolVersion) && cfg.callerProtocolVersion > 0) {
    parsed.callerProtocolVersion = cfg.callerProtocolVersion;
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
