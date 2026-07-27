import assert from "node:assert/strict";
import test from "node:test";

import {
  heartbeatIntervalMs,
  superviseLeaseRun,
} from "./lease-supervisor.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("heartbeat cadence is no greater than one third of the lease TTL", () => {
  assert.equal(heartbeatIntervalMs(60_000), 20_000);
  assert.equal(heartbeatIntervalMs(20 * 60_000), 400_000);
});

test("renewal loss fences and terminates the active child before returning", async () => {
  const child = deferred();
  const events = [];
  let heartbeat;
  let releases = 0;

  const resultPromise = superviseLeaseRun({
    ttlMs: 60_000,
    run: () => child.promise,
    renew: async () => ({ success: false, error: "lease_lost" }),
    terminate: async () => { events.push("terminated"); child.resolve({ status: 143 }); },
    release: async () => { releases += 1; },
    schedule: (callback) => { heartbeat = callback; return "timer"; },
    cancelSchedule: () => events.push("timer-cancelled"),
    onEvent: (event) => events.push(event.type),
  });

  await heartbeat();
  const result = await resultPromise;

  assert.equal(result.status, "fenced");
  assert.equal(releases, 1);
  assert.ok(events.indexOf("heartbeat-lost") < events.indexOf("terminated"));
  assert.ok(events.includes("timer-cancelled"));
});

test("normal completion cancels heartbeats and releases exactly once", async () => {
  const events = [];
  let releases = 0;

  const result = await superviseLeaseRun({
    ttlMs: 60_000,
    run: async () => ({ status: 0 }),
    renew: async () => ({ success: true }),
    terminate: async () => { throw new Error("must not terminate"); },
    release: async () => { releases += 1; },
    schedule: () => "timer",
    cancelSchedule: () => events.push("timer-cancelled"),
    onEvent: (event) => events.push(event.type),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.result.status, 0);
  assert.equal(releases, 1);
  assert.deepEqual(events, ["started", "timer-cancelled", "released"]);
});

test("a thrown command still cancels heartbeats and releases once", async () => {
  let releases = 0;
  await assert.rejects(
    superviseLeaseRun({
      ttlMs: 60_000,
      run: async () => { throw new Error("command exploded"); },
      renew: async () => ({ success: true }),
      terminate: async () => {},
      release: async () => { releases += 1; },
      schedule: () => "timer",
      cancelSchedule: () => {},
    }),
    /command exploded/,
  );
  assert.equal(releases, 1);
});
