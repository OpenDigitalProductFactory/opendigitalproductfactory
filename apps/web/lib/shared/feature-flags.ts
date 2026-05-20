import { prisma } from "@dpf/db";

export async function isUnifiedCoworkerEnabled(): Promise<boolean> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "USE_UNIFIED_COWORKER" },
  });
  const val = config?.value as { enabled?: boolean } | null;
  return val?.enabled === true;
}

/**
 * BI-4ab6be39 stall-detection watchdog cron. Defaults false until
 * instrumentation (Phase D) is in place on the hot loops, then flipped to
 * true via Admin > Platform Development or directly in PlatformConfig.
 */
export async function isStallWatchdogEnabled(): Promise<boolean> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "STALL_WATCHDOG_ENABLED" },
  });
  const val = config?.value as { enabled?: boolean } | null;
  return val?.enabled === true;
}
