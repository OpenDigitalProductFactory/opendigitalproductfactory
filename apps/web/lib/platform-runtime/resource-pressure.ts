// apps/web/lib/platform-runtime/resource-pressure.ts
//
// "Right Now" cockpit data source — the live resource-pressure snapshot the
// portal never used to surface (BI-1A68257F / EP-FULL-OBS). It answers the
// founder-observed question "why is memory at 90%, and did the local model just
// kick in?" from INSIDE the portal container, with three verified signals:
//
//   1. VM memory (the headline).  /proc/meminfo as seen from the portal is
//      VM-WIDE on Docker Desktop / WSL2 (verified: MemTotal ≈ the 23.47GiB WSL
//      cap, not a cgroup slice), so MemTotal-MemAvailable is the true Docker-VM
//      memory pressure — and it captures the Docker Model Runner even though the
//      model is NOT a container (`docker ps` never lists it).
//   2. Container attribution.  The Docker socket (already bind-mounted into the
//      portal, see docker-compose.yml) gives per-container memory via the same
//      formula `docker stats` uses (usage - inactive_file), so the operator can
//      see WHICH container to act on. Reuses the bounded, timeout-guarded
//      `dockerSocketGet` helper.
//   3. The gap.  vmUsed - sum(containers) = "model runner + VM overhead". This
//      bucket balloons ~16GiB when qwen3-coder loads — it is the local-model
//      pressure signal, derived without any model-runner API dependency.
//
// Local inference engine state is a best-effort fourth signal from the Docker
// Model Runner's own endpoints (/engines/status, /engines/v1/models). It
// degrades to "unavailable" on installs without a model runner; the memory and
// container views stand alone.
//
// Every external reader is injectable so the loader is unit-testable with no
// socket, no /proc, and no model runner.

import { readFile } from "node:fs/promises";
import { dockerSocketGet } from "./docker-socket.mjs";

// ─── Public types ───────────────────────────────────────────────────────────

export type ContainerConsumer = {
  id: string;
  name: string;
  image: string;
  memBytes: number;
  /** Share of VM total memory, 0-100, or null when VM total is unknown. */
  memPctOfVm: number | null;
  /** Instantaneous CPU%, or null when the single-shot sample can't compute it. */
  cpuPct: number | null;
};

export type MemorySignal =
  | {
      available: true;
      vmTotalBytes: number;
      vmUsedBytes: number;
      vmAvailableBytes: number;
      /** vmUsed / vmTotal * 100. The headline "we're at N%" number. */
      pressurePct: number;
      /** Sum of per-container working sets. */
      containerAttributedBytes: number;
      /** vmUsed - containerAttributed: model runner + VM/kernel overhead. */
      otherBytes: number;
    }
  | { available: false; reason: string };

export type LocalModelSignal = {
  /** Whether the model-runner endpoints were reachable at all. */
  reachable: boolean;
  /** llama.cpp backend serving state, when the engines endpoint answered. */
  engineRunning: boolean | null;
  /** Locally-available models with parsed byte sizes (biggest first). */
  models: Array<{ id: string; label: string; sizeBytes: number | null }>;
};

export type ResourcePressureSnapshot = {
  capturedAt: string;
  cpuCount: number | null;
  memory: MemorySignal;
  containers: ContainerConsumer[];
  /** True when more running containers exist than the per-snapshot cap. */
  containersTruncated: boolean;
  localModel: LocalModelSignal;
};

export type ResourcePressureDeps = {
  /** Reads a path like "/proc/meminfo". Defaults to fs. */
  readProcFile?: (path: string) => Promise<string>;
  /** Docker Engine GET over the socket. Defaults to dockerSocketGet. */
  dockerGet?: (path: string) => Promise<unknown>;
  /** Best-effort model-runner GET; returns null on any failure. */
  modelRunnerGet?: (
    path: string,
  ) => Promise<{ status: number; body: string } | null>;
  now?: () => number;
};

// Cap the number of containers we pull stats for in one snapshot. 40 is far
// above a normal DPF stack (~19); the excess is flagged, never silently hidden.
const CONTAINER_CAP = 40;
const STATS_CONCURRENCY = 6;

// ─── Loader ─────────────────────────────────────────────────────────────────

export async function loadResourcePressure(
  deps: ResourcePressureDeps = {},
): Promise<ResourcePressureSnapshot> {
  const readProcFile = deps.readProcFile ?? ((p: string) => readFile(p, "utf8"));
  const dockerGet = deps.dockerGet ?? dockerSocketGet;
  const modelRunnerGet = deps.modelRunnerGet ?? defaultModelRunnerGet;
  const now = deps.now ?? (() => Date.now());

  const [meminfo, containersResult, localModel, cpuCount] = await Promise.all([
    readMemInfo(readProcFile),
    readContainers(dockerGet),
    readLocalModel(modelRunnerGet),
    readCpuCount(dockerGet),
  ]);

  const containerAttributedBytes = containersResult.containers.reduce(
    (sum, c) => sum + c.memBytes,
    0,
  );

  const memory: MemorySignal = meminfo
    ? (() => {
        const vmUsedBytes = Math.max(0, meminfo.totalBytes - meminfo.availableBytes);
        return {
          available: true as const,
          vmTotalBytes: meminfo.totalBytes,
          vmUsedBytes,
          vmAvailableBytes: meminfo.availableBytes,
          pressurePct: meminfo.totalBytes > 0
            ? round1((vmUsedBytes / meminfo.totalBytes) * 100)
            : 0,
          containerAttributedBytes,
          otherBytes: Math.max(0, vmUsedBytes - containerAttributedBytes),
        };
      })()
    : {
        available: false as const,
        reason: "meminfo_unavailable",
      };

  // Backfill each container's %-of-VM now that VM total is known.
  const vmTotal = memory.available ? memory.vmTotalBytes : null;
  const containers = containersResult.containers
    .map((c) => ({
      ...c,
      memPctOfVm: vmTotal && vmTotal > 0 ? round1((c.memBytes / vmTotal) * 100) : null,
    }))
    .sort((a, b) => b.memBytes - a.memBytes);

  return {
    capturedAt: new Date(now()).toISOString(),
    cpuCount,
    memory,
    containers,
    containersTruncated: containersResult.truncated,
    localModel,
  };
}

// ─── /proc/meminfo ──────────────────────────────────────────────────────────

async function readMemInfo(
  readProcFile: (path: string) => Promise<string>,
): Promise<{ totalBytes: number; availableBytes: number } | null> {
  try {
    const raw = await readProcFile("/proc/meminfo");
    const total = parseMemInfoKb(raw, "MemTotal");
    const available = parseMemInfoKb(raw, "MemAvailable");
    if (total === null || available === null) return null;
    return { totalBytes: total * 1024, availableBytes: available * 1024 };
  } catch {
    return null;
  }
}

/** Parse a "<Key>: <n> kB" line from /proc/meminfo. Exported for tests. */
export function parseMemInfoKb(raw: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m").exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// ─── Docker socket: containers + stats ──────────────────────────────────────

type ContainerListEntry = {
  Id?: unknown;
  Names?: unknown;
  Image?: unknown;
};

async function readContainers(
  dockerGet: (path: string) => Promise<unknown>,
): Promise<{ containers: ContainerConsumer[]; truncated: boolean }> {
  let list: ContainerListEntry[];
  try {
    const raw = await dockerGet("/containers/json");
    list = Array.isArray(raw) ? (raw as ContainerListEntry[]) : [];
  } catch {
    return { containers: [], truncated: false };
  }

  const truncated = list.length > CONTAINER_CAP;
  const capped = list.slice(0, CONTAINER_CAP);

  const consumers = await mapWithConcurrency(
    capped,
    STATS_CONCURRENCY,
    async (entry) => {
      const id = typeof entry.Id === "string" ? entry.Id : null;
      if (!id) return null;
      try {
        const stats = await dockerGet(`/containers/${id}/stats?stream=false`);
        return toConsumer(id, entry, stats);
      } catch {
        // A container that vanished mid-snapshot (ephemeral build/test box) or a
        // stats timeout drops out rather than failing the whole view.
        return null;
      }
    },
  );

  return {
    containers: consumers.filter((c): c is ContainerConsumer => c !== null),
    truncated,
  };
}

function toConsumer(
  id: string,
  entry: ContainerListEntry,
  stats: unknown,
): ContainerConsumer | null {
  const s = stats as {
    memory_stats?: {
      usage?: number;
      stats?: {
        inactive_file?: number;
        total_inactive_file?: number;
        cache?: number;
      };
    };
    cpu_stats?: DockerCpuStats;
    precpu_stats?: DockerCpuStats;
  };
  const mem = s.memory_stats;
  if (!mem || typeof mem.usage !== "number") return null;

  // Match `docker stats`: subtract page cache from usage.
  const cache =
    mem.stats?.inactive_file ??
    mem.stats?.total_inactive_file ??
    mem.stats?.cache ??
    0;
  const memBytes = Math.max(0, mem.usage - cache);

  const names = Array.isArray(entry.Names) ? (entry.Names as unknown[]) : [];
  const rawName = typeof names[0] === "string" ? (names[0] as string) : id.slice(0, 12);
  const name = rawName.replace(/^\//, "");
  const image = typeof entry.Image === "string" ? entry.Image : "";

  return {
    id,
    name,
    image,
    memBytes,
    memPctOfVm: null, // backfilled once VM total is known
    cpuPct: computeCpuPct(s.cpu_stats, s.precpu_stats),
  };
}

type DockerCpuStats = {
  cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
  system_cpu_usage?: number;
  online_cpus?: number;
};

/** The `docker stats` CPU% formula. Exported for tests. */
export function computeCpuPct(
  cpu: DockerCpuStats | undefined,
  precpu: DockerCpuStats | undefined,
): number | null {
  const cpuTotal = cpu?.cpu_usage?.total_usage;
  const preTotal = precpu?.cpu_usage?.total_usage;
  const sys = cpu?.system_cpu_usage;
  const preSys = precpu?.system_cpu_usage;
  if (
    typeof cpuTotal !== "number" ||
    typeof preTotal !== "number" ||
    typeof sys !== "number" ||
    typeof preSys !== "number"
  ) {
    return null;
  }
  const cpuDelta = cpuTotal - preTotal;
  const sysDelta = sys - preSys;
  const online =
    cpu?.online_cpus ?? cpu?.cpu_usage?.percpu_usage?.length ?? 0;
  if (cpuDelta <= 0 || sysDelta <= 0 || online <= 0) return null;
  return round1((cpuDelta / sysDelta) * online * 100);
}

async function readCpuCount(
  dockerGet: (path: string) => Promise<unknown>,
): Promise<number | null> {
  try {
    const info = (await dockerGet("/info")) as { NCPU?: unknown };
    return typeof info.NCPU === "number" ? info.NCPU : null;
  } catch {
    return null;
  }
}

// ─── Docker Model Runner (best-effort) ──────────────────────────────────────

async function readLocalModel(
  modelRunnerGet: (
    path: string,
  ) => Promise<{ status: number; body: string } | null>,
): Promise<LocalModelSignal> {
  const [engines, models] = await Promise.all([
    modelRunnerGet("/engines/status"),
    modelRunnerGet("/engines/v1/models"),
  ]);

  const reachable = engines !== null || models !== null;
  return {
    reachable,
    engineRunning: parseEngineRunning(engines),
    models: parseModelList(models),
  };
}

/** `{ "llama.cpp": "Running: ...", "vllm": "Not Installed..." }` → true. Exported for tests. */
export function parseEngineRunning(
  res: { status: number; body: string } | null,
): boolean | null {
  if (!res || res.status !== 200) return null;
  try {
    const parsed = JSON.parse(res.body) as Record<string, unknown>;
    return Object.values(parsed).some(
      (v) => typeof v === "string" && /^running\b/i.test(v.trim()),
    );
  } catch {
    return null;
  }
}

/** OpenAI-style `{ data: [{ id, dmr: { size } }] }` → sized model list. Exported for tests. */
export function parseModelList(
  res: { status: number; body: string } | null,
): Array<{ id: string; label: string; sizeBytes: number | null }> {
  if (!res || res.status !== 200) return [];
  try {
    const parsed = JSON.parse(res.body) as {
      data?: Array<{ id?: unknown; dmr?: { size?: unknown; parameters?: unknown } }>;
    };
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    return rows
      .map((row) => {
        const id = typeof row.id === "string" ? row.id : null;
        if (!id) return null;
        const sizeBytes =
          typeof row.dmr?.size === "string" ? parseBinarySize(row.dmr.size) : null;
        return { id, label: shortModelLabel(id), sizeBytes };
      })
      .filter((m): m is { id: string; label: string; sizeBytes: number | null } => m !== null)
      .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  } catch {
    return [];
  }
}

/** "docker.io/ai/qwen3-coder:latest" → "qwen3-coder". */
function shortModelLabel(id: string): string {
  const noTag = id.split(":")[0] ?? id;
  const last = noTag.split("/").pop() ?? noTag;
  return last;
}

/** "16.45GiB" / "260.86MiB" / "23.47 GB" → bytes. Exported for tests. */
export function parseBinarySize(text: string): number | null {
  const match = /([\d.]+)\s*([KMGT]?)i?B/i.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toUpperCase();
  const factor: Record<string, number> = {
    "": 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
  };
  return Math.round(value * (factor[unit] ?? 1));
}

async function defaultModelRunnerGet(
  path: string,
): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetch(`http://model-runner.docker.internal${path}`, {
      signal: AbortSignal.timeout(2500),
    });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

// ─── small utilities ────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
