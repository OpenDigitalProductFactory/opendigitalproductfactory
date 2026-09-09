// What "available memory" means to the local-CI gate.
//
// THE FAILURE THIS FIXES (BI-EB6DBAF0)
//
// The gate fenced its own run. `local-ci-pool-policy` revokes an admitted lease
// when `availableMemoryBytes` falls under a 4 GiB floor, and that number came
// from `os.freemem()`. On Darwin `freemem()` reports only the FREE page pool —
// it excludes inactive, speculative and purgeable pages, all of which the
// kernel hands back on demand. macOS deliberately keeps the free pool small and
// parks everything else in those reclaimable buckets.
//
// So `next build`, running under a 16 GiB heap the gate itself granted, drove
// the free pool under 4 GiB while tens of GiB stayed reclaimable. The watchdog
// read "host-memory-low" and killed the build it had just admitted. Measured on
// a 128 GiB host: freemem() 24.4 GiB against 49.6 GiB genuinely available.
//
// Linux has the same blind spot in smaller form — `os.freemem()` is MemFree,
// which excludes the page cache; MemAvailable is the kernel's own estimate of
// what a new allocation can actually get.
//
// Windows with Docker Desktop on WSL2 has it in a third form (BI-E129F788):
// the guest page cache balloons `vmmemWSL` during large writes (an image
// export, a tarball send) and Windows counts that balloon as USED, so
// `os.freemem()` collapses while the guest reports the same bytes as
// reclaimable. A green run was killed at "sending tarball" on a 64 GiB host
// with ~20 GiB genuinely reclaimable. The win32 probe therefore adds the
// guest's reclaimable cache (MemAvailable - MemFree from the docker-desktop
// distro) back on top of the host free figure.
//
// Every probe is injectable so tests never touch host state (the rule from
// BI-95A83B47's ambient-host-state guard, and BI-EFA383AA before it).

import { freemem } from "node:os";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Page-bucket names on Darwin that are reclaimable under memory pressure. */
const DARWIN_RECLAIMABLE = [
  "Pages free",
  "Pages inactive",
  "Pages speculative",
  "Pages purgeable",
];

/**
 * Parse `vm_stat` output into available bytes.
 *
 * Exported for tests: the parser is pure, so the Darwin path is covered without
 * a Darwin host.
 */
export function parseVmStatAvailableBytes(vmStat) {
  if (typeof vmStat !== "string" || vmStat.length === 0) return undefined;
  const pageSize = /page size of (\d+) bytes/.exec(vmStat);
  if (!pageSize) return undefined;
  const bytesPerPage = Number(pageSize[1]);
  if (!Number.isFinite(bytesPerPage) || bytesPerPage <= 0) return undefined;

  let pages = 0;
  let matched = 0;
  for (const bucket of DARWIN_RECLAIMABLE) {
    // `vm_stat` prints "Pages free:   123456." — trailing period, no separators.
    const found = new RegExp(`^${bucket}:\\s+(\\d+)\\.`, "m").exec(vmStat);
    if (!found) continue;
    pages += Number(found[1]);
    matched += 1;
  }
  // "Pages free" alone is what we are trying to get away from; require at least
  // one reclaimable bucket beyond it before trusting the reading.
  if (matched < 2) return undefined;
  return pages * bytesPerPage;
}

function parseMeminfoField(meminfo, field) {
  if (typeof meminfo !== "string") return undefined;
  const match = new RegExp(`^${field}:\\s+(\\d+)\\s*kB`, "im").exec(meminfo);
  if (!match) return undefined;
  const kb = Number(match[1]);
  return Number.isFinite(kb) ? kb * 1024 : undefined;
}

/** Parse `MemAvailable` (kB) out of /proc/meminfo contents into bytes. */
export function parseMemAvailableBytes(meminfo) {
  return parseMeminfoField(meminfo, "MemAvailable");
}

/** Parse `MemFree` (kB) out of /proc/meminfo contents into bytes. */
export function parseMemFreeBytes(meminfo) {
  return parseMeminfoField(meminfo, "MemFree");
}

/**
 * Bytes a WSL2 guest could hand back to Windows on demand: the kernel's own
 * MemAvailable estimate minus the pages that are already free. This is the
 * part of `vmmemWSL` that Windows reports as used but that is really cache.
 */
export function parseWslReclaimableBytes(meminfo) {
  const available = parseMemAvailableBytes(meminfo);
  const free = parseMemFreeBytes(meminfo);
  if (available === undefined || free === undefined) return undefined;
  return Math.max(0, available - free);
}

/** Docker Desktop's WSL2 distro; absent when the engine uses Hyper-V or is not installed. */
const DOCKER_DESKTOP_WSL_DISTRO = "docker-desktop";

function readDockerDesktopMeminfo() {
  return execFileSync(
    "wsl.exe",
    ["-d", DOCKER_DESKTOP_WSL_DISTRO, "-e", "cat", "/proc/meminfo"],
    { encoding: "utf8", timeout: 5_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
  );
}

function attempt(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * The host's genuinely-available memory in bytes, with the source that produced
 * it. Never throws: a wedged probe must not wedge the gate, so the last resort
 * is `os.freemem()` — the value this module exists to stop trusting alone, but
 * still better than refusing to measure.
 */
export function readAvailableMemory(deps = {}) {
  const platform = deps.platform ?? process.platform;

  if (platform === "darwin") {
    const vmStat = attempt(
      deps.readVmStat
        ?? (() => execFileSync("vm_stat", { encoding: "utf8", timeout: 5_000 })),
    );
    const bytes = parseVmStatAvailableBytes(vmStat);
    if (Number.isFinite(bytes) && bytes > 0) {
      return { availableBytes: bytes, source: "vm_stat" };
    }
  }

  if (platform === "linux") {
    const meminfo = attempt(
      deps.readMeminfo
        ?? (() => readFileSync("/proc/meminfo", "utf8")),
    );
    const bytes = parseMemAvailableBytes(meminfo);
    if (Number.isFinite(bytes) && bytes > 0) {
      return { availableBytes: bytes, source: "meminfo" };
    }
  }

  if (platform === "win32") {
    const free = attempt(deps.osFreeMemoryBytes ?? freemem);
    const meminfo = attempt(deps.readWslMeminfo ?? readDockerDesktopMeminfo);
    const reclaimable = parseWslReclaimableBytes(meminfo);
    if (Number.isFinite(free) && Number.isFinite(reclaimable)) {
      return { availableBytes: free + reclaimable, source: "os-freemem+wsl-reclaimable" };
    }
  }

  const free = attempt(deps.osFreeMemoryBytes ?? freemem);
  if (Number.isFinite(free)) {
    return { availableBytes: free, source: "os-freemem" };
  }
  return { availableBytes: undefined, source: "unmeasurable" };
}

/** Bytes only, for call sites that already have their own failure handling. */
export function availableMemoryBytes(deps = {}) {
  return readAvailableMemory(deps).availableBytes;
}
