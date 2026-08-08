import assert from "node:assert/strict";
import test from "node:test";

import {
  dockerMemoryWorkingSetBytes,
  mergeLocalCiHostPressure,
  observeLocalCiServerPressure,
} from "../apps/web/lib/nonprod/local-ci-capacity-broker.ts";

const CLIENT = {
  observedAt: "2026-07-30T08:00:30.000Z",
  availableMemoryBytes: 16 * 1024 ** 3,
  sustainedCpuPercent: 20,
  diskFreeBytes: 500 * 1024 ** 3,
  dockerHealthy: true,
  convergenceActive: false,
  fencesHealthy: true,
  evidenceIsolationHealthy: true,
};

test("keeps Windows and Docker memory in separate reservation domains", () => {
  const merged = mergeLocalCiHostPressure({
    client: CLIENT,
    server: {
      ...CLIENT,
      observedAt: "2026-07-30T08:00:00.000Z",
      availableMemoryBytes: 7 * 1024 ** 3,
      sustainedCpuPercent: 80,
      diskFreeBytes: 90 * 1024 ** 3,
      dockerHealthy: false,
      convergenceActive: true,
      fencesHealthy: false,
      evidenceIsolationHealthy: false,
      builderMemoryUsageBytes: [2 * 1024 ** 3, 0],
    },
  });

  assert.deepEqual(merged, {
    observedAt: "2026-07-30T08:00:00.000Z",
    availableMemoryBytes: 16 * 1024 ** 3,
    dockerAvailableMemoryBytes: 7 * 1024 ** 3,
    builderMemoryUsageBytes: [2 * 1024 ** 3, 0],
    sustainedCpuPercent: 80,
    diskFreeBytes: 90 * 1024 ** 3,
    dockerHealthy: false,
    convergenceActive: true,
    fencesHealthy: false,
    evidenceIsolationHealthy: false,
  });
});

test("a missing Docker measurement remains unmeasurable without erasing Windows memory", () => {
  const merged = mergeLocalCiHostPressure({
    client: CLIENT,
    server: {
      observedAt: "2026-07-30T08:00:00.000Z",
      dockerHealthy: false,
      convergenceActive: false,
      fencesHealthy: false,
      evidenceIsolationHealthy: false,
    },
  });

  assert.equal(merged.availableMemoryBytes, 16 * 1024 ** 3);
  assert.equal(merged.dockerAvailableMemoryBytes, undefined);
  assert.equal(merged.sustainedCpuPercent, undefined);
  assert.equal(merged.diskFreeBytes, undefined);
  assert.equal(merged.dockerHealthy, false);
});

test("canonical broker converts probe failure into fail-closed pressure", async () => {
  const pressure = await observeLocalCiServerPressure({
    now: () => new Date("2026-07-30T08:00:00.000Z"),
    availableMemoryBytes: () => {
      throw new Error("memory unavailable");
    },
    builderMemoryUsageBytes: async () => [0, 0],
    sustainedCpuPercent: () => 10,
    diskFreeBytes: async () => 400 * 1024 ** 3,
    dockerHealthy: async () => true,
    convergenceActive: async () => false,
    fencesHealthy: async () => true,
    evidenceIsolationHealthy: async () => true,
  });

  assert.deepEqual(pressure, {
    observedAt: "2026-07-30T08:00:00.000Z",
    dockerHealthy: false,
    convergenceActive: true,
    fencesHealthy: false,
    evidenceIsolationHealthy: false,
  });
});

test("Docker builder usage excludes reclaimable inactive file cache", () => {
  assert.equal(dockerMemoryWorkingSetBytes({
    memory_stats: {
      usage: 3 * 1024 ** 3,
      stats: { inactive_file: 1.5 * 1024 ** 3 },
    },
  }), 1.5 * 1024 ** 3);
  assert.equal(Number.isNaN(dockerMemoryWorkingSetBytes({})), true);
});
