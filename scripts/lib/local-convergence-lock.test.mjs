import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireLocalConvergenceLock,
  inspectLocalConvergenceLock,
  reconcileStaleLocalConvergenceLock,
  releaseLocalConvergenceLock,
} from "./local-convergence-lock.mjs";

const NOW = new Date("2026-08-12T17:00:00.000Z");

test("a live Windows owner remains fail-closed even when its lock is old", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-convergence-lock-"));
  const lockPath = join(directory, "converge.lock");
  mkdirSync(lockPath);
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    schema: "dpf-local-convergence-lock/v1",
    token: "live-token",
    pid: 717,
    processIdentity: "win32:638906724000000000",
    acquiredAt: "2026-08-12T15:00:00.000Z",
  }));

  const result = reconcileStaleLocalConvergenceLock({
    path: lockPath,
    now: () => NOW,
    processAlive: () => true,
    processIdentity: () => "win32:638906724000000000",
  });

  assert.equal(result.status, "live");
  assert.equal(existsSync(lockPath), true);
});

test("a dead versioned owner is reconciled without waiting for an age guess", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-convergence-lock-"));
  const lockPath = join(directory, "converge.lock");
  mkdirSync(lockPath);
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    schema: "dpf-local-convergence-lock/v1",
    token: "dead-token",
    pid: 818,
    processIdentity: "win32:638906724000000000",
    acquiredAt: "2026-08-12T16:59:59.000Z",
  }));

  const result = reconcileStaleLocalConvergenceLock({
    path: lockPath,
    now: () => NOW,
    processAlive: () => false,
    processIdentity: () => "",
  });

  assert.equal(result.status, "reconciled");
  assert.equal(existsSync(lockPath), false);
});

test("an unmeasurable live owner remains fail-closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-convergence-lock-"));
  const lockPath = join(directory, "converge.lock");
  mkdirSync(lockPath);
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    schema: "dpf-local-convergence-lock/v1",
    token: "unknown-token",
    pid: 919,
    processIdentity: "win32:638906724000000000",
    acquiredAt: "2026-08-12T15:00:00.000Z",
  }));

  const result = reconcileStaleLocalConvergenceLock({
    path: lockPath,
    now: () => NOW,
    processAlive: () => true,
    processIdentity: () => "",
  });

  assert.equal(result.status, "unmeasurable");
  assert.equal(existsSync(lockPath), true);
});

test("acquire records owner identity and release cannot remove another token", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-convergence-lock-"));
  const lockPath = join(directory, "converge.lock");
  const acquired = acquireLocalConvergenceLock({
    path: lockPath,
    pid: 1020,
    now: () => NOW,
    processIdentity: () => "win32:638906724000000000",
    token: "owned-token",
  });

  assert.equal(acquired.status, "acquired");
  assert.match(readFileSync(join(lockPath, "owner.json"), "utf8"), /owned-token/);
  assert.equal(releaseLocalConvergenceLock({ path: lockPath, token: "foreign-token" }).status, "not-owner");
  assert.equal(existsSync(lockPath), true);
  assert.equal(releaseLocalConvergenceLock({ path: lockPath, token: "owned-token" }).status, "released");
});

test("legacy empty locks remain held while recent", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-convergence-lock-"));
  const lockPath = join(directory, "converge.lock");
  mkdirSync(lockPath);
  assert.equal(inspectLocalConvergenceLock({ path: lockPath, now: () => new Date() }).status, "legacy-live");
});
