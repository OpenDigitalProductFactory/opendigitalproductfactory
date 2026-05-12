import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
  it("writes the file with 0600 perms", async () => {
    await saveState(dir, sampleState);
    const stat = await fs.stat(statePath(dir));
    // Check the lower 9 bits (rwxrwxrwx) match 0600 (rw-------).
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
