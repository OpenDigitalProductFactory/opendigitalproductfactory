import assert from "node:assert/strict";
import test from "node:test";

import { convergeUxSweepFixture } from "./ux-sweep-fixture-core.mjs";

const NOW = new Date("2026-07-28T19:30:00.000Z");

function fixtureDb({ setupComplete }) {
  const calls = {
    create: [],
    updateMany: [],
  };

  return {
    calls,
    db: {
      platformSetupProgress: {
        async findFirst() {
          return setupComplete ? { id: "setup-existing" } : null;
        },
        async create(args) {
          calls.create.push(args);
          return { id: "setup-created" };
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

test("refreshes the running root portal heartbeat even when setup is already complete", async () => {
  const fixture = fixtureDb({ setupComplete: true });

  const result = await convergeUxSweepFixture(fixture.db, NOW);

  assert.deepEqual(fixture.calls.create, []);
  assert.deepEqual(fixture.calls.updateMany, [
    {
      where: { targetId: "RT-ROOT-PORTAL", status: "running" },
      data: { lastHeartbeatAt: NOW },
    },
  ]);
  assert.deepEqual(result, {
    setupChanged: false,
    setupProgressId: "setup-existing",
    refreshedRuntimeTargets: 1,
  });
});

test("completes first-run setup and refreshes the heartbeat in one fixture convergence", async () => {
  const fixture = fixtureDb({ setupComplete: false });

  const result = await convergeUxSweepFixture(fixture.db, NOW);

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
  });
});
