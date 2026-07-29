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
 *   coworkerMemoryNote: {
 *     updateMany(args: object): Promise<{count: number}>,
 *   },
 *   researchProposal: {
 *     updateMany(args: object): Promise<{count: number}>,
 *   },
 *   decisionInteraction: {
 *     updateMany(args: object): Promise<{count: number}>,
 *   },
 * }} db
 * @param {Date} now
 * @param {{dbNull?: unknown}} options
 */
export async function convergeUxSweepFixture(db, now = new Date(), { dbNull } = {}) {
  if (dbNull === undefined) {
    throw new Error("dbNull is required to converge unresolved JSON-null decisions");
  }

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

  // The authenticated baseline represents a clean owner workspace. Three
  // independently produced row types can add the conditional weekly-digest
  // suffix after the seed or while the portal starts. Converge those source
  // rows in the disposable sweep database on both fixture passes instead of
  // teaching the route assertion to tolerate either DOM.
  const [memoryNotes, researchProposals, deferredDecisions] = await Promise.all([
    db.coworkerMemoryNote.updateMany({
      where: { supersededAt: null },
      data: { supersededAt: now },
    }),
    db.researchProposal.updateMany({
      where: { status: "pending" },
      data: { status: "declined", decidedAt: now },
    }),
    db.decisionInteraction.updateMany({
      where: {
        outcomeType: "defer",
        buildId: null,
        taskRunId: null,
        humanOutcome: { equals: dbNull },
      },
      data: {
        humanOutcome: {
          disposition: "fixture-converged",
          fixture: "ux-route-sweep",
        },
      },
    }),
  ]);

  return {
    setupChanged: existingSetup === null,
    setupProgressId: setupProgress.id,
    refreshedRuntimeTargets: heartbeat.count,
    convergedWeeklyDigestInputs: {
      coworkerMemoryNotes: memoryNotes.count,
      researchProposals: researchProposals.count,
      unlinkedDeferredDecisions: deferredDecisions.count,
    },
  };
}
