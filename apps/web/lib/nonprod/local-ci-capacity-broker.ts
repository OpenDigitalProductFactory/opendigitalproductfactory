import { statfs } from "node:fs/promises";
import { cpus, freemem } from "node:os";
import { dockerSocketGet } from "../platform-runtime/docker-socket.mjs";
import type { LocalCiHostPressure } from "./local-ci-pool-policy";
import localCiSlotResources from "./local-ci-slot-resources.json" with {
  type: "json",
};

type MaybePromise<T> = T | Promise<T>;

export type LocalCiServerPressureProbes = {
  now: () => Date;
  availableMemoryBytes: () => number;
  builderMemoryUsageBytes: () => MaybePromise<number[]>;
  sustainedCpuPercent: () => MaybePromise<number>;
  diskFreeBytes: () => MaybePromise<number>;
  dockerHealthy: () => MaybePromise<boolean>;
  convergenceActive: () => MaybePromise<boolean>;
  fencesHealthy: () => MaybePromise<boolean>;
  evidenceIsolationHealthy: () => MaybePromise<boolean>;
};

export type LocalCiCapacityBroker = () => Promise<LocalCiHostPressure>;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pessimisticMinimum(left: unknown, right: unknown): number | undefined {
  return finite(left) && finite(right) ? Math.min(left, right) : undefined;
}

function pessimisticMaximum(left: unknown, right: unknown): number | undefined {
  return finite(left) && finite(right) ? Math.max(left, right) : undefined;
}

function oldestObservation(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  const leftMs = typeof left === "string" ? Date.parse(left) : Number.NaN;
  const rightMs = typeof right === "string" ? Date.parse(right) : Number.NaN;
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return undefined;
  return leftMs <= rightMs ? left : right;
}

/**
 * Combine independent client and canonical-runtime observations so a caller can
 * only contract capacity. Missing evidence remains missing, minimum resources
 * win, maximum load wins, and any unhealthy boolean wins.
 */
export function mergeLocalCiHostPressure(input: {
  client: LocalCiHostPressure;
  server: LocalCiHostPressure;
}): LocalCiHostPressure {
  return {
    observedAt: oldestObservation(
      input.client.observedAt,
      input.server.observedAt,
    ),
    // The client samples Windows physical memory. The server runs inside the
    // bounded Docker/WSL VM, whose MemAvailable is a separate reservation
    // domain and naturally falls while an approved builder consumes memory.
    availableMemoryBytes: finite(input.client.availableMemoryBytes)
      ? input.client.availableMemoryBytes
      : undefined,
    dockerAvailableMemoryBytes: finite(input.server.availableMemoryBytes)
      ? input.server.availableMemoryBytes
      : undefined,
    builderMemoryUsageBytes: Array.isArray(
      input.server.builderMemoryUsageBytes,
    )
      ? [...input.server.builderMemoryUsageBytes]
      : undefined,
    sustainedCpuPercent: pessimisticMaximum(
      input.client.sustainedCpuPercent,
      input.server.sustainedCpuPercent,
    ),
    diskFreeBytes: pessimisticMinimum(
      input.client.diskFreeBytes,
      input.server.diskFreeBytes,
    ),
    dockerHealthy:
      input.client.dockerHealthy === true
      && input.server.dockerHealthy === true,
    convergenceActive:
      input.client.convergenceActive !== false
      || input.server.convergenceActive !== false,
    fencesHealthy:
      input.client.fencesHealthy === true
      && input.server.fencesHealthy === true,
    evidenceIsolationHealthy:
      input.client.evidenceIsolationHealthy === true
      && input.server.evidenceIsolationHealthy === true,
  };
}

async function defaultDiskFreeBytes(): Promise<number> {
  const root = process.env.DPF_HOST_INSTALL_PATH_IN_CONTAINER || "/host-dpf";
  const stats = await statfs(root);
  return stats.bavail * stats.bsize;
}

async function defaultDockerHealthy(): Promise<boolean> {
  const info = await dockerSocketGet("/info") as {
    ServerVersion?: unknown;
    OSType?: unknown;
  };
  return typeof info.ServerVersion === "string"
    && info.ServerVersion.length > 0
    && typeof info.OSType === "string";
}

function dockerBuilderContainerName(ordinal: number): string {
  const version = localCiSlotResources.builderPolicy.version;
  return `buildx_buildkit_dpf-local-ci-buildkit-v${version}-${ordinal}0`;
}

type DockerGet = (path: string) => Promise<unknown>;

type DockerContainerSummary = {
  Id?: unknown;
  Names?: unknown;
  State?: unknown;
};

function builderIsStopped(container: DockerContainerSummary): boolean {
  return container.State === "created"
    || container.State === "exited"
    || container.State === "dead";
}

export function dockerMemoryWorkingSetBytes(value: unknown): number {
  if (!value || typeof value !== "object") return Number.NaN;
  const memoryStats = (value as { memory_stats?: unknown }).memory_stats;
  if (!memoryStats || typeof memoryStats !== "object") return Number.NaN;
  const usage = Number((memoryStats as { usage?: unknown }).usage);
  const stats = (memoryStats as { stats?: unknown }).stats;
  const inactiveFile = stats && typeof stats === "object"
    ? Number(
      (stats as { total_inactive_file?: unknown; inactive_file?: unknown })
        .total_inactive_file
        ?? (stats as { inactive_file?: unknown }).inactive_file
        ?? 0,
    )
    : 0;
  if (!Number.isFinite(usage) || usage < 0 || !Number.isFinite(inactiveFile)) {
    return Number.NaN;
  }
  return Math.max(0, usage - Math.max(0, inactiveFile));
}

export async function builderMemoryUsageBytesFromDocker(
  dockerGet: DockerGet,
): Promise<number[]> {
  const containers = await dockerGet(
    "/containers/json?all=1",
  ) as DockerContainerSummary[];
  if (!Array.isArray(containers)) throw new Error("docker_container_list_invalid");

  return Promise.all(Object.values(localCiSlotResources.slots).map(
    async (slot) => {
      const expectedName = `/${dockerBuilderContainerName(slot.ordinal)}`;
      const container = containers.find((candidate) => (
        Array.isArray(candidate.Names)
        && candidate.Names.includes(expectedName)
      ));
      if (typeof container?.Id !== "string") return 0;
      if (builderIsStopped(container)) return 0;
      const stats = await dockerGet(
        `/containers/${encodeURIComponent(container.Id)}/stats?stream=false`,
      );
      const workingSet = dockerMemoryWorkingSetBytes(stats);
      if (!Number.isFinite(workingSet)) {
        throw new Error("docker_builder_memory_unmeasurable");
      }
      return workingSet;
    },
  ));
}

async function defaultBuilderMemoryUsageBytes(): Promise<number[]> {
  return builderMemoryUsageBytesFromDocker(dockerSocketGet);
}

/** How long the CPU sample runs. Matches the host client's window (BI-48F42581). */
export const LOCAL_CI_CPU_SAMPLE_WINDOW_MS = 1_000;

type CpuTimesSnapshot = { idle: number; total: number };

/** Cumulative-since-boot CPU times, summed across cores. */
export function cpuTimesSnapshot(): CpuTimesSnapshot {
  return cpus().reduce(
    (sum, cpu) => {
      const total = Object.values(cpu.times).reduce((acc, value) => acc + value, 0);
      return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
    },
    { idle: 0, total: 0 },
  );
}

/**
 * Busy percentage between two cumulative snapshots.
 *
 * The same delta the host client computes in scripts/lib/local-ci-host-pressure.mjs,
 * so the two halves of the merged observation now measure the same quantity.
 * A non-advancing or backwards total is unmeasurable, never zero — reporting an
 * idle host we did not observe is how admission gets looser than the evidence.
 */
export function cpuPercentBetween(
  start: CpuTimesSnapshot | undefined,
  end: CpuTimesSnapshot | undefined,
): number {
  if (!start || !end) return Number.NaN;
  const totalDelta = end.total - start.total;
  const idleDelta = end.idle - start.idle;
  if (!Number.isFinite(totalDelta) || totalDelta <= 0 || !Number.isFinite(idleDelta)) {
    return Number.NaN;
  }
  return Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
}

/**
 * Measure CPU utilization over a real window.
 *
 * This replaced `loadavg()[0] / cpus().length`, which is not utilization
 * (BI-48F42581). Load average is a 1-minute-smoothed count of runnable PLUS
 * uninterruptible-I/O tasks, so it was wrong in both directions and the pool
 * opened and closed on it. Measured on the reference install inside the portal,
 * over one 2-second window: /proc/stat said 55.2% busy, loadavg/cpus said 24.2%.
 * The converse bit harder — Docker build I/O parks tasks in D-state, inflating
 * load without using CPU, so a running gate could close the pool for every gate
 * queued behind it.
 */
export async function sampleSustainedCpuPercent(deps: {
  snapshot?: () => CpuTimesSnapshot;
  delay?: (ms: number) => Promise<void>;
  windowMs?: number;
} = {}): Promise<number> {
  const snapshot = deps.snapshot ?? cpuTimesSnapshot;
  const delay = deps.delay
    ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const start = snapshot();
  await delay(deps.windowMs ?? LOCAL_CI_CPU_SAMPLE_WINDOW_MS);
  return cpuPercentBetween(start, snapshot());
}

const DEFAULT_PROBES: LocalCiServerPressureProbes = {
  now: () => new Date(),
  availableMemoryBytes: () => freemem(),
  builderMemoryUsageBytes: defaultBuilderMemoryUsageBytes,
  sustainedCpuPercent: () => sampleSustainedCpuPercent(),
  diskFreeBytes: defaultDiskFreeBytes,
  dockerHealthy: defaultDockerHealthy,
  // Portal quiescence rejects the claim before this broker runs. Dependency
  // convergence is slot-scoped; the host client contributes its local signal.
  convergenceActive: () => false,
  // Durable unique activeKey plus exact manifest binding are the canonical
  // server-side fence/evidence contracts. The host client must independently
  // prove its process fence and local evidence paths.
  fencesHealthy: () => true,
  evidenceIsolationHealthy: () => true,
};

/**
 * Sample the canonical portal's view of the local-CI host. If any probe throws,
 * return an explicitly unsafe partial observation rather than mixing successful
 * values into an optimistic capacity decision.
 */
export async function observeLocalCiServerPressure(
  probes: LocalCiServerPressureProbes = DEFAULT_PROBES,
): Promise<LocalCiHostPressure> {
  const observedAt = probes.now().toISOString();
  try {
    const [
      availableMemoryBytes,
      builderMemoryUsageBytes,
      sustainedCpuPercent,
      diskFreeBytes,
      dockerHealthy,
      convergenceActive,
      fencesHealthy,
      evidenceIsolationHealthy,
    ] = await Promise.all([
      probes.availableMemoryBytes(),
      probes.builderMemoryUsageBytes(),
      probes.sustainedCpuPercent(),
      probes.diskFreeBytes(),
      probes.dockerHealthy(),
      probes.convergenceActive(),
      probes.fencesHealthy(),
      probes.evidenceIsolationHealthy(),
    ]);
    return {
      observedAt,
      availableMemoryBytes,
      dockerAvailableMemoryBytes: availableMemoryBytes,
      builderMemoryUsageBytes,
      sustainedCpuPercent,
      diskFreeBytes,
      dockerHealthy,
      convergenceActive,
      fencesHealthy,
      evidenceIsolationHealthy,
    };
  } catch {
    return {
      observedAt,
      dockerHealthy: false,
      convergenceActive: true,
      fencesHealthy: false,
      evidenceIsolationHealthy: false,
    };
  }
}
