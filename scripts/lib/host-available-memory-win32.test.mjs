import { strict as assert } from "node:assert";
import test from "node:test";

import {
  parseMemAvailableBytes,
  parseMemFreeBytes,
  parseWslReclaimableBytes,
  readAvailableMemory,
} from "./host-available-memory.mjs";

// win32 + Docker Desktop on WSL2 (BI-E129F788). The guest page cache balloons
// vmmemWSL during an image export and Windows counts it as used. Measured on
// the 64 GiB dev host at "sending tarball": host free ~3 GiB, guest
// MemAvailable ~20 GiB with MemFree ~2 GiB — and the gate killed a green run.
const WSL_MEMINFO = `MemTotal:       24449708 kB
MemFree:         2097152 kB
MemAvailable:   20971520 kB
Buffers:          524288 kB
Cached:         17825792 kB
SReclaimable:     524288 kB
`;

test("parses MemFree alongside MemAvailable", () => {
  assert.equal(parseMemFreeBytes(WSL_MEMINFO), 2097152 * 1024);
  assert.equal(parseMemAvailableBytes(WSL_MEMINFO), 20971520 * 1024);
});

test("guest reclaimable is MemAvailable minus MemFree, never negative", () => {
  assert.equal(parseWslReclaimableBytes(WSL_MEMINFO), (20971520 - 2097152) * 1024);
  assert.equal(parseWslReclaimableBytes("MemFree: 100 kB\nMemAvailable: 50 kB\n"), 0);
  assert.equal(parseWslReclaimableBytes("MemFree: 100 kB\n"), undefined);
  assert.equal(parseWslReclaimableBytes(undefined), undefined);
});

test("win32 adds the WSL guest reclaimable cache to the host free figure", () => {
  const hostFree = 3 * 1024 ** 3;
  const result = readAvailableMemory({
    platform: "win32",
    osFreeMemoryBytes: () => hostFree,
    readWslMeminfo: () => WSL_MEMINFO,
  });
  assert.equal(result.source, "os-freemem+wsl-reclaimable");
  assert.equal(result.availableBytes, hostFree + (20971520 - 2097152) * 1024);
  // The whole point: free alone trips the 4 GiB floor, reclaimable clears it.
  assert.ok(hostFree < 4 * 1024 ** 3, "fixture should trip the floor on host free");
  assert.ok(result.availableBytes > 4 * 1024 ** 3, "and clear it with the guest cache");
});

test("win32 without a docker-desktop distro falls back to os.freemem", () => {
  const result = readAvailableMemory({
    platform: "win32",
    osFreeMemoryBytes: () => 7 * 1024 ** 3,
    readWslMeminfo: () => {
      throw new Error("wsl.exe: distro not found");
    },
  });
  assert.equal(result.source, "os-freemem");
  assert.equal(result.availableBytes, 7 * 1024 ** 3);
});

test("win32 ignores wsl output that is not meminfo", () => {
  const result = readAvailableMemory({
    platform: "win32",
    osFreeMemoryBytes: () => 7 * 1024 ** 3,
    readWslMeminfo: () => "The Windows Subsystem for Linux is not installed.",
  });
  assert.equal(result.source, "os-freemem");
});

test("non-win32 platforms never consult wsl", () => {
  let consulted = false;
  const result = readAvailableMemory({
    platform: "linux",
    readMeminfo: () => "MemAvailable: 1024 kB\n",
    readWslMeminfo: () => {
      consulted = true;
      return WSL_MEMINFO;
    },
  });
  assert.equal(consulted, false);
  assert.equal(result.source, "meminfo");
});
