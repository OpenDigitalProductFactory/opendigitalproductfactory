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
