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

/**
 * BI-DE67A3EC — mint the deterministic work case the sweep needs to measure a
 * DETAIL route.
 *
 * The sweep could only ever measure routes with no dynamic segment, because
 * nothing produced an id to put in one. That left 87 routes unmeasurable, 53 of
 * them owner-facing — every surface where an operator actually reads state and
 * acts, including the whole of EP-WORK-POSTURE's operator UI.
 *
 * FIXED IDENTITY, NOT A SAMPLED ONE. The case is upserted under a constant
 * sourceId so the measured route is byte-stable across runs. Sampling a real row
 * would make the baseline flap with whatever the seed happened to produce, which
 * is the noise BI-4FF94533 already charged this gate for once.
 *
 * It carries a DECLARED posture so the room surface renders its populated state
 * rather than the "running platform defaults" empty one — measuring the empty
 * state would understate the page and defeat the point.
 */
async function convergeUxSweepWorkCase(db, now) {
  const SOURCE_TYPE = "ux-sweep";
  const SOURCE_ID = "ux-sweep-case";

  const queue = await db.workQueue.findFirst({ select: { id: true } });
  if (!queue) return { caseKey: null, reason: "no work queue exists to hold the fixture case" };

  const existing = await db.workItem.findFirst({
    where: { sourceType: SOURCE_TYPE, sourceId: SOURCE_ID },
    select: { id: true },
  });

  const item = existing
    ? await db.workItem.update({
        where: { id: existing.id },
        data: { status: "in_progress", updatedAt: now },
        select: { id: true },
      })
    : await db.workItem.create({
        data: {
          sourceType: SOURCE_TYPE,
          sourceId: SOURCE_ID,
          title: "Route sweep fixture case",
          description: "Deterministic work case the UX route sweep measures the case detail route against.",
          workerConstraint: {},
          queueId: queue.id,
          status: "in_progress",
        },
        select: { id: true },
      });

  // A room, so the posture section has something to resolve and render.
  const room = await db.workroom.findFirst({
    where: { capsuleId: "WC-UX-SWEEP" },
    select: { id: true },
  });
  const scopeClaims = [
    { workroomShape: "change-consequential", recordedAt: now.toISOString() },
    { workroomPosture: { proactivityLevel: "balanced" }, recordedAt: now.toISOString() },
  ];
  if (room) {
    await db.workroom.update({
      where: { id: room.id },
      data: { scopeClaims, workItemId: item.id, archivedAt: null },
    });
  } else {
    await db.workroom.create({
      data: {
        capsuleId: "WC-UX-SWEEP",
        title: "Route sweep fixture room",
        objective: "Give the sweep a room whose posture surface renders populated.",
        // Closed set, enforced by WorkCapsule_source_closed_set. "fixture" is not
        // a member and the constraint refused it — "manual" is the honest value
        // for a room created directly rather than adopted or raised from backlog.
        source: "manual",
        status: "working",
        activityKind: "delivery",
        workItemId: item.id,
        scopeClaims,
      },
    });
  }

  return { caseKey: encodeURIComponent(`${SOURCE_TYPE}:${SOURCE_ID}`), reason: null };
}

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

  const workCase = await convergeUxSweepWorkCase(db, now);

  return {
    workCase,
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
