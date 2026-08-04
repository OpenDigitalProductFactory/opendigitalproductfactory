import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  OBSERVER_TTL_MS,
  createGateObserverIdentity,
  findDeadLocalQueueObservers,
  readHostProcessStartTimes,
  registerLocalQueueObserver,
  releaseDeadLocalQueueObserversForGate,
  releaseLocalQueueObserver,
  resetHostProcessTableCache,
} from "./local-queue-observer.mjs";

function observerDirectory() {
  return mkdtempSync(join(tmpdir(), "dpf-queue-observers-"));
}

test("a dead same-host gate observer is eligible for queue cancellation", () => {
  const directory = observerDirectory();
  const identity = createGateObserverIdentity({
    pid: 101,
    token: "11111111-1111-4111-8111-111111111111",
  });
  registerLocalQueueObserver({
    directory,
    identity,
    branch: "fix/old",
    sha: "a".repeat(40),
    now: () => new Date("2026-07-29T20:00:00.000Z"),
  });

  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [{
      leaseId: "NPEL-DEAD",
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerSessionId: identity.ownerSessionId,
    }],
    processAlive: () => false,
  });

  assert.deepEqual(dead, [{
    leaseId: "NPEL-DEAD",
    ownerSessionId: identity.ownerSessionId,
    reason: "same_host_observer_process_not_running",
    livenessProof: {
      schema: "dpf-local-ci-queue-observer/v1",
      observerToken: identity.token,
      pid: 101,
      registeredAt: "2026-07-29T20:00:00.000Z",
    },
  }]);
});

test("a live observer is never cancelled from queue age or TTL alone", () => {
  const directory = observerDirectory();
  const identity = createGateObserverIdentity({
    pid: 202,
    token: "22222222-2222-4222-8222-222222222222",
  });
  registerLocalQueueObserver({
    directory,
    identity,
    branch: "fix/live",
    sha: "b".repeat(40),
  });

  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [{
      leaseId: "NPEL-LIVE",
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerSessionId: identity.ownerSessionId,
      expiresAt: "2020-01-01T00:00:00.000Z",
    }],
    processAlive: () => true,
  });

  assert.deepEqual(dead, []);
});

test("manual, malformed, and cross-host owners fail closed", () => {
  const directory = observerDirectory();
  writeFileSync(
    join(directory, "33333333-3333-4333-8333-333333333333.json"),
    JSON.stringify({
      schema: "dpf-local-ci-queue-observer/v1",
      observerToken: "different-token",
      pid: 303,
      ownerSessionId: "gate-v2-33333333-3333-4333-8333-333333333333-303",
    }),
  );

  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [
      {
        leaseId: "NPEL-MANUAL",
        environmentKey: "local-integration-ci",
        status: "queued",
        ownerSessionId: "human-session",
      },
      {
        leaseId: "NPEL-CROSS-HOST",
        environmentKey: "local-integration-ci",
        status: "queued",
        ownerSessionId: "gate-v2-44444444-4444-4444-8444-444444444444-404",
      },
      {
        leaseId: "NPEL-MISMATCH",
        environmentKey: "local-integration-ci",
        status: "queued",
        ownerSessionId: "gate-v2-33333333-3333-4333-8333-333333333333-303",
      },
    ],
    processAlive: () => false,
  });

  assert.deepEqual(dead, []);
});

test("observer cleanup is token-fenced", () => {
  const directory = observerDirectory();
  const identity = createGateObserverIdentity({
    pid: 505,
    token: "55555555-5555-4555-8555-555555555555",
  });
  const registered = registerLocalQueueObserver({
    directory,
    identity,
    branch: "fix/current",
    sha: "c".repeat(40),
  });

  assert.equal(
    releaseLocalQueueObserver({
      path: registered.path,
      token: "66666666-6666-4666-8666-666666666666",
    }).status,
    "not-owner",
  );
  assert.equal(existsSync(registered.path), true);
  assert.equal(
    releaseLocalQueueObserver({ path: registered.path, token: identity.token }).status,
    "released",
  );
  assert.equal(existsSync(registered.path), false);
});

test("fallback cleanup releases only dead observers for the same gate", () => {
  const directory = observerDirectory();
  const targetBranch = "fix/current";
  const targetSha = "c".repeat(40);
  const deadTarget = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 606,
      token: "66666666-6666-4666-8666-666666666666",
    }),
    ownerSessionId: "codex-thread",
    branch: targetBranch,
    sha: targetSha,
  });
  const liveTarget = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 707,
      token: "77777777-7777-4777-8777-777777777777",
    }),
    ownerSessionId: "codex-thread",
    branch: targetBranch,
    sha: targetSha,
  });
  const otherBranch = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 808,
      token: "88888888-8888-4888-8888-888888888888",
    }),
    ownerSessionId: "codex-thread",
    branch: "fix/other",
    sha: targetSha,
  });

  const released = releaseDeadLocalQueueObserversForGate({
    directory,
    branch: targetBranch,
    sha: targetSha,
    processAlive: (pid) => pid === 707,
  });

  assert.equal(released.length, 1);
  assert.equal(released[0].observerToken, "66666666-6666-4666-8666-666666666666");
  assert.equal(existsSync(deadTarget.path), false);
  assert.equal(existsSync(liveTarget.path), true);
  assert.equal(existsSync(otherBranch.path), true);
});

test("a lease named after its real client thread is still reconcilable (BI-3A34D7A9)", () => {
  // Liveness used to be proved by PARSING the lease's ownerSessionId for
  // gate-v2-<token>-<pid>. Once the lease carries the honest client thread id,
  // that parse can never match — so a dead waiter from an attributed gate would
  // sit in the queue until TTL, blocking every thread behind it. The proof now
  // comes from the observer RECORD, so an honest name reconciles normally.
  const directory = observerDirectory();
  const identity = createGateObserverIdentity({
    pid: 202,
    token: "22222222-2222-4222-8222-222222222222",
  });
  const honestThread = "79495644-27dd-4631-bed1-06e294056a4f";
  assert.doesNotMatch(honestThread, /^gate-v2-/);

  registerLocalQueueObserver({
    directory,
    identity,
    ownerSessionId: honestThread,
    branch: "claude/pr-verification-origin-tracking",
    sha: "b".repeat(40),
    now: () => new Date("2026-07-30T04:33:29.000Z"),
  });

  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [{
      leaseId: "NPEL-HONEST",
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerSessionId: honestThread,
    }],
    processAlive: () => false,
  });

  assert.equal(dead.length, 1);
  assert.equal(dead[0].leaseId, "NPEL-HONEST");
  assert.equal(dead[0].ownerSessionId, honestThread);
  // The token still travels as the proof and the release credential.
  assert.equal(dead[0].livenessProof.observerToken, identity.token);
  assert.equal(dead[0].livenessProof.pid, 202);
});

test("a live attributed waiter is never cancelled", () => {
  const directory = observerDirectory();
  const identity = createGateObserverIdentity({
    pid: 303,
    token: "33333333-3333-4333-8333-333333333333",
  });
  registerLocalQueueObserver({
    directory,
    identity,
    ownerSessionId: "codex-thread-alive",
    branch: "feat/x",
    sha: "c".repeat(40),
  });

  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [{
      leaseId: "NPEL-ALIVE",
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerSessionId: "codex-thread-alive",
    }],
    processAlive: () => true,
  });

  assert.deepEqual(dead, []);
});

test("duplicate dead observers for one thread are still eligible for queue cancellation", () => {
  // Hard-killed gate wrappers can leave old observer records behind. Duplicates
  // are safe to reconcile when every recorded process is proven dead.
  const directory = observerDirectory();
  const shared = "thread-with-two-processes";
  for (const [pid, token] of [
    [404, "44444444-4444-4444-8444-444444444444"],
    [505, "55555555-5555-4555-8555-555555555555"],
  ]) {
    registerLocalQueueObserver({
      directory,
      identity: createGateObserverIdentity({ pid, token }),
      ownerSessionId: shared,
      branch: "feat/y",
      sha: "d".repeat(40),
    });
  }

  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [{
      leaseId: "NPEL-AMBIGUOUS",
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerSessionId: shared,
    }],
    processAlive: () => false,
  });

  assert.equal(dead.length, 1);
  assert.equal(dead[0].leaseId, "NPEL-AMBIGUOUS");
  assert.deepEqual(
    dead[0].livenessProofs.map((proof) => proof.pid).sort((a, b) => a - b),
    [404, 505],
  );
});

test("duplicate observers fail closed when any recorded process is alive", () => {
  const directory = observerDirectory();
  const shared = "thread-with-one-live-process";
  for (const [pid, token] of [
    [606, "66666666-6666-4666-8666-666666666666"],
    [707, "77777777-7777-4777-8777-777777777777"],
  ]) {
    registerLocalQueueObserver({
      directory,
      identity: createGateObserverIdentity({ pid, token }),
      ownerSessionId: shared,
      branch: "feat/y",
      sha: "e".repeat(40),
    });
  }

  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [{
      leaseId: "NPEL-LIVE-DUPLICATE",
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerSessionId: shared,
    }],
    processAlive: (pid) => pid === 707,
  });

  assert.deepEqual(dead, []);
});

// ── BI-2C7F51BA defect 2: pid liveness must survive pid REUSE ───────────────
//
// These exercise the REAL host process-table probe (no injected oracle), which
// is the half `process.kill(pid, 0)` could never do. `process.pid` stands in for
// a recycled pid: it is unambiguously alive, so kill(0) says "live" — the whole
// bug — and only the start-time comparison can tell the two apart.

const hostStartTimes = readHostProcessStartTimes();
const hostProbeSkip = hostStartTimes?.has(process.pid)
  ? false
  : "host process table is unreadable on this platform; start-time liveness degrades to pid + TTL";

test("a RECYCLED pid is reaped even though the pid is alive", { skip: hostProbeSkip }, () => {
  const directory = observerDirectory();
  const identity = createGateObserverIdentity({
    pid: process.pid,
    token: "a1111111-1111-4111-8111-111111111111",
  });
  // The gate that wrote this record died long ago; the OS has since handed its
  // pid to this test process.
  const recycled = registerLocalQueueObserver({
    directory,
    identity,
    branch: "fix/dead-gate",
    sha: "a".repeat(40),
    processStartedAtMs: Date.parse("2026-07-29T20:00:00.000Z"),
  });
  assert.equal(existsSync(recycled.path), true);

  resetHostProcessTableCache();
  const released = releaseDeadLocalQueueObserversForGate({ directory });

  assert.equal(released.length, 1);
  assert.equal(released[0].pid, process.pid);
  assert.equal(released[0].releaseStatus, "released");
  assert.equal(existsSync(recycled.path), false);
});

test("a genuinely running gate is never reaped, however long it has run", { skip: hostProbeSkip }, () => {
  const directory = observerDirectory();
  // registerLocalQueueObserver stamps THIS process's real start time.
  const live = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: process.pid,
      token: "a2222222-2222-4222-8222-222222222222",
    }),
    branch: "fix/long-running",
    sha: "b".repeat(40),
    // Older than the TTL: a verified-live process outranks the TTL backstop, so
    // the TTL can never take a slot from a gate we can see is still running.
    now: () => new Date(Date.now() - OBSERVER_TTL_MS - 60_000),
  });

  resetHostProcessTableCache();
  assert.deepEqual(releaseDeadLocalQueueObserversForGate({ directory }), []);
  assert.equal(existsSync(live.path), true);
});

test("a pre-fix record with no start time is bounded by the TTL", () => {
  const directory = observerDirectory();
  // Shape written before this fix: live-looking pid, no start time, so reuse is
  // undetectable. Without a TTL this record is immortal — the permanent
  // queue-slot leak. The probe is forced unavailable to isolate the TTL path.
  const legacy = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 909,
      token: "a3333333-3333-4333-8333-333333333333",
    }),
    branch: "fix/legacy",
    sha: "c".repeat(40),
    processStartedAtMs: null,
    now: () => new Date(Date.now() - OBSERVER_TTL_MS - 60_000),
  });
  assert.equal(JSON.parse(readFileSync(legacy.path, "utf8")).processStartedAtMs, undefined);

  const released = releaseDeadLocalQueueObserversForGate({
    directory,
    processAlive: () => true,
    processStartTimes: null,
  });

  assert.equal(released.length, 1);
  assert.equal(existsSync(legacy.path), false);
});

test("a pre-fix record inside the TTL still holds its slot", () => {
  const directory = observerDirectory();
  const fresh = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 910,
      token: "a4444444-4444-4444-8444-444444444444",
    }),
    branch: "fix/legacy-fresh",
    sha: "d".repeat(40),
    processStartedAtMs: null,
  });

  assert.deepEqual(
    releaseDeadLocalQueueObserversForGate({
      directory,
      processAlive: () => true,
      processStartTimes: null,
    }),
    [],
  );
  assert.equal(existsSync(fresh.path), true);
});

test("a recycled pid also stops holding its LEASE in the queue", { skip: hostProbeSkip }, () => {
  const directory = observerDirectory();
  registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: process.pid,
      token: "a5555555-5555-4555-8555-555555555555",
    }),
    ownerSessionId: "thread-whose-gate-died",
    branch: "fix/queued",
    sha: "e".repeat(40),
    processStartedAtMs: Date.parse("2026-07-29T20:00:00.000Z"),
  });

  resetHostProcessTableCache();
  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [{
      leaseId: "NPEL-RECYCLED",
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerSessionId: "thread-whose-gate-died",
    }],
  });

  assert.equal(dead.length, 1);
  assert.equal(dead[0].leaseId, "NPEL-RECYCLED");
});
