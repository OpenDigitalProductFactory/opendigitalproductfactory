/**
 * Converge the database state required by the authenticated UX route sweep.
 *
 * The root-portal heartbeat is deliberately refreshed here, after the portal
 * has started. Seeding happens before artifact discovery and production build,
 * so using the seed timestamp makes the change-lanes route cross its ten-minute
 * stale threshold on slower-but-valid CI paths.
 *
 * @param {{
 *   platformSetupProgress: {
 *     findFirst(args: object): Promise<{id: string} | null>,
 *     create(args: object): Promise<{id: string}>,
 *   },
 *   runtimeTarget: {
 *     updateMany(args: object): Promise<{count: number}>,
 *   },
 * }} db
 * @param {Date} now
 */
export async function convergeUxSweepFixture(db, now = new Date()) {
  const existingSetup = await db.platformSetupProgress.findFirst({
    where: { completedAt: { not: null } },
    select: { id: true },
  });

  const setupProgress =
    existingSetup ??
    (await db.platformSetupProgress.create({
      data: { currentStep: "complete", completedAt: now },
      select: { id: true },
    }));

  const heartbeat = await db.runtimeTarget.updateMany({
    where: { targetId: "RT-ROOT-PORTAL", status: "running" },
    data: { lastHeartbeatAt: now },
  });

  return {
    setupChanged: existingSetup === null,
    setupProgressId: setupProgress.id,
    refreshedRuntimeTargets: heartbeat.count,
  };
}
