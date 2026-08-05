import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  OBSERVER_RECORD_TTL_MS,
  createGateObserverIdentity,
  findDeadLocalQueueObservers,
  readProcessStartTimes,
  registerLocalQueueObserver,
  releaseDeadLocalQueueObserversForGate,
  releaseLocalQueueObserver,
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
    startedAt: "2026-07-29T19:59:00.000Z",
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
    processStartTimes: new Map(),
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
      startedAt: "2026-07-29T19:59:00.000Z",
      reason: "same_host_observer_process_not_running",
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
    processStartTimes: new Map(),
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
    processStartTimes: new Map(),
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
    processStartTimes: new Map(),
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
    processStartTimes: new Map(),
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
    processStartTimes: new Map(),
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
    processStartTimes: new Map(),
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
    processStartTimes: new Map(),
  });

  assert.deepEqual(dead, []);
});

// ─── BI-2C7F51BA Defect 2 — PID liveness must be sound ──────────────────────

test("a recycled pid is reaped even though process.kill(pid, 0) says alive", () => {
  // The field failure: Windows reuses pids, so `process.kill(pid, 0)` on a
  // record whose pid has been reassigned reads as alive FOREVER and the record
  // can never be reaped — a permanent queue-slot leak. The (pid, start time)
  // pair is unique, so a start time that does not match the recorded one proves
  // the pid now belongs to a different process.
  const directory = observerDirectory();
  const identity = createGateObserverIdentity({
    pid: 909,
    token: "99999999-9999-4999-8999-999999999999",
  });
  registerLocalQueueObserver({
    directory,
    identity,
    ownerSessionId: "codex-thread-recycled",
    branch: "feat/recycled",
    sha: "f".repeat(40),
    now: () => new Date("2026-08-01T00:00:00.000Z"),
    startedAt: "2026-08-01T00:00:00.000Z",
  });

  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [{
      leaseId: "NPEL-RECYCLED",
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerSessionId: "codex-thread-recycled",
    }],
    // The pid IS alive — it just belongs to something else now.
    processAlive: () => true,
    processStartTimes: new Map([[909, Date.parse("2026-08-04T12:00:00.000Z")]]),
    // Well inside the TTL, so the reap must rest on the start-time proof alone.
    now: () => Date.parse("2026-08-01T01:00:00.000Z"),
  });

  assert.equal(dead.length, 1);
  assert.equal(dead[0].leaseId, "NPEL-RECYCLED");
  assert.equal(dead[0].reason, "same_host_observer_pid_recycled");
});

test("a still-running gate whose start time matches is never reaped", () => {
  const directory = observerDirectory();
  const identity = createGateObserverIdentity({
    pid: 909,
    token: "99999999-9999-4999-8999-999999999999",
  });
  const startedAt = "2026-08-04T12:00:00.000Z";
  registerLocalQueueObserver({
    directory,
    identity,
    ownerSessionId: "codex-thread-running",
    branch: "feat/running",
    sha: "f".repeat(40),
    now: () => new Date(startedAt),
    startedAt,
  });

  const dead = findDeadLocalQueueObservers({
    directory,
    queuedLeases: [{
      leaseId: "NPEL-RUNNING",
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerSessionId: "codex-thread-running",
    }],
    processAlive: () => true,
    // Sub-second skew between process creation and V8 init must not read as reuse.
    processStartTimes: new Map([[909, Date.parse(startedAt) + 400]]),
    now: () => Date.parse(startedAt) + 60_000,
  });

  assert.deepEqual(dead, []);
});

test("a record with no start-time evidence is bounded by the TTL instead", () => {
  // Pre-BI-2C7F51BA records carry no `startedAt`, and a hardened host may not
  // answer the process-table query at all. Neither may leave a record immortal.
  const directory = observerDirectory();
  const now = Date.parse("2026-08-04T00:00:00.000Z");
  const registered = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 1010,
      token: "10101010-1010-4010-8010-101010101010",
    }),
    ownerSessionId: "codex-thread-legacy",
    branch: "feat/legacy",
    sha: "a".repeat(40),
    now: () => new Date(now - OBSERVER_RECORD_TTL_MS - 1),
    startedAt: undefined,
  });

  const releasedTooSoon = releaseDeadLocalQueueObserversForGate({
    directory,
    processAlive: () => true,
    processStartTimes: null,
    now: () => now - OBSERVER_RECORD_TTL_MS - 1,
  });
  assert.deepEqual(releasedTooSoon, []);
  assert.equal(existsSync(registered.path), true);

  const released = releaseDeadLocalQueueObserversForGate({
    directory,
    processAlive: () => true,
    processStartTimes: null,
    now: () => now,
  });
  assert.equal(released.length, 1);
  assert.equal(released[0].reason, "same_host_observer_record_expired");
  assert.equal(existsSync(registered.path), false);
});

// ─── BI-2C7F51BA Defect 1 — the startup sweep is cross-session by design ─────

test("an unfiltered sweep clears OTHER sessions' dead records", () => {
  // The point of sweeping on gate startup is that the session which leaked a
  // record is by definition no longer around to clean it up. Tightening these
  // filters to the current branch silently restores the leak.
  const directory = observerDirectory();
  const foreign = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 1111,
      token: "11111111-1111-4111-8111-111111111112",
    }),
    ownerSessionId: "some-other-session",
    branch: "feat/someone-else",
    sha: "b".repeat(40),
  });
  const mine = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 2222,
      token: "22222222-2222-4222-8222-222222222223",
    }),
    ownerSessionId: "my-session",
    branch: "feat/mine",
    sha: "c".repeat(40),
  });

  const released = releaseDeadLocalQueueObserversForGate({
    directory,
    processAlive: (pid) => pid === 2222,
    processStartTimes: new Map(),
  });

  assert.equal(released.length, 1);
  assert.equal(released[0].ownerSessionId, "some-other-session");
  assert.equal(existsSync(foreign.path), false);
  assert.equal(existsSync(mine.path), true);
});

test("the sweep retains records still backing a known lease", () => {
  // A record is the liveness PROOF that lets findDeadLocalQueueObservers cancel
  // a dead waiter's lease. Sweeping it first would strand that lease in the
  // queue permanently — trading a leaked file for a leaked slot.
  const directory = observerDirectory();
  const queued = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 3333,
      token: "33333333-3333-4333-8333-333333333334",
    }),
    ownerSessionId: "session-with-queued-lease",
    branch: "feat/queued",
    sha: "d".repeat(40),
  });
  const orphan = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 4444,
      token: "44444444-4444-4444-8444-444444444445",
    }),
    ownerSessionId: "session-with-no-lease",
    branch: "feat/orphan",
    sha: "e".repeat(40),
  });

  const released = releaseDeadLocalQueueObserversForGate({
    directory,
    retainOwnerSessionIds: new Set(["session-with-queued-lease"]),
    processAlive: () => false,
    processStartTimes: new Map(),
  });

  assert.equal(released.length, 1);
  assert.equal(released[0].ownerSessionId, "session-with-no-lease");
  assert.equal(existsSync(queued.path), true);
  assert.equal(existsSync(orphan.path), false);

  // With the lease gone from the listing, the next sweep reclaims it.
  const followUp = releaseDeadLocalQueueObserversForGate({
    directory,
    retainOwnerSessionIds: new Set(),
    processAlive: () => false,
    processStartTimes: new Map(),
  });
  assert.equal(followUp.length, 1);
  assert.equal(existsSync(queued.path), false);
});

test("readProcessStartTimes reports unknown rather than dead when the query fails", () => {
  assert.equal(
    readProcessStartTimes({
      platform: "win32",
      spawnSyncImpl: () => ({ status: 1, stdout: "" }),
    }),
    null,
  );
  assert.equal(
    readProcessStartTimes({
      platform: "linux",
      spawnSyncImpl: () => { throw new Error("ps: not found"); },
    }),
    null,
  );
  assert.deepEqual(
    readProcessStartTimes({
      platform: "linux",
      spawnSyncImpl: () => ({
        status: 0,
        stdout: "  912 Mon Aug  4 21:37:32 2026\n  913 not-a-date\n",
      }),
    }),
    new Map([[912, Date.parse("Mon Aug 4 21:37:32 2026")]]),
  );
});

test("a verifiably-running gate outranks the TTL, however long it has run", () => {
  // The TTL exists to bound records whose liveness cannot be ESTABLISHED. If it
  // outranked a matching start time it would yank a live gate's queue slot the
  // moment the threshold passed — reaping on age rather than on evidence. Only
  // a start time that DISAGREES proves pid reuse.
  const directory = observerDirectory();
  const startedAt = "2026-08-01T00:00:00.000Z";
  const registered = registerLocalQueueObserver({
    directory,
    identity: createGateObserverIdentity({
      pid: 5151,
      token: "51515151-5151-4151-8151-515151515151",
    }),
    ownerSessionId: "session-running-a-very-long-gate",
    branch: "feat/marathon",
    sha: "a".repeat(40),
    now: () => new Date(startedAt),
    startedAt,
  });

  const released = releaseDeadLocalQueueObserversForGate({
    directory,
    processAlive: () => true,
    processStartTimes: new Map([[5151, Date.parse(startedAt)]]),
    // Well past the TTL — but the host still reports this exact process.
    now: () => Date.parse(startedAt) + OBSERVER_RECORD_TTL_MS * 3,
  });

  assert.deepEqual(released, []);
  assert.equal(existsSync(registered.path), true);
});
