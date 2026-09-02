import assert from "node:assert/strict";
import test from "node:test";

import { convergeUxSweepFixture } from "./ux-sweep-fixture-core.mjs";

const NOW = new Date("2026-07-28T19:30:00.000Z");

function fixtureDb({ setupComplete, hasQueue = true }) {
  const calls = {
    create: [],
    decisionInteractionUpdateMany: [],
    memoryUpdateMany: [],
    researchUpdateMany: [],
    updateMany: [],
    workItemCreate: [],
    workroomCreate: [],
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
