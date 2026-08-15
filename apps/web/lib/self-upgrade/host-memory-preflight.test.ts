import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_BUILD_MEMORY_BYTES,
  checkHostMemoryHeadroom,
  formatGiB,
  parseMemAvailableBytes,
  readHostAvailableMemory,
} from "./host-memory-preflight";

const GiB = 1024 * 1024 * 1024;

// A realistic /proc/meminfo where MemFree is tiny (page cache) but MemAvailable
// is large — the exact Linux shape that makes MemFree a useless build-headroom
// signal. Gating on MemFree here would defer a perfectly healthy host.
function meminfo({ memFreeKb, memAvailableKb }: { memFreeKb: number; memAvailableKb: number }): string {
  return [
    "MemTotal:       24610000 kB",
    `MemFree:        ${memFreeKb} kB`,
    "Buffers:          123456 kB",
    `MemAvailable:   ${memAvailableKb} kB`,
    "SwapTotal:       6291456 kB",
  ].join("\n");
}

describe("parseMemAvailableBytes", () => {
  it("extracts MemAvailable in bytes, not MemFree", () => {
    const bytes = parseMemAvailableBytes(meminfo({ memFreeKb: 226392, memAvailableKb: 16154028 }));
    expect(bytes).toBe(16154028 * 1024);
  });

  it("returns undefined when MemAvailable is absent (very old kernels)", () => {
    expect(parseMemAvailableBytes("MemTotal: 100 kB\nMemFree: 50 kB")).toBeUndefined();
  });
});

describe("readHostAvailableMemory", () => {
  it("prefers /proc/meminfo MemAvailable over os.freemem()", async () => {
    const reading = await readHostAvailableMemory({
      readMeminfo: async () => meminfo({ memFreeKb: 200000, memAvailableKb: 16000000 }),
      osFreeMemoryBytes: () => 999 * GiB, // must be ignored
    });
    expect(reading.source).toBe("meminfo");
    expect(reading.availableBytes).toBe(16000000 * 1024);
  });

  it("falls back to os.freemem() when meminfo is unreadable (non-Linux dev host)", async () => {
    const reading = await readHostAvailableMemory({
      readMeminfo: async () => {
        throw new Error("ENOENT");
      },
      osFreeMemoryBytes: () => 8 * GiB,
    });
    expect(reading.source).toBe("os-freemem");
    expect(reading.availableBytes).toBe(8 * GiB);
  });

  it("reports unmeasurable when neither source yields a finite value", async () => {
    const reading = await readHostAvailableMemory({
      readMeminfo: async () => "garbage with no MemAvailable line",
      osFreeMemoryBytes: () => Number.NaN,
    });
    expect(reading.source).toBe("unmeasurable");
    expect(reading.availableBytes).toBeUndefined();
  });
});

describe("checkHostMemoryHeadroom", () => {
  it("passes when MemAvailable clears the floor even though MemFree is tiny (the SUR-BF75ED2A steady state)", async () => {
    const headroom = await checkHostMemoryHeadroom({
      deps: { readMeminfo: async () => meminfo({ memFreeKb: 226392, memAvailableKb: 16154028 }) },
    });
    expect(headroom.ok).toBe(true);
    expect(headroom.source).toBe("meminfo");
  });

  it("defers when MemAvailable is below the floor (the thrashing state that OOMs the build)", async () => {
    const headroom = await checkHostMemoryHeadroom({
      deps: { readMeminfo: async () => meminfo({ memFreeKb: 15000, memAvailableKb: 400000 }) },
    });
    expect(headroom.ok).toBe(false);
    expect(headroom.availableBytes).toBe(400000 * 1024);
    expect(headroom.requiredBytes).toBe(DEFAULT_MIN_BUILD_MEMORY_BYTES);
  });

  it("respects a custom required floor", async () => {
    const headroom = await checkHostMemoryHeadroom({
      requiredBytes: 1 * GiB,
      deps: { readMeminfo: async () => meminfo({ memFreeKb: 15000, memAvailableKb: 1_500_000 }) },
    });
    expect(headroom.ok).toBe(true); // 1.43 GiB available >= 1 GiB required
  });

  it("fails OPEN when memory is unmeasurable — never wedges upgrades on an unreadable host", async () => {
    const headroom = await checkHostMemoryHeadroom({
      deps: {
        readMeminfo: async () => {
          throw new Error("ENOENT");
        },
        osFreeMemoryBytes: () => Number.NaN,
      },
    });
    expect(headroom.ok).toBe(true);
    expect(headroom.source).toBe("unmeasurable");
    expect(headroom.availableBytes).toBeUndefined();
  });
});

describe("formatGiB", () => {
  it("renders bytes as two-decimal GiB", () => {
    expect(formatGiB(2 * GiB)).toBe("2.00GiB");
    expect(formatGiB(400000 * 1024)).toBe("0.38GiB");
  });
});
