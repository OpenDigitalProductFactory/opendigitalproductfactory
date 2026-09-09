import assert from "node:assert/strict";
import test from "node:test";

import {
  checkHostDiskSpace,
  decideDiskFloor,
  measureDaemonFilesystem,
  measureHostBackingVolume,
  parseDfLine,
  resolveDataDiskPath,
} from "./disk-space-preflight.mjs";

const dfRow = (availableKb) => `overlay 1055762868 199495212 ${availableKb} 20% /\n`;
const ok = (stdout) => ({ status: 0, stdout });
const fail = () => ({ status: 1, stdout: "", error: new Error("nope") });

/** Route by argv so a test can answer the daemon probe and the host volume differently. */
function fakeSpawn({ daemon, host }) {
  return (command, args) => {
    if (command === "docker") return daemon ?? fail();
    if (command === "powershell" || command === "df") return host ?? fail();
    return fail();
  };
}

test("gates on the SMALLER of the daemon filesystem and its backing host volume", () => {
  // The install that found this: Docker reported 765GB inside a ~1TB virtual
  // disk while the volume holding that disk file had 77GB. The disk grows into
  // host space on demand, so 77GB is the real headroom.
  const result = decideDiskFloor({
    measurements: [
      { label: "Docker storage", freeGb: 765.4 },
      { label: "host volume C:", freeGb: 12 },
    ],
    floorGb: 20,
  });
  assert.equal(result.ok, false);
  assert.equal(result.binding.label, "host volume C:");
  assert.match(result.message, /host volume C: has only 12GB free \(minimum 20GB\)/);
  // Both readings are reported, so an operator can see what bound the decision.
  assert.match(result.message, /Docker storage 765.4GB free/);
});

test("a roomy daemon filesystem does not excuse a full host volume", () => {
  const result = decideDiskFloor({
    measurements: [
      { label: "Docker storage", freeGb: 900 },
      { label: "host volume C:", freeGb: 0.5 },
    ],
    floorGb: 20,
  });
  assert.equal(result.ok, false);
});

test("passes when every measurement clears the floor", () => {
  const result = decideDiskFloor({
    measurements: [
      { label: "Docker storage", freeGb: 765 },
      { label: "host volume C:", freeGb: 300 },
    ],
    floorGb: 20,
  });
  assert.equal(result.ok, true);
  assert.equal(result.binding.freeGb, 300);
});

test("an unmeasurable host warns instead of reading as free space", () => {
  // The original guard's failure mode: it could not measure the right disk and
  // returned a clean pass, so it looked like protection while protecting nothing.
  const result = decideDiskFloor({
    measurements: [{ error: "daemon filesystem probe did not run" }, null],
    floorGb: 20,
  });
  assert.equal(result.ok, true, "infrastructure trouble must not block the build");
  assert.match(result.warning, /UNVERIFIED/);
  assert.match(result.warning, /daemon filesystem probe did not run/);
  assert.deepEqual(result.measurements, []);
});

test("one readable measurement still gates even when the other cannot be read", () => {
  const result = decideDiskFloor({
    measurements: [{ label: "Docker storage", freeGb: 3 }, { error: "host volume C: could not be read" }],
    floorGb: 20,
  });
  assert.equal(result.ok, false);
  assert.equal(result.binding.label, "Docker storage");
});

test("the daemon probe reads free space from a container's own root filesystem", () => {
  const calls = [];
  const spawnSyncImpl = (command, args) => {
    calls.push([command, ...args]);
    return ok(dfRow(802564184));
  };
  const measured = measureDaemonFilesystem({ spawnSyncImpl, probeImage: "alpine" });
  assert.equal(measured.label, "Docker storage");
  assert.equal(measured.freeGb, 765.38);
  // It asks the daemon rather than resolving a host path.
  assert.deepEqual(calls[0], ["docker", "run", "--rm", "alpine", "sh", "-c", "df -P / | tail -1"]);
});

test("a daemon that will not answer is an error, not a zero and not a pass", () => {
  const measured = measureDaemonFilesystem({ spawnSyncImpl: fakeSpawn({}) });
  assert.ok(measured.error);
  assert.equal(measured.freeGb, undefined);
});

test("NO drive letter is hardcoded: the Windows volume comes from the data disk path", () => {
  // The whole defect. Installs put Docker's data wherever the operator chose,
  // so the drive has to be derived from where the disk file actually is.
  const calls = [];
  const result = measureHostBackingVolume({
    platform: "win32",
    env: { LOCALAPPDATA: "E:\\AppData\\Local" },
    existsSyncImpl: (p) => p === "E:\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx",
    spawnSyncImpl: (command, args) => {
      calls.push(args.join(" "));
      return ok("77.5\n");
    },
  });
  assert.equal(result.label, "host volume E:");
  assert.equal(result.freeGb, 77.5);
  assert.match(calls[0], /Get-PSDrive E/);
  assert.ok(!calls.some((c) => /Get-PSDrive G/.test(c)), "must not fall back to a guessed drive");
});

test("no data disk file means the daemon writes to the host directly; nothing further to measure", () => {
  const result = measureHostBackingVolume({
    platform: "linux",
    env: {},
    existsSyncImpl: () => false,
    spawnSyncImpl: fakeSpawn({}),
  });
  assert.equal(result, null);
});

test("an explicit data disk override wins, and a missing override is not silently replaced", () => {
  assert.equal(
    resolveDataDiskPath({ platform: "win32", env: { DPF_DOCKER_DATA_DISK: "X:\\docker.vhdx" }, existsSyncImpl: () => true }),
    "X:\\docker.vhdx",
  );
  assert.equal(
    resolveDataDiskPath({
      platform: "win32",
      env: { DPF_DOCKER_DATA_DISK: "X:\\gone.vhdx", LOCALAPPDATA: "C:\\AppData" },
      existsSyncImpl: (p) => p !== "X:\\gone.vhdx",
    }),
    null,
    "a stated location that is absent must report unresolved, not fall through to a guess",
  );
});

test("macOS resolves the Docker Desktop raw disk and measures its volume with df", () => {
  const result = measureHostBackingVolume({
    platform: "darwin",
    env: { HOME: "/Users/dev" },
    existsSyncImpl: (p) => p === "/Users/dev/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw",
    spawnSyncImpl: (command) => (command === "df" ? ok(dfRow(41943040)) : fail()),
  });
  assert.equal(result.freeGb, 40);
  assert.match(result.label, /Docker.raw/);
});

test("parseDfLine reads the Available column and rejects junk", () => {
  assert.equal(parseDfLine(dfRow(20971520), "x").freeGb, 20);
  assert.ok(parseDfLine("", "x").error);
  assert.ok(parseDfLine("garbage line here now", "x").error);
});

test("checkHostDiskSpace blocks on the real ceiling end to end", () => {
  const result = checkHostDiskSpace({
    floorGb: 20,
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\AppData\\Local" },
    existsSyncImpl: (p) => p.endsWith("docker_data.vhdx"),
    spawnSyncImpl: fakeSpawn({ daemon: ok(dfRow(802564184)), host: ok("5\n") }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /host volume C: has only 5GB free/);
});

test("checkHostDiskSpace passes when the tighter of the two clears the floor", () => {
  const result = checkHostDiskSpace({
    floorGb: 20,
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\AppData\\Local" },
    existsSyncImpl: (p) => p.endsWith("docker_data.vhdx"),
    spawnSyncImpl: fakeSpawn({ daemon: ok(dfRow(802564184)), host: ok("300\n") }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.binding.freeGb, 300);
});
