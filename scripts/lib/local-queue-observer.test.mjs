import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createGateObserverIdentity,
  findDeadLocalQueueObservers,
  registerLocalQueueObserver,
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

test("two observers claiming one thread fail closed rather than guess", () => {
  // One thread re-gating concurrently would make "which process owns this?"
  // ambiguous; cancelling on a coin flip could kill a live waiter's lease.
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

  assert.deepEqual(dead, []);
});
