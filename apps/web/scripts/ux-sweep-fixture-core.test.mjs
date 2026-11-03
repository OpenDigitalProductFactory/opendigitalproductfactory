import assert from "node:assert/strict";
import test from "node:test";

import { convergeUxSweepFixture, convergeUxSweepEstate, uxSweepEstateFacts } from "./ux-sweep-fixture-core.mjs";

const NOW = new Date("2026-07-28T19:30:00.000Z");

function estateDb(existing = null) {
  const rows = { run: existing, olderRuns: [] };
  return { rows, db: {
    discoveryRun: { findFirst: async ({ where } = {}) => {
      const runs = [rows.run, ...rows.olderRuns].filter(Boolean);
      return where?.sourceSlug?.not ? runs.find(r => r.sourceSlug !== where.sourceSlug.not) ?? null : runs[0] ?? null;
    } },
  } };
}

test("estate fixture populates a complete repeatable discovery before shell bootstrap and replays idempotently", async () => {
  const { db, rows } = estateDb();
  let calls = 0;
  const persist = async (facts, meta) => {
    calls++;
    assert.deepEqual(facts, uxSweepEstateFacts());
    assert.equal(facts.items.length, 10);
    assert.equal(facts.relationships.filter(r => r.relationshipType === "MEMBER_OF").length, 3);
    rows.run = { id: "canonical-run", ...meta, status: "completed" };
    return { runId: rows.run.id };
  };
  await convergeUxSweepEstate(db, NOW, persist);
  assert.equal(rows.run.status, "completed");
  assert.equal(rows.run.sourceSlug, "ux-route-sweep");
  const first = JSON.stringify(rows.run);
  await convergeUxSweepEstate(db, NOW, persist);
  assert.equal(JSON.stringify(rows.run), first);
  assert.equal(calls, 1);
});

test("estate fixture preserves existing real discovery instead of replacing its observations", async () => {
  const existing = { id: "real-run", sourceSlug: "dpf_bootstrap", status: "completed" };
  const { db, rows } = estateDb(existing);
  assert.equal(await convergeUxSweepEstate(db, NOW, () => assert.fail("must preserve real observations")), null);
  assert.equal(rows.run, existing);
});

test("a partial estate write cannot produce a completed-run sentinel", async () => {
  const { db, rows } = estateDb();
  await assert.rejects(convergeUxSweepEstate(db, NOW, async () => { throw new Error("fixture write failed"); }), /fixture write failed/);
  assert.equal(rows.run, null);
});

test("a newer fixture run cannot hide older real observations", async () => {
  const latest = { id: "fixture-run", sourceSlug: "ux-route-sweep", status: "completed" };
  const { db, rows } = estateDb(latest);
  rows.olderRuns.push({ id: "older-real", sourceSlug: "dpf_bootstrap", status: "completed" });
  assert.equal(await convergeUxSweepEstate(db, NOW, () => assert.fail("must preserve older real observations")), null);
  assert.equal(rows.run, latest);
});

function fixtureDb({ setupComplete, hasQueue = true, hasArchetype = true, hasStorefront = false }) {
  const calls = {
    create: [],
    decisionInteractionUpdateMany: [],
    memoryUpdateMany: [],
    researchUpdateMany: [],
    updateMany: [],
    workItemCreate: [],
    workroomCreate: [],
    storefrontCreate: [],
    sectionCreate: [],
    animalCreate: [],
  };

  return {
    calls,
    db: {
      coworkerMemoryNote: {
        async updateMany(args) {
          calls.memoryUpdateMany.push(args);
          return { count: 2 };
        },
      },
      decisionInteraction: {
        async updateMany(args) {
          calls.decisionInteractionUpdateMany.push(args);
          return { count: 1 };
        },
      },
      platformSetupProgress: {
        async findFirst() {
          return setupComplete ? { id: "setup-existing" } : null;
        },
        async create(args) {
          calls.create.push(args);
          return { id: "setup-created" };
        },
      },
      researchProposal: {
        async updateMany(args) {
          calls.researchUpdateMany.push(args);
          return { count: 3 };
        },
      },
      runtimeTarget: {
        async updateMany(args) {
          calls.updateMany.push(args);
          return { count: 1 };
        },
      },
      organization: {
        async findFirst() {
          return { id: "org-platform" };
        },
      },
      storefrontArchetype: {
        async findFirst() {
          return hasArchetype ? { id: "arch-pet-rescue" } : null;
        },
      },
      storefrontConfig: {
        async findFirst() {
          return hasStorefront ? { id: "storefront-existing" } : null;
        },
        async create(args) {
          calls.storefrontCreate.push(args);
          return { id: "storefront-created" };
        },
      },
      storefrontSection: {
        async findFirst() {
          return hasStorefront ? { id: "section-existing" } : null;
        },
        async create(args) {
          calls.sectionCreate.push(args);
          return { id: "section-created" };
        },
      },
      adoptableAnimal: {
        async findUnique(args) {
          return hasStorefront ? { id: `animal-${args.where.animalRef}` } : null;
        },
        async create(args) {
          calls.animalCreate.push(args);
          return { id: "animal-created" };
        },
      },
      workQueue: {
        async findFirst() {
          return hasQueue ? { id: "queue-1" } : null;
        },
      },
      workItem: {
        async findFirst() {
          return null;
        },
        async create(args) {
          calls.workItemCreate.push(args);
          return { id: "work-item-1" };
        },
        async update(args) {
          calls.workItemCreate.push(args);
          return { id: "work-item-1" };
        },
      },
      workroom: {
        async findFirst() {
          return null;
        },
        async create(args) {
          calls.workroomCreate.push(args);
          return { id: "room-1" };
        },
        async update(args) {
          calls.workroomCreate.push(args);
          return { id: "room-1" };
        },
      },
    },
  };
}

const DB_NULL = Symbol("Prisma.DbNull");

test("refreshes the running root portal heartbeat even when setup is already complete", async () => {
  const fixture = fixtureDb({ setupComplete: true });

  const result = await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });

  assert.deepEqual(fixture.calls.create, []);
  assert.deepEqual(fixture.calls.updateMany, [
    {
      where: { targetId: "RT-ROOT-PORTAL", status: "running" },
      data: { lastHeartbeatAt: NOW },
    },
  ]);
  assert.deepEqual(fixture.calls.memoryUpdateMany, [
    {
      where: { supersededAt: null },
      data: { supersededAt: NOW },
    },
  ]);
  assert.deepEqual(fixture.calls.researchUpdateMany, [
    {
      where: { status: "pending" },
      data: { status: "declined", decidedAt: NOW },
    },
  ]);
  assert.deepEqual(fixture.calls.decisionInteractionUpdateMany, [
    {
      where: {
        outcomeType: "defer",
        buildId: null,
        taskRunId: null,
        humanOutcome: { equals: DB_NULL },
      },
      data: {
        humanOutcome: {
          disposition: "fixture-converged",
          fixture: "ux-route-sweep",
        },
      },
    },
  ]);
  assert.deepEqual(result, {
    workCase: { caseKey: encodeURIComponent("ux-sweep:ux-sweep-case"), reason: null },
    setupChanged: false,
    setupProgressId: "setup-existing",
    refreshedRuntimeTargets: 1,
    storefront: { storefrontId: "storefront-created", storefrontCreated: true, animalsCreated: 4 },
    convergedWeeklyDigestInputs: {
      coworkerMemoryNotes: 2,
      researchProposals: 3,
      unlinkedDeferredDecisions: 1,
    },
  });
});

test("completes first-run setup and refreshes the heartbeat in one fixture convergence", async () => {
  const fixture = fixtureDb({ setupComplete: false });

  const result = await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });

  assert.deepEqual(fixture.calls.create, [
    {
      data: { currentStep: "complete", completedAt: NOW },
      select: { id: true },
    },
  ]);
  assert.equal(fixture.calls.updateMany.length, 1);
  assert.deepEqual(result, {
    workCase: { caseKey: encodeURIComponent("ux-sweep:ux-sweep-case"), reason: null },
    setupChanged: true,
    setupProgressId: "setup-created",
    refreshedRuntimeTargets: 1,
    storefront: { storefrontId: "storefront-created", storefrontCreated: true, animalsCreated: 4 },
    convergedWeeklyDigestInputs: {
      coworkerMemoryNotes: 2,
      researchProposals: 3,
      unlinkedDeferredDecisions: 1,
    },
  });
});

test("requires the caller to provide Prisma's database-null sentinel", async () => {
  const fixture = fixtureDb({ setupComplete: true });

  await assert.rejects(
    () => convergeUxSweepFixture(fixture.db, NOW),
    /dbNull is required/,
  );
});

test("converges a one-item digest race once and is idempotent on the post-start pass", async () => {
  const fixture = fixtureDb({ setupComplete: true });
  const counts = [1, 0];
  for (const model of [
    fixture.db.coworkerMemoryNote,
    fixture.db.researchProposal,
    fixture.db.decisionInteraction,
  ]) {
    let call = 0;
    model.updateMany = async () => ({ count: counts[call++] ?? 0 });
  }

  const preStart = await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });
  const postStart = await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });

  assert.deepEqual(preStart.convergedWeeklyDigestInputs, {
    coworkerMemoryNotes: 1,
    researchProposals: 1,
    unlinkedDeferredDecisions: 1,
  });
  assert.deepEqual(postStart.convergedWeeklyDigestInputs, {
    coworkerMemoryNotes: 0,
    researchProposals: 0,
    unlinkedDeferredDecisions: 0,
  });
});


// BI-DE67A3EC — the sweep can only measure a detail route if something mints the
// id in its path. These pin the contract the sweep depends on.
test("mints a deterministic work case and returns its caseKey", async () => {
  const fixture = fixtureDb({ setupComplete: true });

  const result = await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });

  // Fixed identity, not a sampled row: a sampled id would make the measured
  // baseline flap with whatever the seed produced (the noise of BI-4FF94533).
  assert.equal(result.workCase.caseKey, encodeURIComponent("ux-sweep:ux-sweep-case"));
  assert.equal(result.workCase.reason, null);
  assert.equal(fixture.calls.workItemCreate.length, 1);
  assert.equal(fixture.calls.workItemCreate[0].data.sourceType, "ux-sweep");
  assert.equal(fixture.calls.workItemCreate[0].data.sourceId, "ux-sweep-case");
});

test("gives the case a room carrying a declared shape and posture", async () => {
  const fixture = fixtureDb({ setupComplete: true });

  await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });

  assert.equal(fixture.calls.workroomCreate.length, 1);
  const claims = fixture.calls.workroomCreate[0].data.scopeClaims;
  // Measuring the empty "running platform defaults" state would understate the
  // page; the room must render its populated posture surface.
  assert.ok(claims.some((claim) => claim.workroomShape === "change-consequential"));
  assert.ok(claims.some((claim) => claim.workroomPosture));
});

// The DB refused "fixture": WorkCapsule.source is a closed set. Pin the values
// this fixture writes against the constraint so a wrong one fails here, in
// milliseconds, rather than after a nine-minute CI sweep.
test("writes only closed-set values the WorkCapsule constraints accept", async () => {
  const ALLOWED_SOURCE = [
    "backlog", "build-studio", "external-adoption", "git-promotion", "manual",
    "scheduled-steward", "worker-onboarding", "worker-change", "worker-offboarding",
  ];
  const ALLOWED_STATUS = [
    "draft", "ready", "working", "blocked", "verifying", "ready-for-review",
    "ready-for-promotion", "complete", "abandoned", "archived",
  ];
  const fixture = fixtureDb({ setupComplete: true });

  await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });

  const room = fixture.calls.workroomCreate[0].data;
  assert.ok(ALLOWED_SOURCE.includes(room.source), `source "${room.source}" is outside the closed set`);
  assert.ok(ALLOWED_STATUS.includes(room.status), `status "${room.status}" is outside the closed set`);
});

test("reports why no case was minted rather than returning a broken key", async () => {
  const fixture = fixtureDb({ setupComplete: true, hasQueue: false });

  const result = await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });

  // An honest absence: the sweep then fails loudly on the eligible-but-unresolved
  // route instead of navigating a literal "[caseKey]".
  assert.equal(result.workCase.caseKey, null);
  assert.match(result.workCase.reason, /no work queue/);
  assert.equal(fixture.calls.workItemCreate.length, 0);
});

test("provisions one pet-rescue storefront with listed animals so /storefront/animals/waiting is measurable (BI-899D7F00)", async () => {
  const fixture = fixtureDb({ setupComplete: true });
  const result = await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });
  assert.deepEqual(result.storefront, { storefrontId: "storefront-created", storefrontCreated: true, animalsCreated: 4 });
  assert.equal(fixture.calls.storefrontCreate.length, 1);
  assert.equal(fixture.calls.storefrontCreate[0].data.organizationId, "org-platform");
  assert.equal(fixture.calls.storefrontCreate[0].data.archetypeId, "arch-pet-rescue");
  assert.equal(fixture.calls.sectionCreate[0].data.type, "animals-available");
  const animals = fixture.calls.animalCreate.map((c) => c.data);
  assert.deepEqual(animals.map((a) => a.status), ["available", "available", "available", "available"]);
  // The four cover every ordering rule the owner decided: two dated (longest
  // first), one future-dated (left out of the ordering), one undated (last).
  const day = 24 * 60 * 60 * 1000;
  assert.equal(animals[0].publishedAt.getTime(), NOW.getTime() - 94 * day);
  assert.ok(animals[2].publishedAt.getTime() > NOW.getTime());
  assert.equal(animals[3].publishedAt, null);
});

test("is idempotent for the storefront fixture: an existing storefront, section and animals are left alone", async () => {
  const fixture = fixtureDb({ setupComplete: true, hasStorefront: true });
  const result = await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });
  assert.deepEqual(result.storefront, { storefrontId: "storefront-existing", storefrontCreated: false, animalsCreated: 0 });
  assert.equal(fixture.calls.storefrontCreate.length, 0);
  assert.equal(fixture.calls.sectionCreate.length, 0);
  assert.equal(fixture.calls.animalCreate.length, 0);
});

test("provisions no storefront when the seed carries no pet-rescue archetype, and still converges the rest", async () => {
  const fixture = fixtureDb({ setupComplete: true, hasArchetype: false });
  const result = await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });
  assert.equal(result.storefront, null);
  assert.equal(fixture.calls.storefrontCreate.length, 0);
  assert.equal(fixture.calls.updateMany.length, 1);
});


test("fixture refresh preserves existing claim ownership and its epoch", async () => {
  const fixture = fixtureDb({ setupComplete: true });
  const claim = { kind: "path", value: "a.ts", intent: "edit", recordedByPrincipalId: "owner", releaseEpoch: "original" };
  fixture.db.workroom.findFirst = async () => ({ id: "room-existing", scopeClaims: [claim], updatedAt: NOW });
  await convergeUxSweepFixture(fixture.db, NOW, { dbNull: DB_NULL });
  const write = fixture.calls.workroomCreate[0];
  assert.deepEqual(write.data.scopeClaims[0], claim);
  assert.deepEqual(write.where.scopeClaims, { equals: [claim] });
  assert.equal(write.where.updatedAt, NOW);
});
