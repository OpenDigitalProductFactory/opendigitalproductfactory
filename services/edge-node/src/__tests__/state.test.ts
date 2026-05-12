import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearState,
  loadState,
  saveState,
  statePath,
  type EdgeNodeState,
} from "../state";

/**
 * Read-time permission checks (mode 0600 + owner UID) only fire on
 * POSIX hosts. CI runs on Linux so these tests are meaningful in CI;
 * skip the perm-check assertions on Windows-host dev machines so
 * local `pnpm test` still works during development.
 */
const isPosix = os.platform() !== "win32";
const posixIt = isPosix ? it : it.skip;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dpf-edge-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sampleState: EdgeNodeState = {
  nodeId: "edge_a1b2c3",
  nodeToken: "dpfedge_TESTTOKEN",
  enrolledAt: "2026-05-12T12:00:00.000Z",
  heartbeatIntervalSec: 60,
  sweepIntervalSec: 300,
  acceptedCapabilities: ["discovery.network"],
  trustState: "trusted",
};

describe("loadState", () => {
  it("returns null when no state file exists", async () => {
    const result = await loadState(dir);
    expect(result).toBeNull();
  });

  it("round-trips a saved state", async () => {
    await saveState(dir, sampleState);
    const result = await loadState(dir);
    expect(result).toEqual(sampleState);
  });

  it("throws on corrupted JSON", async () => {
    await fs.writeFile(statePath(dir), "{ this is not valid json", {
      mode: 0o600,
    });
    await expect(loadState(dir)).rejects.toThrow(/corrupt/);
  });

  it("throws on missing required fields", async () => {
    await fs.writeFile(
      statePath(dir),
      JSON.stringify({ nodeId: "edge_x" }),
      { mode: 0o600 },
    );
    await expect(loadState(dir)).rejects.toThrow(/missing required fields/);
  });
});

describe("saveState", () => {
  posixIt("writes the file with 0600 perms (POSIX only)", async () => {
    // Windows doesn't honor `mode: 0o600` the way POSIX does; the
    // stat will report 0666 there. The check is only meaningful on
    // Linux (CI) and macOS (Mode 2 host). Skip elsewhere.
    await saveState(dir, sampleState);
    const stat = await fs.stat(statePath(dir));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("creates the state dir if missing", async () => {
    const nested = join(dir, "nested", "deep");
    await saveState(nested, sampleState);
    const result = await loadState(nested);
    expect(result).toEqual(sampleState);
  });

  it("rejects writing an invalid state shape", async () => {
    // heartbeatIntervalSec=-1 violates the positive() Zod constraint;
    // saveState validates before writing so this throws synchronously
    // from the schema parse rather than reaching the disk.
    const bad = { ...sampleState, heartbeatIntervalSec: -1 } as EdgeNodeState;
    await expect(saveState(dir, bad)).rejects.toThrow();
  });

  it("atomic-writes — old state survives a corrupt-during-write attempt", async () => {
    await saveState(dir, sampleState);

    // The implementation uses tmp + rename. This test asserts that
    // the mid-write tmp file doesn't pollute the loadState path. We
    // can't easily simulate a crash, but we can verify there's no
    // leftover tmp file after a normal write.
    await saveState(dir, { ...sampleState, trustState: "trusted" });
    const entries = await fs.readdir(dir);
    expect(entries.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("clearState", () => {
  it("removes the state file", async () => {
    await saveState(dir, sampleState);
    await clearState(dir);
    expect(await loadState(dir)).toBeNull();
  });

  it("is a no-op when no state exists", async () => {
    await expect(clearState(dir)).resolves.toBeUndefined();
  });
});

describe("loadState — read-time permission enforcement (POSIX only)", () => {
  posixIt("refuses to load a state file with mode 0644 (world-readable)", async () => {
    await saveState(dir, sampleState);
    // Loosen the perms to simulate an operator misconfiguration
    // (e.g. backup tool snapshot, manual chmod, host bind-mount drift).
    await fs.chmod(statePath(dir), 0o644);
    await expect(loadState(dir)).rejects.toThrow(
      /unsafe permissions.*expected mode 0600.*got 0644/,
    );
  });

  posixIt("refuses to load a state file with mode 0666", async () => {
    await saveState(dir, sampleState);
    await fs.chmod(statePath(dir), 0o666);
    await expect(loadState(dir)).rejects.toThrow(/unsafe permissions/);
  });

  posixIt("refuses to load a state file with mode 0400 (read-only but still wrong)", async () => {
    // Read-only is the OTHER direction of mode mismatch — saveState
    // requires write-then-chmod, but if an operator dropped a 0400
    // file by hand (or restored from a backup with that mode), we
    // refuse rather than guess at intent.
    await saveState(dir, sampleState);
    await fs.chmod(statePath(dir), 0o400);
    await expect(loadState(dir)).rejects.toThrow(/unsafe permissions/);
  });

  posixIt("accepts the 0600 perms saveState writes", async () => {
    // Round-trip through saveState then loadState — saveState already
    // sets 0600, so this is the happy path. The earlier round-trip
    // test covered behavior; this one specifically asserts the perms
    // check passes for the canonical write path.
    await saveState(dir, sampleState);
    const stat = await fs.stat(statePath(dir));
    expect(stat.mode & 0o777).toBe(0o600);
    const loaded = await loadState(dir);
    expect(loaded).toEqual(sampleState);
  });

  // Owner-mismatch test: we can't easily switch process UIDs inside
  // a Vitest test (would need root + setuid), so the owner check is
  // covered by code review + the integration-test runbook entry
  // rather than a runtime test here. The mode check above is the
  // most common real-world drift case and is fully covered.
});
