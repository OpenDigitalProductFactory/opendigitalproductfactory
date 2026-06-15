// apps/web/lib/release-health/state.ts
// BI-3630773C — last-known release verification state.
//
// PlatformConfig key-value row (same pattern as self_upgrade.lastCheckedAt
// in lib/self-upgrade/last-check.ts): the state is one small JSON blob, the
// health card reads it server-side, and it survives portal restarts without
// a dedicated model or migration.

import type { ReleaseStampSnapshot } from "./release-runs-reader";

const RELEASE_HEALTH_CONFIG_KEY = "release_health.latest";

export type ReleaseHealthState = {
  /** Latest observed stamp, or null when the repo has never been stamped. */
  snapshot: ReleaseStampSnapshot | null;
  /** ISO timestamp of the last successful poll. */
  checkedAt: string;
  /** Run id an open red-stamp notification was written for (alert dedupe). */
  notifiedRunId: number | null;
};

export async function loadReleaseHealthState(): Promise<ReleaseHealthState | null> {
  const { prisma } = await import("@dpf/db");
  const row = await prisma.platformConfig.findUnique({
    where: { key: RELEASE_HEALTH_CONFIG_KEY },
  });
  const value = row?.value as ReleaseHealthState | null | undefined;
  if (!value || typeof value.checkedAt !== "string") return null;
  return {
    snapshot: value.snapshot ?? null,
    checkedAt: value.checkedAt,
    notifiedRunId: typeof value.notifiedRunId === "number" ? value.notifiedRunId : null,
  };
}

export async function saveReleaseHealthState(state: ReleaseHealthState): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const value = state as unknown as object;
  await prisma.platformConfig.upsert({
    where: { key: RELEASE_HEALTH_CONFIG_KEY },
    update: { value },
    create: { key: RELEASE_HEALTH_CONFIG_KEY, value },
  });
}
