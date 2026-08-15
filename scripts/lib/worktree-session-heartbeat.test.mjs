import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HEARTBEAT_FILENAME,
  DEFAULT_TTL_MS,
  heartbeatPath,
  heartbeatTtlMs,
  parseHeartbeat,
  isHeartbeatLive,
  readHeartbeat,
  isWorktreeSessionLive,
  writeHeartbeat,
  removeHeartbeat,
} from "./worktree-session-heartbeat.mjs";

/** Minimal in-memory fs stub matching the subset the lib uses. */
function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      return files.get(p);
    },
    writeFileSync: (p, data) => files.set(p, data),
    rmSync: (p) => files.delete(p),
  };
}

describe("heartbeat path + ttl", () => {
  it("marker filename is the gitignored session heartbeat", () => {
    assert.equal(HEARTBEAT_FILENAME, ".dpf-session-heartbeat.json");
    // path.join uses the platform separator; compare separator-agnostically.
    assert.equal(
      heartbeatPath("D:/DPF-worktrees/topic").replace(/\\/g, "/"),
      "D:/DPF-worktrees/topic/.dpf-session-heartbeat.json",
    );
  });

  it("ttl honors the env override, else the default", () => {
    assert.equal(heartbeatTtlMs({}), DEFAULT_TTL_MS);
    assert.equal(heartbeatTtlMs({ DPF_WORKTREE_SESSION_HEARTBEAT_TTL_MIN: "30" }), 30 * 60_000);
    assert.equal(heartbeatTtlMs({ DPF_WORKTREE_SESSION_HEARTBEAT_TTL_MIN: "bad" }), DEFAULT_TTL_MS);
    assert.equal(heartbeatTtlMs({ DPF_WORKTREE_SESSION_HEARTBEAT_TTL_MIN: "0" }), DEFAULT_TTL_MS);
  });
});

describe("parseHeartbeat", () => {
  it("accepts a record with numeric beatAt, rejects junk", () => {
    assert.deepEqual(parseHeartbeat('{"beatAt":123}'), { beatAt: 123 });
    assert.equal(parseHeartbeat("not json"), null);
    assert.equal(parseHeartbeat('{"beatAt":"x"}'), null);
    assert.equal(parseHeartbeat("null"), null);
  });
});

describe("isHeartbeatLive", () => {
  const now = 1_000_000_000;
  it("live within ttl, dead past it", () => {
    assert.equal(isHeartbeatLive({ beatAt: now - 10_000 }, now, DEFAULT_TTL_MS), true);
    assert.equal(isHeartbeatLive({ beatAt: now - (DEFAULT_TTL_MS + 1) }, now, DEFAULT_TTL_MS), false);
  });
  it("rejects null/malformed and implausibly-future beats", () => {
    assert.equal(isHeartbeatLive(null, now), false);
    assert.equal(isHeartbeatLive({ beatAt: NaN }, now), false);
    assert.equal(isHeartbeatLive({ beatAt: now + 60 * 60_000 }, now), false);
  });
});

describe("write / read / remove / isWorktreeSessionLive", () => {
  it("writes a live marker, reads it back, and reports live", () => {
    const fs = memFs();
    const now = 5_000_000;
    assert.equal(writeHeartbeat("/wt", { now, pid: 42, sessionId: "s1", event: "Stop", fs }), true);
    const hb = readHeartbeat("/wt", { fs });
    assert.equal(hb.beatAt, now);
    assert.equal(hb.pid, 42);
    assert.equal(hb.sessionId, "s1");
    assert.equal(isWorktreeSessionLive("/wt", { now, ttlMs: DEFAULT_TTL_MS, fs }), true);
  });

  it("preserves startedAt across refreshes but advances beatAt", () => {
    const fs = memFs();
    writeHeartbeat("/wt", { now: 1000, fs });
    writeHeartbeat("/wt", { now: 2000, fs });
    const hb = readHeartbeat("/wt", { fs });
    assert.equal(hb.startedAt, 1000);
    assert.equal(hb.beatAt, 2000);
  });

  it("a stale marker reads as not-live; remove clears it", () => {
    const fs = memFs();
    writeHeartbeat("/wt", { now: 0, fs });
    const later = DEFAULT_TTL_MS + 10_000;
    assert.equal(isWorktreeSessionLive("/wt", { now: later, ttlMs: DEFAULT_TTL_MS, fs }), false);
    assert.equal(removeHeartbeat("/wt", { fs }), true);
    assert.equal(readHeartbeat("/wt", { fs }), null);
    assert.equal(isWorktreeSessionLive("/wt", { now: 0, fs }), false);
  });

  it("missing marker is not live and read returns null", () => {
    const fs = memFs();
    assert.equal(readHeartbeat("/none", { fs }), null);
    assert.equal(isWorktreeSessionLive("/none", { now: 0, fs }), false);
  });
});
