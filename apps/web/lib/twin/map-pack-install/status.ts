// The street-map pack install status contract (BI-43BBCC26), shared by the
// server that writes it and the Street maps panel that shows it, so both agree
// on which states mean an install is still running.

export const INSTALL_STATES = ["idle", "planning", "downloading", "finalizing", "done", "failed"] as const;
export type MapPackInstallState = (typeof INSTALL_STATES)[number];

/** States in which a run is working, unless it has stalled. */
export const IN_FLIGHT_STATES: readonly MapPackInstallState[] = ["planning", "downloading", "finalizing"];

export type MapPackInstallStatus = {
  state: MapPackInstallState;
  packId: string | null;
  region: string | null;
  chunksDone: number;
  chunkCount: number;
  totalBytes: number;
  error: string | null;
  updatedAt: string | null;
};

export const IDLE_INSTALL: MapPackInstallStatus = {
  state: "idle", packId: null, region: null, chunksDone: 0, chunkCount: 0, totalBytes: 0, error: null, updatedAt: null,
};

/** A run counts as stalled after this long without progress, so a dead run never blocks a retry. */
export const STALE_MS = 30 * 60 * 1000;

export function parseInstallStatus(value: unknown): MapPackInstallStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return IDLE_INSTALL;
  const v = value as Partial<MapPackInstallStatus>;
  return {
    state: INSTALL_STATES.includes(v.state as never) ? (v.state as MapPackInstallState) : "idle",
    packId: typeof v.packId === "string" ? v.packId : null,
    region: typeof v.region === "string" ? v.region : null,
    chunksDone: Number(v.chunksDone) || 0,
    chunkCount: Number(v.chunkCount) || 0,
    totalBytes: Number(v.totalBytes) || 0,
    error: typeof v.error === "string" ? v.error : null,
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null,
  };
}

export function isInstallRunning(status: MapPackInstallStatus, now = Date.now()): boolean {
  if (!IN_FLIGHT_STATES.includes(status.state)) return false;
  const at = Date.parse(status.updatedAt ?? "");
  return Number.isFinite(at) && now - at < STALE_MS;
}

/** In flight by its state, but no progress for longer than STALE_MS. */
export function isInstallStalled(status: MapPackInstallStatus, now = Date.now()): boolean {
  return IN_FLIGHT_STATES.includes(status.state) && !isInstallRunning(status, now);
}
