import { prisma } from "@dpf/db";

export async function isUnifiedCoworkerEnabled(): Promise<boolean> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "USE_UNIFIED_COWORKER" },
  });
  const val = config?.value as { enabled?: boolean } | null;
  // BI-45514C4E: unified is now the DEFAULT. The legacy prompt path strips the
  // whole skill plane (including decision-routing), so a fresh install with no
  // PlatformConfig row must get the unified assembler. Legacy is opt-in only: an
  // operator must explicitly persist {enabled:false} to fall back. Reversible.
  return val?.enabled !== false;
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
