import test from "node:test";
import assert from "node:assert";
import { checkHostDiskSpace } from "./disk-space-preflight.mjs";

test("checkHostDiskSpace allows build when free space is above floor on Windows", () => {
  const spawnSyncImpl = (cmd, args) => {
    assert.strictEqual(cmd, "powershell");
    // Should default to G:
    if (args.join(" ").includes("Get-PSDrive G")) {
      return { status: 0, stdout: "25.5\n", error: null };
    }
    return { status: 1, error: new Error("not found") };
  };

  const result = checkHostDiskSpace({
    floorGb: 20,
    platform: "win32",
    spawnSyncImpl,
  });

  assert.strictEqual(result.ok, true);
});

test("checkHostDiskSpace blocks build when free space is below floor on Windows", () => {
  const spawnSyncImpl = (cmd, args) => {
    assert.strictEqual(cmd, "powershell");
    if (args.join(" ").includes("Get-PSDrive G")) {
      return { status: 0, stdout: "5.2\n", error: null };
    }
    return { status: 1 };
  };

  const result = checkHostDiskSpace({
    floorGb: 20,
    platform: "win32",
    spawnSyncImpl,
  });

  assert.strictEqual(result.ok, false);
  assert.match(result.message, /Build blocked: host disk G: has only 5.2gb free \(minimum 20GB required\)./);
});

test("checkHostDiskSpace falls back to C: if G: is not found on Windows", () => {
  let cDriveChecked = false;
  const spawnSyncImpl = (cmd, args) => {
    if (args.join(" ").includes("Get-PSDrive G")) {
      return { status: 1, error: new Error("Drive G does not exist") };
    }
    if (args.join(" ").includes("Get-PSDrive C")) {
      cDriveChecked = true;
      return { status: 0, stdout: "10.0\n", error: null };
    }
    return { status: 1 };
  };

  const result = checkHostDiskSpace({
    floorGb: 20,
    platform: "win32",
    spawnSyncImpl,
  });

  assert.strictEqual(cDriveChecked, true);
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /Build blocked: host disk C: has only 10gb free \(minimum 20GB required\)./);
});

test("checkHostDiskSpace allows build when free space is above floor on Linux", () => {
  const spawnSyncImpl = (cmd, args) => {
    assert.strictEqual(cmd, "df");
    // df -k output mock
    return { status: 0, stdout: "Filesystem     1K-blocks     Used Available Use% Mounted on\n/dev/sda1      104857600 52428800  25165824  50% /\n", error: null }; // 24 GB available
  };

  const result = checkHostDiskSpace({
    floorGb: 20,
    platform: "linux",
    spawnSyncImpl,
  });

  assert.strictEqual(result.ok, true);
});

test("checkHostDiskSpace blocks build when free space is below floor on Linux", () => {
  const spawnSyncImpl = (cmd, args) => {
    assert.strictEqual(cmd, "df");
    return { status: 0, stdout: "Filesystem     1K-blocks     Used Available Use% Mounted on\n/dev/sda1      104857600 52428800  10485760  50% /\n", error: null }; // 10 GB available
  };

  const result = checkHostDiskSpace({
    floorGb: 20,
    platform: "linux",
    spawnSyncImpl,
  });

  assert.strictEqual(result.ok, false);
  assert.match(result.message, /Build blocked: host disk \/ has only 10gb free \(minimum 20GB required\)./);
});

test("checkHostDiskSpace succeeds gracefully if disk query fails entirely on Windows", () => {
  const spawnSyncImpl = (cmd, args) => {
    return { status: 1, error: new Error("command failed") };
  };

  const result = checkHostDiskSpace({
    floorGb: 20,
    platform: "win32",
    spawnSyncImpl,
  });

  assert.strictEqual(result.ok, true);
});
