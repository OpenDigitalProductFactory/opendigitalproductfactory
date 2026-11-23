import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  composeProjectNameForWorktree,
  ensureWorktreeComposeProjectName,
  runOnCreate,
  runOnSettle,
  T3_BRIDGE_SESSION_ID,
} from "./t3-worktree-bridge.mjs";
import { readHeartbeat, writeHeartbeat } from "./lib/worktree-session-heartbeat.mjs";

describe("t3-worktree-bridge", () => {
  it("derives a sanitized Compose project name from the worktree directory", () => {
    assert.equal(
      composeProjectNameForWorktree("/Users/x/.t3/worktrees/dpf/Chore_Cleanup-123"),
      "dpf-chore-cleanup-123",
    );
  });

  it("writes COMPOSE_PROJECT_NAME once without overwriting an existing value", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "dpf-t3-bridge-env-"));
    try {
      const wt = path.join(tmp, "feat-sample");
      mkdirSync(wt);

      const first = ensureWorktreeComposeProjectName(wt);
      assert.equal(first.updated, true);
      assert.equal(readFileSync(path.join(wt, ".env"), "utf8"), "COMPOSE_PROJECT_NAME=dpf-feat-sample\n");

      const second = ensureWorktreeComposeProjectName(wt);
      assert.equal(second.updated, false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("on-create skips root clone and seeds heartbeat + Compose isolation in linked worktrees", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "dpf-t3-bridge-create-"));
    try {
      const root = path.join(tmp, "dpf");
      const wt = path.join(tmp, "t3-branch-abc");
      mkdirSync(root);
      mkdirSync(wt);

      const skipped = runOnCreate({ worktreePath: root, rootClone: root });
      assert.equal(skipped.skipped, true);
      assert.equal(existsSync(path.join(root, ".env")), false);

      const created = runOnCreate({ worktreePath: wt, rootClone: root, now: 1_700_000_000_000, pid: 4242 });
      assert.equal(created.skipped, false);
      assert.equal(created.heartbeatWritten, true);
      assert.match(readFileSync(path.join(wt, ".env"), "utf8"), /COMPOSE_PROJECT_NAME=dpf-t3-branch-abc/);
      const hb = readHeartbeat(wt);
      assert.equal(hb?.beatAt, 1_700_000_000_000);
      assert.ok(hb?.sessions?.[T3_BRIDGE_SESSION_ID]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("on-settle clears only the T3 bridge heartbeat and delegates Tier-A branch cleanup to worktree-janitor.mjs from root cwd", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "dpf-t3-bridge-settle-"));
    try {
      const root = path.join(tmp, "dpf");
      const wt = path.join(tmp, "t3-branch-def");
      mkdirSync(path.join(root, "scripts"), { recursive: true });
      mkdirSync(wt);
      writeFileSync(path.join(root, "scripts", "worktree-janitor.mjs"), "// stub\n");

      // Seed both the T3 bridge entry and a second concurrent session entry.
      writeHeartbeat(wt, { now: 1_700_000_000_000, sessionId: T3_BRIDGE_SESSION_ID, event: "t3-worktree-create" });
      writeHeartbeat(wt, { now: 1_700_000_001_000, sessionId: "claude-peer", event: "Stop" });

      const calls = [];
      const fakeSpawn = (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        return { status: 0, stdout: "ok", stderr: "" };
      };

      const res = runOnSettle({
        worktreePath: wt,
        rootClone: root,
        branch: "feat/demo",
        spawn: fakeSpawn,
      });

      assert.equal(res.ok, true);
      assert.equal(res.skipped, false);
      // T3 bridge slot removed; peer session slot preserved.
      const hbAfter = readHeartbeat(wt);
      assert.equal(hbAfter?.sessions?.[T3_BRIDGE_SESSION_ID], undefined);
      assert.ok(hbAfter?.sessions?.["claude-peer"]);

      // Delegates to janitor from root cwd with --branch + --tier-a-only + --allow-fresh + --live.
      assert.equal(calls.length, 1);
      assert.equal(calls[0].opts.cwd, root);
      assert.ok(calls[0].args.includes("--branch"));
      assert.ok(calls[0].args.includes("feat/demo"));
      assert.ok(calls[0].args.includes("--tier-a-only"));
      assert.ok(calls[0].args.includes("--allow-fresh"));
      assert.ok(calls[0].args.includes("--live"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("on-settle refuses root clone and main branch", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "dpf-t3-bridge-guard-"));
    try {
      const root = path.join(tmp, "dpf");
      const wt = path.join(tmp, "wt");
      mkdirSync(root);
      mkdirSync(wt);
      assert.equal(runOnSettle({ worktreePath: root, rootClone: root, branch: "feat/x" }).skipped, true);
      assert.equal(runOnSettle({ worktreePath: wt, rootClone: root, branch: "main" }).skipped, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
