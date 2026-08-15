import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cpuPercentBetween,
  sampleLocalCiHostPressure,
  summarizeLocalCiPressureSamples,
} from "./local-ci-host-pressure.mjs";

test("calculates sustained CPU from aggregate idle and total deltas", () => {
  assert.equal(
    cpuPercentBetween(
      { idle: 100, total: 200 },
      { idle: 120, total: 300 },
    ),
    80,
  );
  assert.equal(cpuPercentBetween({ idle: 10, total: 10 }, { idle: 10, total: 10 }), undefined);
});

test("samples the host through injected cross-platform probes", async () => {
  const cpuSnapshots = [
    { idle: 100, total: 200 },
    { idle: 150, total: 400 },
  ];
  const observed = await sampleLocalCiHostPressure({
    rootPath: "D:/DPF",
    sampleWindowMs: 1,
    deps: {
      now: () => new Date("2026-07-30T05:00:00.000Z"),
      freeMemoryBytes: () => 24 * 1024 ** 3,
      cpuTimes: () => cpuSnapshots.shift(),
      delay: async () => {},
      diskFreeBytes: async () => 120 * 1024 ** 3,
      dockerHealthy: () => true,
      convergenceActive: () => false,
      fencesHealthy: () => true,
      evidenceIsolationHealthy: () => true,
    },
  });

  assert.deepEqual(observed, {
    observedAt: "2026-07-30T05:00:00.000Z",
    availableMemoryBytes: 24 * 1024 ** 3,
    sustainedCpuPercent: 75,
    diskFreeBytes: 120 * 1024 ** 3,
    dockerHealthy: true,
    convergenceActive: false,
    fencesHealthy: true,
    evidenceIsolationHealthy: true,
  });
});

test("probe failures remain unmeasurable instead of becoming optimistic defaults", async () => {
  const observed = await sampleLocalCiHostPressure({
    rootPath: "D:/DPF",
    deps: {
      now: () => new Date("2026-07-30T05:00:00.000Z"),
      freeMemoryBytes: () => { throw new Error("memory unavailable"); },
      cpuTimes: () => { throw new Error("cpu unavailable"); },
      delay: async () => {},
      diskFreeBytes: async () => { throw new Error("disk unavailable"); },
      dockerHealthy: () => { throw new Error("docker unavailable"); },
      convergenceActive: () => { throw new Error("lock unavailable"); },
      fencesHealthy: () => { throw new Error("fence unavailable"); },
      evidenceIsolationHealthy: () => { throw new Error("evidence unavailable"); },
    },
  });

  assert.equal(observed.availableMemoryBytes, undefined);
  assert.equal(observed.sustainedCpuPercent, undefined);
  assert.equal(observed.diskFreeBytes, undefined);
  assert.equal(observed.dockerHealthy, false);
  assert.equal(observed.convergenceActive, true);
  assert.equal(observed.fencesHealthy, false);
  assert.equal(observed.evidenceIsolationHealthy, false);
});

test("a valid stale fence whose owner process is dead is reconciled", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-pressure-fence-"));
  const fencePath = join(directory, "slot-0.json");
  writeFileSync(fencePath, JSON.stringify({
    schema: "dpf-local-sandbox-fence/v1",
    token: "stale-owner",
    pid: 2_147_483_000,
    processIdentity: "win32:1",
    ownerSessionId: "dead-owner",
    branch: "feat/dead",
    acquiredAt: "2026-07-30T04:59:00.000Z",
    heartbeatAt: "2026-07-30T04:59:30.000Z",
  }));

  const sample = await sampleLocalCiHostPressure({
    rootPath: directory,
    sampleWindowMs: 0,
    fencePaths: [fencePath],
    evidenceIsolationHealthy: true,
    deps: {
      now: () => new Date("2026-07-30T05:00:00.000Z"),
      freeMemoryBytes: () => 1,
      cpuTimes: (() => {
        const values = [{ idle: 0, total: 10 }, { idle: 5, total: 20 }];
        return () => values.shift();
      })(),
      delay: async () => {},
      diskFreeBytes: async () => 1,
      dockerHealthy: () => true,
      convergenceActive: () => false,
    },
  });

  assert.equal(sample.fencesHealthy, true);
  assert.equal(existsSync(fencePath), false);
});

test("a dead convergence owner is reconciled before admission telemetry is sampled", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-pressure-convergence-"));
  const lockPath = join(directory, "converge.lock");
  const ownerPath = join(lockPath, "owner.json");
  mkdirSync(lockPath);
  writeFileSync(ownerPath, JSON.stringify({
    schema: "dpf-local-convergence-lock/v1",
    token: "dead-owner",
    pid: 2_147_483_000,
    processIdentity: "win32:1",
    acquiredAt: "2026-07-30T04:59:00.000Z",
  }));

  const cpuSnapshots = [{ idle: 0, total: 10 }, { idle: 5, total: 20 }];
  const sample = await sampleLocalCiHostPressure({
    rootPath: directory,
    sampleWindowMs: 0,
    convergenceLockPaths: [lockPath],
    evidenceIsolationHealthy: true,
    deps: {
      now: () => new Date("2026-07-30T05:00:00.000Z"),
      freeMemoryBytes: () => 1,
      cpuTimes: () => cpuSnapshots.shift(),
      delay: async () => {},
      diskFreeBytes: async () => 1,
      dockerHealthy: () => true,
      fencesHealthy: () => true,
      convergenceProcessAlive: () => false,
      convergenceProcessIdentity: () => "",
    },
  });

  assert.equal(sample.convergenceActive, false);
  assert.equal(existsSync(lockPath), false);
});

test("summarizes pilot peaks and integrity observations without branch labels", () => {
  const summary = summarizeLocalCiPressureSamples([
    {
      observedAt: "2026-07-30T05:00:00.000Z",
      availableMemoryBytes: 20,
      sustainedCpuPercent: 40,
      diskFreeBytes: 100,
      dockerHealthy: true,
      convergenceActive: false,
      fencesHealthy: true,
      evidenceIsolationHealthy: true,
    },
    {
      observedAt: "2026-07-30T05:01:00.000Z",
      availableMemoryBytes: 12,
      sustainedCpuPercent: 75,
      diskFreeBytes: 90,
      dockerHealthy: true,
      convergenceActive: true,
      fencesHealthy: true,
      evidenceIsolationHealthy: true,
    },
  ]);

  assert.deepEqual(summary, {
    sampleCount: 2,
    firstObservedAt: "2026-07-30T05:00:00.000Z",
    lastObservedAt: "2026-07-30T05:01:00.000Z",
    minimumAvailableMemoryBytes: 12,
    peakSustainedCpuPercent: 75,
    minimumDiskFreeBytes: 90,
    dockerHealthyThroughout: true,
    convergenceObserved: true,
    fencesHealthyThroughout: true,
    evidenceIsolationHealthyThroughout: true,
  });
  assert.equal("branch" in summary, false);
  assert.equal("sha" in summary, false);
});
