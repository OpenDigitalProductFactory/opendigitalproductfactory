import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireLocalSandboxFence,
  heartbeatLocalSandboxFence,
  inspectLocalSandboxFence,
  reconcileDeadLocalSandboxFence,
  readProcessIdentity,
  releaseLocalSandboxFence,
} from "./local-sandbox-fence.mjs";

function fencePath() {
  return join(mkdtempSync(join(tmpdir(), "dpf-sandbox-fence-")), "owner.json");
}

test("a live owner blocks a competing claimant even beyond database TTL", () => {
  const path = fencePath();
  const first = acquireLocalSandboxFence({
    path,
    ownerSessionId: "owner-1",
    branch: "feat/one",
    pid: 101,
    processAlive: () => true,
    processIdentity: (pid) => `test:${pid}`,
    token: "token-1",
  });
  const second = acquireLocalSandboxFence({
    path,
    ownerSessionId: "owner-2",
    branch: "feat/two",
    pid: 202,
    processAlive: () => true,
    processIdentity: (pid) => `test:${pid}`,
    token: "token-2",
  });

  assert.equal(first.status, "acquired");
  assert.equal(second.status, "conflict");
  assert.equal(second.active.token, "token-1");
});

test("a dead orphan is reaped and replaced atomically", () => {
  const path = fencePath();
  writeFileSync(path, JSON.stringify({
    token: "orphan",
    pid: 303,
    ownerSessionId: "dead",
    branch: "feat/dead",
  }));

  const claimed = acquireLocalSandboxFence({
    path,
    ownerSessionId: "owner-new",
    branch: "feat/new",
    pid: 404,
    processAlive: () => false,
    processIdentity: (pid) => `test:${pid}`,
    token: "token-new",
  });

  assert.equal(claimed.status, "acquired");
  assert.equal(claimed.record.token, "token-new");
});

test("heartbeat and release are fenced by the owner token", () => {
  const path = fencePath();
  acquireLocalSandboxFence({
    path,
    ownerSessionId: "owner",
    branch: "feat/one",
    pid: 505,
    processAlive: () => true,
    processIdentity: (pid) => `test:${pid}`,
    token: "mine",
  });

  assert.equal(heartbeatLocalSandboxFence({ path, token: "intruder" }).status, "lost");
  assert.equal(releaseLocalSandboxFence({ path, token: "intruder" }).status, "not-owner");
  assert.equal(heartbeatLocalSandboxFence({ path, token: "mine" }).status, "renewed");
  assert.equal(releaseLocalSandboxFence({ path, token: "mine" }).status, "released");
  assert.equal(existsSync(path), false);
});

test("inspection only trusts a live versioned owner", () => {
  const path = fencePath();
  const record = {
    schema: "dpf-local-sandbox-fence/v1",
    token: "peer",
    pid: 606,
    processIdentity: "test:606",
    ownerSessionId: "peer-owner",
    branch: "feat/peer",
    acquiredAt: "2026-07-30T12:00:00.000Z",
    heartbeatAt: "2026-07-30T12:00:00.000Z",
  };
  writeFileSync(path, JSON.stringify(record));

  assert.deepEqual(inspectLocalSandboxFence({
    path,
    processAlive: (pid) => pid === 606,
    processIdentity: (pid) => `test:${pid}`,
    now: () => new Date("2026-07-30T12:01:00.000Z"),
  }), { status: "live", record });
  assert.equal(inspectLocalSandboxFence({
    path,
    processAlive: () => false,
    processIdentity: (pid) => `test:${pid}`,
    now: () => new Date("2026-07-30T12:01:00.000Z"),
  }).status, "stale");
});

test("inspection rejects a reused pid whose process-start identity changed", () => {
  const path = fencePath();
  writeFileSync(path, JSON.stringify({
    schema: "dpf-local-sandbox-fence/v1",
    token: "peer",
    pid: 707,
    processIdentity: "test:old-start",
    ownerSessionId: "peer-owner",
    branch: "feat/peer",
    acquiredAt: "2026-07-30T12:00:00.000Z",
    heartbeatAt: "2026-07-30T12:00:30.000Z",
  }));

  assert.equal(inspectLocalSandboxFence({
    path,
    processAlive: () => true,
    processIdentity: () => "test:new-start",
    now: () => new Date("2026-07-30T12:01:00.000Z"),
  }).status, "stale");
});

test("reconciliation removes only a valid fence whose original process is gone", () => {
  const path = fencePath();
  writeFileSync(path, JSON.stringify({
    schema: "dpf-local-sandbox-fence/v1",
    token: "dead-owner",
    pid: 717,
    processIdentity: "test:717",
    ownerSessionId: "dead-owner",
    branch: "feat/dead",
    acquiredAt: "2026-07-30T12:00:00.000Z",
    heartbeatAt: "2026-07-30T12:00:30.000Z",
  }));

  assert.equal(reconcileDeadLocalSandboxFence({
    path,
    processAlive: () => false,
  }).status, "reconciled");
  assert.equal(existsSync(path), false);
});

test("reconciliation preserves live and malformed fences fail-closed", () => {
  const livePath = fencePath();
  writeFileSync(livePath, JSON.stringify({
    schema: "dpf-local-sandbox-fence/v1",
    token: "live-owner",
    pid: 727,
    processIdentity: "test:727",
    ownerSessionId: "live-owner",
    branch: "feat/live",
    acquiredAt: "2026-07-30T12:00:00.000Z",
    heartbeatAt: "2026-07-30T12:00:30.000Z",
  }));
  assert.equal(reconcileDeadLocalSandboxFence({
    path: livePath,
    processAlive: () => true,
    processIdentity: (pid) => `test:${pid}`,
  }).status, "live");
  assert.equal(existsSync(livePath), true);

  const malformedPath = fencePath();
  writeFileSync(malformedPath, JSON.stringify({ pid: 737 }));
  assert.equal(reconcileDeadLocalSandboxFence({
    path: malformedPath,
    processAlive: () => false,
  }).status, "invalid");
  assert.equal(existsSync(malformedPath), true);
});

test("reconciliation reaps PID reuse but preserves an unmeasurable live process", () => {
  const reusedPath = fencePath();
  writeFileSync(reusedPath, JSON.stringify({
    schema: "dpf-local-sandbox-fence/v1",
    token: "old-owner",
    pid: 747,
    processIdentity: "test:old-start",
    ownerSessionId: "old-owner",
    branch: "feat/old",
    acquiredAt: "2026-07-30T12:00:00.000Z",
    heartbeatAt: "2026-07-30T12:00:30.000Z",
  }));
  assert.equal(reconcileDeadLocalSandboxFence({
    path: reusedPath,
    processAlive: () => true,
    processIdentity: () => "test:new-start",
  }).status, "reconciled");
  assert.equal(existsSync(reusedPath), false);

  const unmeasurablePath = fencePath();
  writeFileSync(unmeasurablePath, JSON.stringify({
    schema: "dpf-local-sandbox-fence/v1",
    token: "unknown-owner",
    pid: 757,
    processIdentity: "test:757",
    ownerSessionId: "unknown-owner",
    branch: "feat/unknown",
    acquiredAt: "2026-07-30T12:00:00.000Z",
    heartbeatAt: "2026-07-30T12:00:30.000Z",
  }));
  assert.equal(reconcileDeadLocalSandboxFence({
    path: unmeasurablePath,
    processAlive: () => true,
    processIdentity: () => "",
  }).status, "unmeasurable");
  assert.equal(existsSync(unmeasurablePath), true);
});

test("inspection rejects a live pid whose fence heartbeat is stale", () => {
  const path = fencePath();
  writeFileSync(path, JSON.stringify({
    schema: "dpf-local-sandbox-fence/v1",
    token: "peer",
    pid: 808,
    processIdentity: "test:808",
    ownerSessionId: "peer-owner",
    branch: "feat/peer",
    acquiredAt: "2026-07-30T12:00:00.000Z",
    heartbeatAt: "2026-07-30T12:00:00.000Z",
  }));

  assert.equal(inspectLocalSandboxFence({
    path,
    processAlive: () => true,
    processIdentity: (pid) => `test:${pid}`,
    now: () => new Date("2026-07-30T12:09:00.000Z"),
  }).status, "stale");
});

test("process identity uses the Linux kernel start tick, not pid alone", () => {
  const identity = readProcessIdentity(909, {
    platform: "linux",
    readFileSyncImpl: () =>
      "909 (node worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654 20",
  });

  assert.equal(identity, "linux:987654");
});

test("process identity normalizes the Windows process creation tick", () => {
  const identity = readProcessIdentity(1001, {
    platform: "win32",
    spawnSyncImpl: () => ({
      status: 0,
      stdout: "638894736000000000\r\n",
    }),
  });

  assert.equal(identity, "win32:638894736000000000");
});
