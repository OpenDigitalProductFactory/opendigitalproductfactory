// BI-D908DA0A — a queued claim and a CLOSED pool arrive on the same wire shape
// (`admission.status: "queued"`), but they call for different responses. Guards
// the distinction the gate now makes in its waiting line and its parked record.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  describeHeadroomShortfall,
  describeQueuedAdmission,
  poolClosedReason,
} from "./gate-worktree.mjs";

test("a pool at effectiveCapacity 0 is CLOSED, named by its rollback reason", () => {
  assert.equal(
    poolClosedReason({ effectiveCapacity: 0, rollbackReason: "host-stage-headroom-low" }),
    "host-stage-headroom-low",
  );
  assert.equal(poolClosedReason({ effectiveCapacity: 0, rollbackReason: null }), "capacity-zero");
});

test("a pool with any admissible slot is a queue, not a closure", () => {
  assert.equal(poolClosedReason({ effectiveCapacity: 1, rollbackReason: "host-build-capacity-one" }), null);
  assert.equal(poolClosedReason({ effectiveCapacity: 2, rollbackReason: null }), null);
  assert.equal(poolClosedReason(null), null);
  assert.equal(poolClosedReason(undefined), null);
});

test("the waiting line says CLOSED and why when nobody can be admitted", () => {
  const line = describeQueuedAdmission({
    admission: { queuePosition: 1 },
    poolPolicy: { effectiveCapacity: 0, rollbackReason: "host-stage-headroom-low" },
    delayMs: 12_400,
  });
  assert.match(line, /pool is CLOSED \(host-stage-headroom-low\)/);
  assert.match(line, /not behind other work/);
  assert.match(line, /observing again in 12\.4s/);
  assert.doesNotMatch(line, /admission queued at position/);
});

test("the waiting line stays a plain queue position when a slot exists", () => {
  const line = describeQueuedAdmission({
    admission: { queuePosition: 3 },
    poolPolicy: { effectiveCapacity: 1, rollbackReason: "host-build-capacity-one" },
    delayMs: 9_800,
  });
  assert.equal(line, "local-CI admission queued at position 3; observing again in 9.8s...");
});

test("a missing policy is treated as a queue, never as a closure", () => {
  const line = describeQueuedAdmission({ admission: { queuePosition: 2 }, poolPolicy: null, delayMs: 1_000 });
  assert.match(line, /^local-CI admission queued at position 2/);
});

// BI-D3BF53A9 — a closed pool names its real shortfall and says no session
// action helps, so nobody reaches for drop_caches or sync again (BI-903FB5F9).
test("a headroom closure names available, floor, reserve and shortfall", () => {
  const gib = 1024 ** 3;
  const line = describeQueuedAdmission({
    admission: { queuePosition: 1 },
    poolPolicy: {
      effectiveCapacity: 0,
      rollbackReason: "host-build-headroom-low",
      headroom: {
        measuredOn: "docker-vm",
        availableBytes: 19.5 * gib,
        floorBytes: 4 * gib,
        reserveBytes: 16 * gib,
        shortfallBytes: 0.5 * gib,
      },
    },
    delayMs: 5_000,
  });
  assert.match(line, /Docker VM has 19\.5 GiB available/);
  assert.match(line, /4\.0 GiB safety floor/);
  assert.match(line, /15\.5 GiB against a 16\.0 GiB per-slot reserve, 0\.5 GiB short/);
  assert.match(line, /Nothing a session does changes this/);
  assert.match(line, /do not drop caches or run sync/);
});

test("the shortfall is omitted, not invented, when the policy carries no numbers", () => {
  assert.equal(describeHeadroomShortfall(undefined), null);
  assert.equal(describeHeadroomShortfall({ measuredOn: "host", availableBytes: 1 }), null);
  const line = describeQueuedAdmission({
    admission: { queuePosition: 1 },
    poolPolicy: { effectiveCapacity: 0, rollbackReason: "host-memory-low" },
    delayMs: 1_000,
  });
  assert.doesNotMatch(line, /GiB/);
});
