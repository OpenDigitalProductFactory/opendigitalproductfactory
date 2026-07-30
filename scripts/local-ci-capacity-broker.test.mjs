import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("server-owned pressure can only make a client sample less optimistic", () => {
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
    },
  });

  assert.deepEqual(merged, {
    observedAt: "2026-07-30T08:00:00.000Z",
    availableMemoryBytes: 7 * 1024 ** 3,
    sustainedCpuPercent: 80,
    diskFreeBytes: 90 * 1024 ** 3,
    dockerHealthy: false,
    convergenceActive: true,
    fencesHealthy: false,
    evidenceIsolationHealthy: false,
  });
});

test("a missing server measurement remains unmeasurable instead of trusting the client", () => {
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

  assert.equal(merged.availableMemoryBytes, undefined);
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
