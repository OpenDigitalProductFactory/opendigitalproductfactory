// Host-memory-headroom guard for the self-upgrade candidate build.
//
// SUR-BF75ED2A (2026-08-11): a self-upgrade died at the candidate promoter
// `docker build` with `error from sender: readdirent
// /host-dpf/.upgrade-workspace/scripts: cannot allocate memory`. The WSL2 VM
// (hard-capped at 24GB) was thrashing — swap in use, MemFree ~467MB — and
// buildkit's context sender could not allocate a kernel buffer to enumerate the
// build context, so the build aborted. It failed at the PREFLIGHT stage, before
// any portal swap, so nothing was deployed; the run was nevertheless marked
// terminally `failed` with no memory check preceding the build.
//
// This guard lets the pipeline DEFER (skip + cooldown, retryable) instead of
// launching a build the host cannot afford. The next hourly cron retries once
// memory recovers (WSL2 autoMemoryReclaim=gradual, or load subsiding).
//
// Critically the floor is measured against MemAvailable (reclaimable-inclusive),
// NOT MemFree: Linux keeps MemFree low by design (idle RAM becomes page cache),
// so gating on MemFree would defer almost every run on a busy-but-healthy host.
// MemAvailable only approaches this floor under genuine exhaustion, so the guard
// fires rarely and never starves a merely lean host.

import { readFile } from "node:fs/promises";
import { freemem } from "node:os";

/**
 * Minimum genuinely-available host memory (bytes) required before launching the
 * memory-heavy candidate promoter `docker build`. 2 GiB of MemAvailable clears
 * buildkit's context-load + `apk add` layer comfortably; below it the sender is
 * at risk of the ENOMEM readdirent that produced SUR-BF75ED2A.
 */
export const DEFAULT_MIN_BUILD_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;

export type HostMemorySource = "meminfo" | "os-freemem" | "unmeasurable";

export type HostMemoryReading = {
  availableBytes: number | undefined;
  source: HostMemorySource;
};

/** Parse `MemAvailable` (kB) out of /proc/meminfo contents into bytes. */
export function parseMemAvailableBytes(meminfo: string): number | undefined {
  const match = /^MemAvailable:\s+(\d+)\s*kB/im.exec(meminfo);
  if (!match) return undefined;
  const kb = Number(match[1]);
  return Number.isFinite(kb) && kb >= 0 ? kb * 1024 : undefined;
}

/**
 * Read the host's genuinely-available memory. Prefers /proc/meminfo MemAvailable
 * (the real deployment target is Linux/WSL2); falls back to os.freemem() when
 * meminfo is unreadable (a non-Linux dev host), and reports "unmeasurable" when
 * neither yields a finite value.
 */
export async function readHostAvailableMemory(deps?: {
  readMeminfo?: () => Promise<string>;
  osFreeMemoryBytes?: () => number;
}): Promise<HostMemoryReading> {
  const readMeminfo = deps?.readMeminfo ?? (() => readFile("/proc/meminfo", "utf8"));
  try {
    const available = parseMemAvailableBytes(await readMeminfo());
    if (available !== undefined) return { availableBytes: available, source: "meminfo" };
  } catch {
    // /proc/meminfo not present/readable (non-Linux dev host) — fall through.
  }
  try {
    const free = (deps?.osFreeMemoryBytes ?? freemem)();
    if (typeof free === "number" && Number.isFinite(free) && free >= 0) {
      return { availableBytes: free, source: "os-freemem" };
    }
  } catch {
    // os.freemem() should never throw, but never let a probe wedge the upgrade.
  }
  return { availableBytes: undefined, source: "unmeasurable" };
}

export type HostMemoryHeadroom = {
  ok: boolean;
  availableBytes: number | undefined;
  requiredBytes: number;
  source: HostMemorySource;
};

/**
 * Decide whether the host has enough available memory to launch the candidate
 * promoter build. Fails OPEN when memory is unmeasurable: the guard is an
 * optimization to skip a doomed build, never a hard gate that could permanently
 * wedge upgrades on a host whose meminfo cannot be read. Only a CONFIRMED
 * below-floor reading defers.
 */
export async function checkHostMemoryHeadroom(params?: {
  requiredBytes?: number;
  deps?: Parameters<typeof readHostAvailableMemory>[0];
}): Promise<HostMemoryHeadroom> {
  const requiredBytes = params?.requiredBytes ?? DEFAULT_MIN_BUILD_MEMORY_BYTES;
  const { availableBytes, source } = await readHostAvailableMemory(params?.deps);
  const ok = availableBytes === undefined ? true : availableBytes >= requiredBytes;
  return { ok, availableBytes, requiredBytes, source };
}

/** Human-readable GiB, for run reasons / operator surfaces. */
export function formatGiB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GiB`;
}

export type HostMemoryGuardDecision =
  | { defer: false }
  | {
      defer: true;
      /** Persisted skip reason for the SelfUpgradeRun / operator surface. */
      reason: string;
      /** Structured fields echoed on the skip result. */
      extra: {
        availableBytes: number | undefined;
        requiredBytes: number;
        memorySource: HostMemorySource;
      };
    };

/**
 * The self-upgrade orchestrator's single call: should the candidate build be
 * deferred for host memory pressure? Keeps the reason/formatting here so the
 * orchestrator stays a thin `if (decision.defer)` at the call site.
 */
export async function evaluateHostMemoryGuard(params?: {
  requiredBytes?: number;
  deps?: Parameters<typeof readHostAvailableMemory>[0];
}): Promise<HostMemoryGuardDecision> {
  const headroom = await checkHostMemoryHeadroom(params);
  if (headroom.ok) return { defer: false };
  // availableBytes is defined whenever ok is false (an unmeasurable reading
  // fails OPEN in checkHostMemoryHeadroom, so it never reaches here).
  const available = formatGiB(headroom.availableBytes ?? 0);
  const required = formatGiB(headroom.requiredBytes);
  return {
    defer: true,
    reason:
      `host-memory-pressure: ${available} available < ${required} required for the ` +
      `candidate promoter build (source: ${headroom.source})`,
    extra: {
      availableBytes: headroom.availableBytes,
      requiredBytes: headroom.requiredBytes,
      memorySource: headroom.source,
    },
  };
}
