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

  // A storefront with listed animals (BI-899D7F00). Every /storefront/* route
  // redirects to /storefront/setup without a StorefrontConfig, which is why the
  // storefront admin family sat in ROUTE_SWEEP_EXCLUSIONS as
  // "storefront-setup-required". A route becomes eligible in the PR that adds
  // its honest fixture context; this is that context for the adoption waiting
  // list: one pet-rescue storefront on the seeded platform organisation, the
  // animals-available section, and four listed animals covering the ordering
  // rules the owner decided — two dated, one future-dated, one undated.
  const storefront = await convergeStorefrontFixture(db, now);

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
    storefront,
    convergedWeeklyDigestInputs: {
      coworkerMemoryNotes: memoryNotes.count,
      researchProposals: researchProposals.count,
      unlinkedDeferredDecisions: deferredDecisions.count,
    },
  };
}

/**
 * Populated CI estate, before the authenticated shell's first-run host scan.
 * Constant keys make both fixture passes idempotent. Never replace real runs
 * or delete observations. Canonical persistence owns the atomic run/estate
 * transaction and its graph projection; do not invent row-only substitutes.
 */
export function uxSweepEstateFacts() {
  const items = [
    ["host", "Fixture machine", "hostname:ux-sweep-machine", { hostname: "ux-sweep-machine", platform: "linux" }],
    ["host", "LAN Host 10.1.0.10", "arp:02AABBCCDD10", { address: "10.1.0.10", mac: "02:AA:BB:CC:DD:10" }],
    ["host", "LAN Host 172.18.0.2", "arp:02AABBCCDD20", { address: "172.18.0.2", mac: "02:AA:BB:CC:DD:20" }],
    ["gateway", "Gateway 10.1.0.1", "gateway:10.1.0.1", { address: "10.1.0.1" }],
    ["subnet", "10.1.0.0/24", "subnet:10.1.0.0/24", { networkAddress: "10.1.0.0/24" }],
    ["network_interface", "Interface 10.1.0.10", "nic:02AABBCCDD10", { address: "10.1.0.10", mac: "02:AA:BB:CC:DD:10" }],
    ["docker_runtime", "Docker", "socket:/var/run/docker.sock", { socketPath: "/var/run/docker.sock", serverVersion: "26.0.0" }],
    ["docker_container", "Fixture portal", "container:ux-sweep-portal", { containerName: "ux-sweep-portal" }],
    ["gateway", "Docker GW fixture (172.18.0.1)", "docker-gw:fixture", { address: "172.18.0.1" }],
    ["gateway", "Docker GW bridge (172.17.0.1)", "docker-gw:bridge", { address: "172.17.0.1" }],
  ].map(([itemType, name, externalRef, attributes]) => ({
    sourceKind: "dpf_bootstrap", itemType, name, externalRef, attributes,
  }));
  const relationships = [
    [1, 4, "MEMBER_OF"], [3, 4, "MEMBER_OF"], [5, 4, "MEMBER_OF"],
    [0, 5, "HAS_INTERFACE"], [6, 7, "HOSTS"],
  ].map(([from, to, relationshipType]) => ({
    sourceKind: "dpf_bootstrap", relationshipType,
    fromExternalRef: items[from].externalRef, toExternalRef: items[to].externalRef,
  }));
  return { items, relationships };
}

export async function convergeUxSweepEstate(db, now, persist) {
  const real = await db.discoveryRun.findFirst({
    where: { sourceSlug: { not: "ux-route-sweep" } }, select: { id: true },
  });
  if (real) return null;
  const existing = await db.discoveryRun.findFirst({
    where: { sourceSlug: "ux-route-sweep", runKey: "DISC-UX-SWEEP" },
    select: { id: true },
  });
  if (existing) return { runId: existing.id, reused: true };
  if (typeof persist !== "function") throw new Error("Canonical estate persistence is required");
  // The normal discovery transaction owns attribution, membership, quality
  // issues and graph-mirror projection. A row-only sentinel cannot stand in
  // for the read model the browser actually renders.
  const result = await persist(uxSweepEstateFacts(), {
    runKey: "DISC-UX-SWEEP", sourceSlug: "ux-route-sweep", trigger: "fixture",
  });
  return { runId: result.runId, reused: false };
}

/**
 * Idempotent: one storefront on the seeded platform organisation, one
 * animals-available section, four listed animals with stable refs. Returns
 * null (and provisions nothing) when the seed carries no pet-rescue archetype,
 * so a sweep against an older seed still runs — the storefront routes then stay
 * measured-as-redirect and the sweep reports them, rather than the fixture
 * throwing.
 */
export async function convergeStorefrontFixture(db, now) {
  const org = await db.organization.findFirst({ where: { slug: "platform" }, select: { id: true } });
  const archetype = await db.storefrontArchetype.findFirst({
    where: { archetypeId: "pet-rescue" },
    select: { id: true },
  });
  if (!org || !archetype) return null;

  const existing = await db.storefrontConfig.findFirst({
    where: { organizationId: org.id },
    select: { id: true },
  });
  const config =
    existing ??
    (await db.storefrontConfig.create({
      data: { organizationId: org.id, archetypeId: archetype.id, isPublished: false },
      select: { id: true },
    }));

  const section = await db.storefrontSection.findFirst({
    where: { storefrontId: config.id, type: "animals-available" },
    select: { id: true },
  });
  if (!section) {
    await db.storefrontSection.create({
      data: { storefrontId: config.id, type: "animals-available", title: "Animals available", content: {}, sortOrder: 0 },
    });
  }

  const day = 24 * 60 * 60 * 1000;
  const animals = [
    { animalRef: "ux-sweep-animal-longest", name: "Ada", species: "dog", breed: "Collie mix", publishedAt: new Date(now.getTime() - 94 * day) },
    { animalRef: "ux-sweep-animal-recent", name: "Biscuit", species: "cat", breed: null, publishedAt: new Date(now.getTime() - 14 * day) },
    { animalRef: "ux-sweep-animal-future", name: "Coco", species: "rabbit", breed: null, publishedAt: new Date(now.getTime() + 7 * day) },
    { animalRef: "ux-sweep-animal-undated", name: "Dusty", species: "dog", breed: null, publishedAt: null },
  ];
  let created = 0;
  for (const animal of animals) {
    const found = await db.adoptableAnimal.findUnique({ where: { animalRef: animal.animalRef }, select: { id: true } });
    if (found) continue;
    await db.adoptableAnimal.create({
      data: { ...animal, storefrontId: config.id, organizationId: org.id, status: "available" },
    });
    created += 1;
  }
  return { storefrontId: config.id, storefrontCreated: existing === null, animalsCreated: created };
}
