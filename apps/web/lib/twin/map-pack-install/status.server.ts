import "server-only";

// Progress of a street-map pack install (BI-43BBCC26), kept beside the other
// platform settings so the Street maps panel can show it.

import { prisma } from "@dpf/db";

import { parseInstallStatus, type MapPackInstallStatus } from "./status";

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
}
