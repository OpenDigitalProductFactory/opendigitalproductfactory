import { getJobEngineHealth, type JobEngineHealth } from "@/lib/queue/job-engine-health";
import { getCooldownUntil } from "@/lib/self-upgrade/cooldown";
import { getQuiescenceActivity } from "@/lib/self-upgrade/quiescence";
import { getLatestRun } from "@/lib/self-upgrade/run-store";
import type { LatestRun, QuiescenceActivity } from "@/lib/self-upgrade/run-types";

export type SelfUpgradeStatusSnapshot = {
  observedAt: string;
  latestRun: LatestRun | null;
  quiescence: QuiescenceActivity;
  cooldownUntil: string | null;
  jobEngine: JobEngineHealth;
};

/**
 * Navigation-safe read model for live self-upgrade observation.
 *
 * Latency budget: bounded operational reads only. Do not add git, network,
 * inference, release-history, or impact-summary work to this projection.
 */
export async function getSelfUpgradeStatusSnapshot(
  now: Date = new Date(),
): Promise<SelfUpgradeStatusSnapshot> {
  const [latestRun, quiescence, cooldownUntil, jobEngine] = await Promise.all([
    getLatestRun(),
    getQuiescenceActivity(now),
    getCooldownUntil(),
    getJobEngineHealth(),
  ]);

  return {
    observedAt: now.toISOString(),
    latestRun,
    quiescence,
    cooldownUntil: cooldownUntil?.toISOString() ?? null,
    jobEngine,
  };
}
