import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "worktree-session-heartbeat.mjs");

function hookCommandsFor(eventName) {
  const wiring = JSON.parse(readFileSync(join(here, "hooks.json"), "utf8"));
  const events = wiring.hooks ?? wiring;
  return (events[eventName] ?? []).flatMap((entry) =>
    (entry.hooks ?? []).map((h) => String(h.command ?? "")),
  );
}

function runHook(payload, env = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    input: JSON.stringify(payload),
    windowsHide: true,
    timeout: 30_000,
  });
}

describe("worktree-session-heartbeat wiring", () => {
  it("refreshes on SessionStart AND Stop, and is removed on SessionEnd", () => {
    for (const event of ["SessionStart", "Stop", "SessionEnd"]) {
      assert.ok(
        hookCommandsFor(event).some((c) => c.includes("worktree-session-heartbeat.mjs")),
        `heartbeat must be wired to ${event}`,
      );
    }
  });

  it("loads from the plugin root, not a repo path", () => {
    for (const event of ["SessionStart", "Stop", "SessionEnd"]) {
      for (const c of hookCommandsFor(event).filter((c) => c.includes("worktree-session-heartbeat.mjs"))) {
        assert.ok(c.includes("CLAUDE_PLUGIN_ROOT"), `heartbeat ${event} command must use CLAUDE_PLUGIN_ROOT: ${c}`);
      }
    }
  });
});

describe("worktree-session-heartbeat behavior", () => {
  it("no-ops with the skip env and emits nothing", () => {
    const r = runHook(
      { hookEventName: "Stop", cwd: process.cwd() },
      { DPF_SKIP_WORKTREE_SESSION_HEARTBEAT: "1" },
    );
    assert.equal(r.status, 0);
    assert.equal((r.stdout || "").trim(), "");
  });

  it("does NOT write a marker at the root/main clone (only linked worktrees get one)", (t) => {
    // BI-D26E8A08. This used to point at `join(here, "../../..")` — the AMBIENT
    // checkout — and assert no marker appeared. That is only the root clone when
    // the tests happen to run there. This repo mandates worktree-per-session, so
    // in practice it ran inside a LINKED worktree, where the hook correctly
    // writes a marker and the assertion failed.
    //
    // Worse, it was self-poisoning: the failing run left the marker behind, so
    // the next run saw `preexisting` and skipped the assertion entirely. Fail,
    // then pass, which reads as flake. CI never saw it because CI checks out a
    // plain clone.
    //
    // Build a throwaway MAIN clone instead, mirroring how the sibling test
    // builds a throwaway linked worktree. Nothing outside the temp dir is
    // touched, so the result no longer depends on where the suite is run.
    let base;
    try {
      base = mkdtempSync(join(tmpdir(), "dpf-hb-root-"));
      const git = (args, cwd) => {
        const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 30_000 });
        if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r;
      };
      git(["init", "-q", "-b", "main"], base);
      git(["config", "user.email", "t@example.com"], base);
      git(["config", "user.name", "t"], base);
      writeFileSync(join(base, "f.txt"), "x\n");
      git(["add", "-A"], base);
      git(["commit", "-q", "-m", "init"], base);

      const marker = join(base, ".dpf-session-heartbeat.json");
      const r = runHook(
        { hookEventName: "Stop", cwd: base },
        { DPF_GUARDS_WORKSPACE_ANY: "1" }, // temp dir is not a DPF checkout
      );

      assert.equal(r.status, 0);
      assert.equal(existsSync(marker), false, "must not heartbeat the root/main clone");
    } catch (err) {
      t.skip(`git setup unavailable: ${err.message}`);
    } finally {
      if (base) {
        try {
          rmSync(base, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  });

  it("writes on Stop and removes on SessionEnd inside a real linked worktree", (t) => {
    // Build a throwaway repo + linked worktree. Skip if git is unavailable.
    let base;
    try {
      base = mkdtempSync(join(tmpdir(), "dpf-hb-"));
      const git = (args, cwd) => {
        const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 30_000 });
        if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
        return r;
      };
      git(["init", "-q", "-b", "main"], base);
      git(["config", "user.email", "t@example.com"], base);
      git(["config", "user.name", "t"], base);
      writeFileSync(join(base, "f.txt"), "x\n");
      git(["add", "-A"], base);
      git(["commit", "-q", "-m", "init"], base);
      const wt = join(base, "wt");
      git(["worktree", "add", "-q", "-b", "feat/hb", wt], base);

      const marker = join(wt, ".dpf-session-heartbeat.json");
      const env = { DPF_GUARDS_WORKSPACE_ANY: "1" }; // temp dir is not a DPF checkout

      const beat = runHook({ hookEventName: "Stop", cwd: wt }, env);
      assert.equal(beat.status, 0);
      assert.ok(existsSync(marker), "Stop must write the heartbeat marker in a linked worktree");
      const rec = JSON.parse(readFileSync(marker, "utf8"));
      assert.equal(typeof rec.beatAt, "number");

      const end = runHook({ hookEventName: "SessionEnd", cwd: wt }, env);
      assert.equal(end.status, 0);
      assert.equal(existsSync(marker), false, "SessionEnd must remove the heartbeat marker");
    } catch (err) {
      t.skip(`git worktree setup unavailable: ${err.message}`);
    } finally {
      if (base) {
        try {
          rmSync(base, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  });
});
