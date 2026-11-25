import assert from "node:assert/strict";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync,
  symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as reservation from "./local-convergence-lock.mjs";

import {
  acquireLocalConvergenceLock,
  dpf2ReservationBlocks,
  inspectDpf2CiReservation,
  inspectLocalConvergenceLock,
  reconcileStaleLocalConvergenceLock,
  releaseLocalConvergenceLock,
} from "./local-convergence-lock.mjs";

const NOW = new Date("2026-08-12T17:00:00.000Z");

function writeReservationFixture(path, raw, { modifiedAt, mode } = {}) {
  // The parent is a private mkdtemp directory owned by this test.
  const staged = `${path}.next`;
  writeFileSync(staged, raw, { flag: "wx", mode: 0o600 });
  if (mode !== undefined) chmodSync(staged, mode);
  if (modifiedAt !== undefined) utimesSync(staged, modifiedAt, modifiedAt);
  renameSync(staged, path);
}

const posixTest = (name, fn) => test(name, { skip: process.platform === "win32" }, fn);

posixTest("DPF2 symlink reservations fail closed without inspecting the target owner", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dpf2-symlink-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = join(directory, "owner.json");
  const path = join(directory, "dpf2-local-ci.lock");
  writeReservationFixture(target, JSON.stringify({ pid: process.pid, token: "fixture" }));
  symlinkSync(target, path);
  let probes = 0;
  const observed = inspectDpf2CiReservation({
    path, processAlive: () => { probes++; return true; },
  });
  assert.equal(observed.status, "unreadable");
  assert.equal(dpf2ReservationBlocks(observed), true);
  assert.equal(probes, 0, "symlink target must not be inspected");
});

for (const mode of [0o620, 0o602]) {
  posixTest(`DPF2 reservation with unsafe mode ${mode.toString(8)} fails closed`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), "dpf2-unsafe-mode-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "dpf2-local-ci.lock");
    writeReservationFixture(path, JSON.stringify({ pid: process.pid, token: "fixture" }), { mode });
    let probes = 0;
    const observed = inspectDpf2CiReservation({
      path, processAlive: () => { probes++; return true; },
    });
    assert.equal(observed.status, "unreadable");
    assert.equal(dpf2ReservationBlocks(observed), true);
    assert.equal(probes, 0, "unsafe owner metadata must not be inspected");
  });
}

test("mid-run DPF2 wait has a fresh budget after late admission, bounded by the outer gate", async () => {
  const admissionDeadline = NOW.getTime();
  let clock = admissionDeadline + 5_000;
  const started = clock;
  const outerDeadline = started + 70_000;
  const env = {
    DPF_LOCAL_CI_RESERVATION_DEADLINE_MS: String(admissionDeadline),
    DPF_LOCAL_CI_OUTER_DEADLINE_MS: String(outerDeadline),
  };
  const deadline = reservation.dpf2ReservationDeadline(env, () => clock);
  assert.equal(deadline, outerDeadline);
  assert.equal(reservation.dpf2ReservationDeadline({}, () => clock), started + 60 * 60_000);
  assert.equal(await reservation.waitForDpf2Reservation({
    inspect: () => ({ status: "free" }), now: () => clock, deadline, notice: () => {},
  }), "clear");
  // A later phase sees a new hold after the first phase started unblocked.
  clock += 5_000;
  const sleeps = [];
  assert.equal(await reservation.waitForDpf2Reservation({
    now: () => clock, deadline,
    inspect: () => ({ status: clock < started + 55_000 ? "held" : "free" }),
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    notice: () => {},
  }), "clear");
  assert.deepEqual(sleeps, [30_000, 30_000]);
});

test("configured DPF2 path is read-only and parseable unknown owner formats wait even when old", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dpf2-format-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "foreign.lock");
  const env = { DPF2_CI_SLOT_LOCK: `  ${path}  ` };
  assert.equal(reservation.dpf2ReservationPath(env, "darwin"), path);
  assert.equal(reservation.dpf2ReservationPath({}, "darwin"), "/tmp/dpf2-local-ci.lock");
  assert.equal(reservation.dpf2ReservationPath({}, "linux"), null);
  const raw = '{"schemaVersion":2,"owner":"new protocol"}';
  writeReservationFixture(path, raw);
  const observed = inspectDpf2CiReservation({ env, now: () => Date.now() + 5000 });
  assert.equal(observed.status, "unknown-owner");
  assert.equal(dpf2ReservationBlocks(observed), true);
  assert.equal(readFileSync(path, "utf8"), raw);
});

test("DPF observes DPF2's held, initializing, stale and released lock without taking ownership", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dpf2-reservation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "dpf2-local-ci.lock");
  const inspect = (processAlive = () => true) => inspectDpf2CiReservation({
    path, now: () => NOW.getTime(), processAlive,
  });
  assert.equal(inspect().status, "free");
  writeReservationFixture(path, "", { modifiedAt: NOW });
  assert.equal(inspect().status, "initializing");
  assert.equal(dpf2ReservationBlocks(inspect()), true);
  const corruptAt = new Date(NOW.getTime() - 2000);
  writeReservationFixture(path, "", { modifiedAt: corruptAt });
  assert.equal(inspect().status, "stale-corrupt");
  assert.equal(dpf2ReservationBlocks(inspect()), false);
  assert.equal(readFileSync(path, "utf8"), "", "only DPF2 may reclaim corrupt locks");
  const raw = JSON.stringify({ pid: 21, token: "not published", acquiredAt: "2026-08-12T16:35:00.000Z" });
  writeReservationFixture(path, raw);
  assert.deepEqual(inspect(), { status: "held", pid: 21, since: "2026-08-12T16:35:00.000Z" });
  assert.equal(inspect(() => false).status, "stale-dead");
  assert.equal(dpf2ReservationBlocks(inspect(() => false)), false);
  assert.equal(readFileSync(path, "utf8"), raw, "only DPF2 may reclaim dead holders");
  rmSync(path); // Simulates the owner releasing its reservation.
  assert.equal(dpf2ReservationBlocks(inspect()), false);
});

test("DPF2 permission denial waits, while an ENOENT during the read means released", (t) => {
  const since = NOW.toISOString();
  const directory = mkdtempSync(join(tmpdir(), "dpf2-read-error-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "dpf2-local-ci.lock");
  const inspect = code => inspectDpf2CiReservation({
    path,
    read: () => { throw Object.assign(new Error(code), { code, mtimeMs: NOW.getTime() }); },
  });
  assert.deepEqual(inspect("EACCES"), { status: "unreadable", since });
  assert.equal(dpf2ReservationBlocks(inspect("EACCES")), true);
  assert.deepEqual(inspect("ENOENT"), { status: "free" });
});

test("concurrent-start counterexample: free observations on both sides grant no shared exclusion", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dpf2-start-race-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "dpf2-local-ci.lock");
  const local = join(directory, "dpf-convergence.lock");
  // Both sides finish checking before either acquires its own separate lock.
  assert.equal(dpf2ReservationBlocks(inspectDpf2CiReservation({ path })), false);
  assert.equal(inspectLocalConvergenceLock({ path: local }).status, "absent");
  assert.equal(acquireLocalConvergenceLock({ path: local, processIdentity: () => "fixture" }).status, "acquired");
  writeReservationFixture(path, JSON.stringify({ pid: process.pid, token: "fixture" }));
  assert.equal(existsSync(local), true);
  assert.equal(inspectDpf2CiReservation({ path }).status, "held");
});

test("non-reclaiming acquisition preserves even a provably dead foreign owner", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-nonreclaim-lock-"));
  const path = join(directory, "receipt.lock");
  const first = acquireLocalConvergenceLock({ path, pid: 818, processIdentity: () => "birth:old" });
  const second = acquireLocalConvergenceLock({ path, pid: 819, processIdentity: () => "birth:new", processAlive: () => false, reconcileStale: false });
  assert.equal(second.status, "conflict");
  assert.equal(JSON.parse(readFileSync(join(path, "owner.json"), "utf8")).token, first.owner.token);
  releaseLocalConvergenceLock({ path, token: first.owner.token });
});

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
