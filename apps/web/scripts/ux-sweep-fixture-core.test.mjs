import assert from "node:assert/strict";
import test from "node:test";

import { convergeUxSweepFixture } from "./ux-sweep-fixture-core.mjs";

const NOW = new Date("2026-07-28T19:30:00.000Z");

function fixtureDb({ setupComplete }) {
  const calls = {
    create: [],
    decisionInteractionUpdateMany: [],
    memoryUpdateMany: [],
    researchUpdateMany: [],
    updateMany: [],
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
