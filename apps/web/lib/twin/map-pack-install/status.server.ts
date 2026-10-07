import "server-only";

// Progress of a street-map pack install (BI-43BBCC26), kept beside the other
// platform settings so the Street maps panel can show it.

import { prisma } from "@dpf/db";

export const MAP_PACK_INSTALL_STATUS_KEY = "map-packs.install.status";

export type MapPackInstallStatus = {
  state: "idle" | "planning" | "downloading" | "finalizing" | "done" | "failed";
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
const STALE_MS = 30 * 60 * 1000;

export function parseInstallStatus(value: unknown): MapPackInstallStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return IDLE_INSTALL;
  const v = value as Partial<MapPackInstallStatus>;
  const states = ["idle", "planning", "downloading", "finalizing", "done", "failed"] as const;
  return {
    state: states.includes(v.state as never) ? (v.state as MapPackInstallStatus["state"]) : "idle",
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
  if (!["planning", "downloading", "finalizing"].includes(status.state)) return false;
  const at = Date.parse(status.updatedAt ?? "");
  return Number.isFinite(at) && now - at < STALE_MS;
}

export async function readInstallStatus(): Promise<MapPackInstallStatus> {
  const row = await prisma.platformConfig.findUnique({ where: { key: MAP_PACK_INSTALL_STATUS_KEY }, select: { value: true } });
  return parseInstallStatus(row?.value);
}

export async function writeInstallStatus(patch: Partial<MapPackInstallStatus>): Promise<void> {
  const next = { ...(await readInstallStatus()), ...patch, updatedAt: new Date().toISOString() };
  await prisma.platformConfig.upsert({
    where: { key: MAP_PACK_INSTALL_STATUS_KEY },
    create: { key: MAP_PACK_INSTALL_STATUS_KEY, value: next },
    update: { value: next },
  });
}
