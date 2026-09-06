import { strict as assert } from "node:assert";
import test from "node:test";

import {
  availableMemoryBytes,
  parseMemAvailableBytes,
  parseVmStatAvailableBytes,
  readAvailableMemory,
} from "./host-available-memory.mjs";

// A trimmed real `vm_stat` header plus the buckets we read. Page size 16384 is
// Apple silicon; the parser must take it from the text, never assume 4096.
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               90224.
Pages active:                           1210544.
Pages inactive:                         1100000.
Pages speculative:                        50000.
Pages throttled:                              0.
Pages wired down:                        600000.
Pages purgeable:                          40000.
`;

test("counts every reclaimable bucket, not just free pages", () => {
  const bytes = parseVmStatAvailableBytes(VM_STAT);
  assert.equal(bytes, (90224 + 1100000 + 50000 + 40000) * 16384);
});

test("the reclaimable reading dwarfs the free pool it replaces", () => {
  // The whole point of BI-EB6DBAF0: free pages alone read ~1.4 GiB here while
  // ~19 GiB is genuinely available, which is what tripped the 4 GiB fence.
  const freeOnly = 90224 * 16384;
  const available = parseVmStatAvailableBytes(VM_STAT);
  assert.ok(freeOnly < 4 * 1024 ** 3, "fixture should trip the 4 GiB floor on free pages");
  assert.ok(available > 4 * 1024 ** 3, "and clear it on reclaimable pages");
});

test("takes the page size from the text rather than assuming one", () => {
  const fourK = VM_STAT.replace("page size of 16384 bytes", "page size of 4096 bytes");
  assert.equal(
    parseVmStatAvailableBytes(fourK),
    (90224 + 1100000 + 50000 + 40000) * 4096,
  );
});

test("refuses a reading with no page size", () => {
  assert.equal(parseVmStatAvailableBytes("Pages free: 100.\n"), undefined);
});

test("refuses a reading that found only the free bucket", () => {
  // Falling through to os.freemem() is honest; reporting free-pages-only under
  // the name "available" is the bug this module exists to remove.
  const onlyFree = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               90224.
`;
  assert.equal(parseVmStatAvailableBytes(onlyFree), undefined);
});

test("refuses non-string and empty input", () => {
  assert.equal(parseVmStatAvailableBytes(undefined), undefined);
  assert.equal(parseVmStatAvailableBytes(""), undefined);
});

test("prefers MemAvailable over MemFree on linux", () => {
  const meminfo = "MemTotal:  65536000 kB\nMemFree:  1048576 kB\nMemAvailable: 41943040 kB\n";
  assert.equal(parseMemAvailableBytes(meminfo), 41943040 * 1024);
});

test("refuses meminfo with no MemAvailable line", () => {
  assert.equal(parseMemAvailableBytes("MemTotal: 100 kB\nMemFree: 50 kB\n"), undefined);
});

test("darwin reads vm_stat", () => {
  const result = readAvailableMemory({
    platform: "darwin",
    readVmStat: () => VM_STAT,
    osFreeMemoryBytes: () => 1,
  });
  assert.equal(result.source, "vm_stat");
  assert.equal(result.availableBytes, (90224 + 1100000 + 50000 + 40000) * 16384);
});

test("linux reads meminfo", () => {
  const result = readAvailableMemory({
    platform: "linux",
    readMeminfo: () => "MemAvailable: 2048 kB\n",
    osFreeMemoryBytes: () => 1,
  });
  assert.equal(result.source, "meminfo");
  assert.equal(result.availableBytes, 2048 * 1024);
});

test("a wedged probe falls back rather than throwing", () => {
  const result = readAvailableMemory({
    platform: "darwin",
    readVmStat: () => {
      throw new Error("vm_stat missing");
    },
    osFreeMemoryBytes: () => 7 * 1024 ** 3,
  });
  assert.equal(result.source, "os-freemem");
  assert.equal(result.availableBytes, 7 * 1024 ** 3);
});

test("an unparseable probe falls back rather than reporting zero", () => {
  const result = readAvailableMemory({
    platform: "darwin",
    readVmStat: () => "not vm_stat output",
    osFreeMemoryBytes: () => 3 * 1024 ** 3,
  });
  assert.equal(result.source, "os-freemem");
  assert.equal(result.availableBytes, 3 * 1024 ** 3);
});

test("reports unmeasurable when even the fallback fails", () => {
  const result = readAvailableMemory({
    platform: "sunos",
    osFreeMemoryBytes: () => {
      throw new Error("no");
    },
  });
  assert.equal(result.source, "unmeasurable");
  assert.equal(result.availableBytes, undefined);
});

test("an unknown platform goes straight to the fallback", () => {
  const result = readAvailableMemory({
    platform: "win32",
    readVmStat: () => VM_STAT,
    osFreeMemoryBytes: () => 5 * 1024 ** 3,
  });
  assert.equal(result.source, "os-freemem");
});

test("availableMemoryBytes returns bytes only", () => {
  assert.equal(
    availableMemoryBytes({ platform: "linux", readMeminfo: () => "MemAvailable: 1024 kB\n" }),
    1024 * 1024,
  );
});
