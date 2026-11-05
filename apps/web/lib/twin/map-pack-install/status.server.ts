import "server-only";

// Progress of a street-map pack install (BI-43BBCC26), kept beside the other
// platform settings so the Street maps panel can show it.

import { prisma } from "@dpf/db";

import { agentEventBus } from "@/lib/agent-event-bus";

import { isInstallRunning, parseInstallStatus, type MapPackInstallStatus } from "./status";

export const MAP_PACK_INSTALL_STATUS_KEY = "map-packs.install.status";

export {
  IDLE_INSTALL,
  IN_FLIGHT_STATES,
  isInstallRunning,
  isInstallStalled,
  parseInstallStatus,
  type MapPackInstallStatus,
} from "./status";

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
  // Persisted first; the event only tells open panels to re-read the projection.
  agentEventBus.broadcastSystem({ type: "system:map-pack-install", packId: next.packId, state: next.state, observedAt: next.updatedAt });
}

/** The Street maps panel's status projection: the stored status and the server's running check. */
export type MapPackInstallSnapshot = { status: MapPackInstallStatus; running: boolean };

export async function readInstallSnapshot(): Promise<MapPackInstallSnapshot> {
  const status = await readInstallStatus();
  return { status, running: isInstallRunning(status) };
}
