import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "worktree-session-hygiene.mjs");

function hookCommandsFor(eventName) {
  const wiring = JSON.parse(readFileSync(join(here, "hooks.json"), "utf8"));
  const events = wiring.hooks ?? wiring;
  return (events[eventName] ?? []).flatMap((entry) =>
    (entry.hooks ?? []).map((h) => String(h.command ?? "")),
  );
}

describe("worktree-session-hygiene", () => {
  it("no-ops outside DPF workspace and with skip env", () => {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        DPF_SKIP_WORKTREE_SESSION_HYGIENE: "1",
      },
      input: JSON.stringify({ hookEventName: "SessionStart", cwd: process.cwd() }),
      windowsHide: true,
    });
    assert.equal(r.status, 0);
    assert.equal((r.stdout || "").trim(), "");
  });

  it("SessionStart in DPF workspace exits 0 (may emit context)", () => {
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: join(here, "../../.."),
      env: {
        ...process.env,
        DPF_SKIP_WORKTREE_SESSION_HYGIENE: "0",
      },
      input: JSON.stringify({
        hookEventName: "SessionStart",
        cwd: join(here, "../../.."),
      }),
      windowsHide: true,
      timeout: 60_000,
    });
    assert.equal(r.status, 0);
  });

  // BI-E5D810B8 — the regression that cost a day of worktrees.
  //
  // Wired on `Stop`, this hook force-removed the worktree the session was STILL
  // WORKING IN: `Stop` fires after every assistant turn, and a live tree first
  // satisfies Tier A (merged + clean + no open PR) the moment its own PR merges.
  // The removal could not complete against a live cwd, so it gutted the tree —
  // 59 tracked files deleted (pnpm-lock.yaml, tsconfig.base.json, .githooks/*)
  // with `.git` left intact, presenting as "uncommitted deletions".
  //
  // Spec 2026-07-26-multi-client-governance-parity-design.md §D4 puts the reaper
  // on SessionEnd; G4 gives Stop only uncommitted-artifact warning + lease release.
  it("is NOT wired to Stop — a per-turn event must never trigger a destructive reap", () => {
    const stopCommands = hookCommandsFor("Stop");
    assert.ok(
      !stopCommands.some((c) => c.includes("worktree-session-hygiene")),
      `worktree-session-hygiene must not run on Stop (fires every turn); found: ${JSON.stringify(stopCommands)}`,
    );
  });

  it("still reaps on SessionEnd, and still observes on SessionStart", () => {
    for (const event of ["SessionStart", "SessionEnd"]) {
      assert.ok(
        hookCommandsFor(event).some((c) => c.includes("worktree-session-hygiene")),
        `worktree-session-hygiene must stay wired to ${event}`,
      );
    }
  });

  it("keeps the uncommitted-work guard on Stop — that one is non-destructive and belongs there", () => {
    assert.ok(
      hookCommandsFor("Stop").some((c) => c.includes("uncommitted-work-guard")),
      "removing the reaper from Stop must not strip the uncommitted-work guard",
    );
  });

  it("a Stop payload never removes anything, even for a Tier-A cwd", () => {
    // Belt-and-braces: even if the wiring regressed, the handler must not reap
    // on a per-turn event. Exercised against the repo root, which exits early.
    const root = join(here, "../../..");
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, DPF_SKIP_WORKTREE_SESSION_HYGIENE: "0" },
      input: JSON.stringify({ hookEventName: "Stop", cwd: root }),
      windowsHide: true,
      timeout: 60_000,
    });
    assert.equal(r.status, 0);
    assert.ok(
      !/reaped Tier-A worktree/.test(r.stdout || ""),
      `Stop must not report a reap; got: ${r.stdout}`,
    );
  });
});

// BI-296C9E24: an ending session reaped a merged, clean worktree that another
// session was still working in (138 tracked files deleted, 2026-10-13).
describe("SessionEnd reap respects other live sessions (BI-296C9E24)", () => {
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };

  /** A main repo plus a linked worktree on a branch already merged into origin/main. */
  function tierAWorktree() {
    const base = mkdtempSync(join(tmpdir(), "reap-live-"));
    const main = join(base, "main");
    const wt = join(base, "wt");
    mkdirSync(main);
    git(main, "init", "-q", "-b", "main");
    git(main, "config", "user.email", "t@example.test");
    git(main, "config", "user.name", "t");
    writeFileSync(join(main, "tracked.txt"), "x\n");
    writeFileSync(join(main, ".gitignore"), ".dpf-session-heartbeat.json\n");
    git(main, "add", ".");
    git(main, "commit", "-q", "-m", "base");
    git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(main, "worktree", "add", "-q", "-b", "topic", wt, "HEAD");
    return { main, wt };
  }

  function sessionEnd(wt, sessionId) {
    return spawnSync(process.execPath, [script], {
      input: JSON.stringify({ hook_event_name: "SessionEnd", session_id: sessionId, cwd: wt }),
      env: { ...process.env, DPF_GUARDS_WORKSPACE_ANY: "1", DPF_WORKTREE_SESSION_REAP: "1", GH_TOKEN: "" },
      encoding: "utf8",
      timeout: 60_000,
    });
  }

  it("control: alone in its worktree, the ending session reaps it", () => {
    const { wt } = tierAWorktree();
    writeFileSync(join(wt, ".dpf-session-heartbeat.json"), JSON.stringify({ beatAt: Date.now(), sessionId: "ending" }));
    sessionEnd(wt, "ending");
    assert.equal(existsSync(join(wt, "tracked.txt")), false);
  });

  it("keeps the worktree, every file intact, while another session's heartbeat is fresh", () => {
    const { wt } = tierAWorktree();
    const now = Date.now();
    writeFileSync(
      join(wt, ".dpf-session-heartbeat.json"),
      JSON.stringify({
        beatAt: now,
        sessions: { live: { beatAt: now - 1000 }, ending: { beatAt: now } },
      }),
    );
    const r = sessionEnd(wt, "ending");
    assert.equal(existsSync(join(wt, "tracked.txt")), true, r.stdout);
    assert.match(r.stdout, /another live session/);
  });

  it("a second reap of the same worktree while one is in flight does nothing", () => {
    const { main, wt } = tierAWorktree();
    const gitDir = git(wt, "rev-parse", "--absolute-git-dir");
    writeFileSync(join(gitDir, "dpf-reap.lock"), String(Date.now()));
    const r = sessionEnd(wt, "ending");
    assert.equal(existsSync(join(wt, "tracked.txt")), true, r.stdout);
    assert.ok(existsSync(main));
  });
});
