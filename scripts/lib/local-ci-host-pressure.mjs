import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { cpus } from "node:os";

import { availableMemoryBytes as readAvailableMemoryBytes } from "./host-available-memory.mjs";

import { reconcileDeadLocalSandboxFence } from "./local-sandbox-fence.mjs";
import { reconcileStaleLocalConvergenceLock } from "./local-convergence-lock.mjs";

function finiteValues(values) {
  return values.filter((value) => typeof value === "number" && Number.isFinite(value));
}

function minimum(values) {
  const finite = finiteValues(values);
  return finite.length > 0 ? Math.min(...finite) : undefined;
}

function maximum(values) {
  const finite = finiteValues(values);
  return finite.length > 0 ? Math.max(...finite) : undefined;
}

function defaultCpuTimes() {
  return cpus().reduce(
    (sum, cpu) => {
      const total = Object.values(cpu.times).reduce((acc, value) => acc + value, 0);
      return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
    },
    { idle: 0, total: 0 },
  );
}

async function defaultDiskFreeBytes(rootPath) {
  const stats = await statfs(rootPath);
  return Number(stats.bavail) * Number(stats.bsize);
}

function defaultDockerHealthy() {
  return spawnSync(
    "docker",
    ["info", "--format", "{{.ServerVersion}}"],
    { encoding: "utf8", timeout: 5_000 },
  ).status === 0;
}

function defaultConvergenceActive(paths = [], deps = {}) {
  return paths.some((path) => {
    if (!existsSync(path)) return false;
    const result = reconcileStaleLocalConvergenceLock({
      path,
      processAlive: deps.processAlive,
      processIdentity: deps.processIdentity,
    });
    return result.status !== "absent" && result.status !== "reconciled";
  });
}

function defaultFencesHealthy(paths = []) {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const result = reconcileDeadLocalSandboxFence({ path });
      if (!["absent", "live", "reconciled"].includes(result.status)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function attempt(probe, unsafeFallback) {
  try {
    return probe();
  } catch {
    return unsafeFallback;
  }
}

async function attemptAsync(probe, unsafeFallback) {
  try {
    return await probe();
  } catch {
    return unsafeFallback;
  }
}

export function cpuPercentBetween(start, end) {
  if (!start || !end) return undefined;
  const totalDelta = end.total - start.total;
  const idleDelta = end.idle - start.idle;
  if (!Number.isFinite(totalDelta) || totalDelta <= 0 || !Number.isFinite(idleDelta)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
}

/**
 * Produce the exact low-cardinality host observation attached to lease
 * admission and pilot evidence. Failed probes remain unsafe/unmeasurable.
 */
export async function sampleLocalCiHostPressure({
  rootPath,
  sampleWindowMs = 1_000,
  convergenceLockPaths = [],
  fencePaths = [],
  evidenceIsolationHealthy = false,
  deps = {},
}) {
  const now = deps.now ?? (() => new Date());
  // Reclaimable-inclusive, not the free page pool: on Darwin `os.freemem()`
  // omits inactive/speculative/purgeable pages, so a sanctioned build drove
  // this under the 4 GiB fence floor and killed itself (BI-EB6DBAF0).
  const freeMemoryBytes = deps.freeMemoryBytes ?? readAvailableMemoryBytes;
  const cpuTimes = deps.cpuTimes ?? defaultCpuTimes;
  const delay = deps.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const diskFreeBytes = deps.diskFreeBytes ?? defaultDiskFreeBytes;
  const dockerHealthy = deps.dockerHealthy ?? defaultDockerHealthy;
  const convergenceActive = deps.convergenceActive
    ?? (() => defaultConvergenceActive(convergenceLockPaths, {
      processAlive: deps.convergenceProcessAlive,
      processIdentity: deps.convergenceProcessIdentity,
    }));
  const fencesHealthy = deps.fencesHealthy
    ?? (() => defaultFencesHealthy(fencePaths));
  const evidenceHealthy = deps.evidenceIsolationHealthy
    ?? (() => evidenceIsolationHealthy);

  const cpuStart = attempt(cpuTimes, undefined);
  await delay(sampleWindowMs);
  const cpuEnd = attempt(cpuTimes, undefined);

  return {
    observedAt: now().toISOString(),
    availableMemoryBytes: attempt(freeMemoryBytes, undefined),
    sustainedCpuPercent: cpuPercentBetween(cpuStart, cpuEnd),
    diskFreeBytes: await attemptAsync(() => diskFreeBytes(rootPath), undefined),
    dockerHealthy: attempt(dockerHealthy, false) === true,
    convergenceActive: attempt(convergenceActive, true) !== false,
    fencesHealthy: attempt(fencesHealthy, false) === true,
    evidenceIsolationHealthy: attempt(evidenceHealthy, false) === true,
  };
}

export function summarizeLocalCiPressureSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      sampleCount: 0,
      firstObservedAt: null,
      lastObservedAt: null,
      minimumAvailableMemoryBytes: undefined,
      peakSustainedCpuPercent: undefined,
      minimumDiskFreeBytes: undefined,
      dockerHealthyThroughout: false,
      convergenceObserved: false,
      fencesHealthyThroughout: false,
      evidenceIsolationHealthyThroughout: false,
    };
  }
  return {
    sampleCount: samples.length,
    firstObservedAt: samples[0]?.observedAt ?? null,
    lastObservedAt: samples.at(-1)?.observedAt ?? null,
    minimumAvailableMemoryBytes: minimum(samples.map((sample) => sample.availableMemoryBytes)),
    peakSustainedCpuPercent: maximum(samples.map((sample) => sample.sustainedCpuPercent)),
    minimumDiskFreeBytes: minimum(samples.map((sample) => sample.diskFreeBytes)),
    dockerHealthyThroughout: samples.every((sample) => sample.dockerHealthy === true),
    convergenceObserved: samples.some((sample) => sample.convergenceActive === true),
    fencesHealthyThroughout: samples.every((sample) => sample.fencesHealthy === true),
    evidenceIsolationHealthyThroughout: samples.every(
      (sample) => sample.evidenceIsolationHealthy === true,
    ),
  };
}
