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

/** Parse `MemAvailable` (kB) out of /proc/meminfo contents into bytes. */
export function parseMemAvailableBytes(meminfo) {
  if (typeof meminfo !== "string") return undefined;
  const match = /^MemAvailable:\s+(\d+)\s*kB/im.exec(meminfo);
  if (!match) return undefined;
  const kb = Number(match[1]);
  return Number.isFinite(kb) ? kb * 1024 : undefined;
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
