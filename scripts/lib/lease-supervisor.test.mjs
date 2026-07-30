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

test("transient renewal uncertainty retries without immediately killing a healthy child", async () => {
  const child = deferred();
  const events = [];
  const deadlines = [];
  let heartbeat;
  let nowMs = 0;
  let renewAttempt = 0;

  const resultPromise = superviseLeaseRun({
    ttlMs: 1_000,
    expiresAt: new Date(1_000).toISOString(),
    now: () => nowMs,
    safetyMarginMs: 100,
    run: () => child.promise,
    renew: async () => {
      renewAttempt += 1;
      if (renewAttempt === 1) throw new Error("ETIMEDOUT");
      return {
        success: true,
        data: { lease: { expiresAt: new Date(2_000).toISOString() } },
      };
    },
    terminate: async () => { throw new Error("must not terminate"); },
    release: async () => {},
    schedule: (callback) => { heartbeat = callback; return "heartbeat"; },
    cancelSchedule: () => {},
    scheduleDeadline: (callback, delayMs) => {
      deadlines.push({ callback, delayMs });
      return `deadline-${deadlines.length}`;
    },
    cancelDeadline: () => {},
    onEvent: (event) => events.push(event),
  });

  await heartbeat();
  assert.equal(events.some((event) => event.type === "heartbeat-uncertain"), true);

  nowMs = 200;
  await heartbeat();
  assert.equal(events.some((event) =>
    event.type === "heartbeat-renewed" && event.expiresAt === new Date(2_000).toISOString()
  ), true);
  assert.equal(deadlines.at(-1).delayMs, 1_700);

  child.resolve({ status: 0 });
  const result = await resultPromise;
  assert.equal(result.status, "completed");
});

test("repeated transport uncertainty fences at the last known authority deadline", async () => {
  const child = deferred();
  const events = [];
  const deadlines = [];
  let heartbeat;
  let releases = 0;

  const resultPromise = superviseLeaseRun({
    ttlMs: 1_000,
    expiresAt: new Date(1_000).toISOString(),
    now: () => 0,
    safetyMarginMs: 100,
    run: () => child.promise,
    renew: async () => { throw new Error("ECONNRESET"); },
    terminate: async () => { events.push({ type: "terminated" }); child.resolve({ status: 143 }); },
    release: async () => { releases += 1; },
    schedule: (callback) => { heartbeat = callback; return "heartbeat"; },
    cancelSchedule: () => {},
    scheduleDeadline: (callback, delayMs) => {
      deadlines.push({ callback, delayMs });
      return `deadline-${deadlines.length}`;
    },
    cancelDeadline: () => {},
    onEvent: (event) => events.push(event),
  });

  await heartbeat();
  assert.equal(events.some((event) => event.type === "terminated"), false);
  assert.equal(deadlines[0].delayMs, 900);

  await deadlines[0].callback();
  const result = await resultPromise;

  assert.equal(result.status, "fenced");
  assert.equal(result.reason, "lease-authority-deadline");
  assert.equal(releases, 1);
  assert.equal(events.some((event) => event.type === "authority-deadline"), true);
});

test("a fence termination error is observed without leaking an unhandled timer rejection", async () => {
  const child = deferred();
  const events = [];
  let deadline;
  let releases = 0;

  const resultPromise = superviseLeaseRun({
    ttlMs: 1_000,
    expiresAt: new Date(1_000).toISOString(),
    now: () => 0,
    safetyMarginMs: 100,
    run: () => child.promise,
    renew: async () => ({ success: true }),
    terminate: async () => { throw new Error("termination transport failed"); },
    release: async () => { releases += 1; },
    schedule: () => "heartbeat",
    cancelSchedule: () => {},
    scheduleDeadline: (callback) => {
      deadline = callback;
      return "deadline";
    },
    cancelDeadline: () => {},
    onEvent: (event) => events.push(event),
  });

  await deadline();
  child.resolve({ status: 143 });
  const result = await resultPromise;

  assert.equal(result.status, "fenced");
  assert.equal(result.reason, "lease-authority-deadline");
  assert.equal(releases, 1);
  assert.equal(
    events.some((event) =>
      event.type === "fence-termination-failed"
      && event.reason === "termination transport failed"
    ),
    true,
  );
});
