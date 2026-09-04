import assert from "node:assert/strict";
import test from "node:test";

import {
  authoritySafetyMarginMs,
  heartbeatIntervalMs,
  superviseLeaseRun,
  uncertainRetryDelayMs,
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

test("a single uncertain renewal does not kill a healthy child", async () => {
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

// BI-ECAE03F7 — the supervisor must recover from a renewal it never got an
// answer to. The test above drives its own second attempt by hand, so it passed
// against a supervisor that scheduled no retry at all. These do not.

test("an uncertain renewal schedules its own retry, without the caller driving it", async () => {
  const child = deferred();
  const events = [];
  const retries = [];
  let renewAttempt = 0;
  let heartbeatCallback;

  const resultPromise = superviseLeaseRun({
    ttlMs: 120_000,
    expiresAt: new Date(120_000).toISOString(),
    now: () => 0,
    run: () => child.promise,
    renew: async () => {
      renewAttempt += 1;
      if (renewAttempt === 1) throw new Error("ETIMEDOUT");
      return { success: true, data: { lease: { expiresAt: new Date(240_000).toISOString() } } };
    },
    terminate: async () => { throw new Error("must not terminate"); },
    release: async () => {},
    schedule: (callback) => { heartbeatCallback = callback; return "heartbeat"; },
    cancelSchedule: () => {},
    scheduleDeadline: () => "deadline",
    cancelDeadline: () => {},
    scheduleRetry: (callback, delayMs) => {
      retries.push({ callback, delayMs });
      return `retry-${retries.length}`;
    },
    cancelRetry: () => {},
    onEvent: (event) => events.push(event),
  });

  await heartbeatCallback();

  // The supervisor -- not the test -- must have armed the next attempt.
  assert.equal(retries.length, 1, "an uncertain renewal armed no retry of its own");
  assert.equal(retries[0].delayMs, uncertainRetryDelayMs(120_000, 1));
  assert.equal(
    events.some((event) => event.type === "heartbeat-retry-scheduled" && event.attempt === 1),
    true,
  );

  // Firing the supervisor's own timer renews, with no further help from here.
  await retries[0].callback();
  assert.equal(renewAttempt, 2);
  assert.equal(events.some((event) => event.type === "heartbeat-renewed"), true);

  child.resolve({ status: 0 });
  assert.equal((await resultPromise).status, "completed");
});

test("consecutive uncertainty backs off and stays inside the authority budget", async () => {
  const child = deferred();
  const retries = [];
  let heartbeatCallback;

  const resultPromise = superviseLeaseRun({
    ttlMs: 120_000,
    expiresAt: new Date(120_000).toISOString(),
    now: () => 0,
    run: () => child.promise,
    renew: async () => { throw new Error("ECONNRESET"); },
    terminate: async () => {},
    release: async () => {},
    schedule: (callback) => { heartbeatCallback = callback; return "heartbeat"; },
    cancelSchedule: () => {},
    scheduleDeadline: () => "deadline",
    cancelDeadline: () => {},
    scheduleRetry: (callback, delayMs) => {
      retries.push({ callback, delayMs });
      return `retry-${retries.length}`;
    },
    cancelRetry: () => {},
    onEvent: () => {},
  });

  await heartbeatCallback();
  for (let i = 0; i < 5; i += 1) await retries.at(-1).callback();

  assert.deepEqual(
    retries.map((retry) => retry.delayMs),
    [1_000, 2_000, 4_000, 8_000, 16_000, 32_000],
  );
  // Six attempts inside the ~115s the deadline allows, where the old shape
  // spent the whole budget on two.
  const spentMs = retries.reduce((total, retry) => total + retry.delayMs, 0);
  assert.ok(spentMs < 120_000 - authoritySafetyMarginMs(120_000), `backoff overran the budget: ${spentMs}ms`);

  child.resolve({ status: 0 });
  await resultPromise;
});

test("a renewal that REFUSES is authoritative and is never retried", async () => {
  const child = deferred();
  const events = [];
  const retries = [];
  let heartbeatCallback;

  const resultPromise = superviseLeaseRun({
    ttlMs: 120_000,
    expiresAt: new Date(120_000).toISOString(),
    now: () => 0,
    run: () => child.promise,
    // Not a transport failure: the service answered, and the answer is no.
    renew: async () => ({ success: false, error: "nonprod_lease_not_owner" }),
    terminate: async () => { events.push({ type: "terminated" }); child.resolve({ status: 143 }); },
    release: async () => {},
    schedule: (callback) => { heartbeatCallback = callback; return "heartbeat"; },
    cancelSchedule: () => {},
    scheduleDeadline: () => "deadline",
    cancelDeadline: () => {},
    scheduleRetry: (callback, delayMs) => { retries.push({ callback, delayMs }); return "retry"; },
    cancelRetry: () => {},
    onEvent: (event) => events.push(event),
  });

  await heartbeatCallback();
  const result = await resultPromise;

  assert.equal(retries.length, 0, "a refused renewal must not be retried — another holder may exist");
  assert.equal(result.status, "fenced");
  assert.equal(result.reason, "nonprod_lease_not_owner");
});

test("a retry armed when the run ends is cancelled, not leaked", async () => {
  const child = deferred();
  const cancelled = [];
  let heartbeatCallback;

  const resultPromise = superviseLeaseRun({
    ttlMs: 120_000,
    expiresAt: new Date(120_000).toISOString(),
    now: () => 0,
    run: () => child.promise,
    renew: async () => { throw new Error("ETIMEDOUT"); },
    terminate: async () => {},
    release: async () => {},
    schedule: (callback) => { heartbeatCallback = callback; return "heartbeat"; },
    cancelSchedule: () => {},
    scheduleDeadline: () => "deadline",
    cancelDeadline: () => {},
    scheduleRetry: () => "retry-timer",
    cancelRetry: (timer) => cancelled.push(timer),
    onEvent: () => {},
  });

  await heartbeatCallback();
  child.resolve({ status: 0 });
  await resultPromise;

  assert.ok(cancelled.includes("retry-timer"), "the armed retry outlived the run");
});

test("the backoff is capped at the heartbeat interval and never zero", () => {
  for (const ttlMs of [1_000, 30_000, 120_000, 600_000]) {
    const intervalMs = Math.floor(ttlMs / 3);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const delay = uncertainRetryDelayMs(ttlMs, attempt);
      assert.ok(delay >= 1, `ttl ${ttlMs} attempt ${attempt} produced ${delay}`);
      assert.ok(delay <= intervalMs, `ttl ${ttlMs} attempt ${attempt} exceeded the interval`);
    }
  }
});
