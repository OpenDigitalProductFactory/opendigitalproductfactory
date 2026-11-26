import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

  it("audits on SessionEnd and observes on SessionStart", () => {
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

});

describe("SessionEnd checkout preservation (BI-F52EF21B)", () => {
  function fixtureEnv(overrides = {}) {
    const env = { ...process.env };
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
      "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX", "GIT_NAMESPACE",
      "T3CODE_THREAD_ID", "DPF_SKIP_WORKTREE_SESSION_HYGIENE", "DPF_SKIP_WORKTREE_SESSION_HEARTBEAT"]) {
      delete env[name];
    }
    return { ...env, DPF_GUARDS_WORKSPACE_ANY: "1", DPF_WORKTREE_SESSION_REAP: "1", ...overrides };
  }

  function git(cwd, ...args) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: fixtureEnv() });
    assert.equal(r.status, 0, "git " + args.join(" ") + ": " + r.stderr);
    return r.stdout.trim();
  }

  function checkout(t, { merged = false } = {}) {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "dpf-session-end-")));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const main = join(base, "main");
    const wt = join(base, "wt");
    mkdirSync(main);
    mkdirSync(join(base, "no-hooks"));
    git(main, "init", "-q", "-b", "main");
    git(main, "config", "core.hooksPath", join(base, "no-hooks"));
    git(main, "config", "commit.gpgSign", "false");
    git(main, "config", "user.email", "t@example.test");
    git(main, "config", "user.name", "t");
    writeFileSync(join(main, "tracked.txt"), "base");
    writeFileSync(join(main, ".gitignore"), ".dpf-session-heartbeat.json\n");
    git(main, "add", ".");
    git(main, "commit", "-qm", "base");
    git(main, "worktree", "add", "-qb", "topic", wt);
    if (merged) {
      writeFileSync(join(wt, "tracked.txt"), "topic");
      git(wt, "commit", "-qam", "topic work");
      git(main, "merge", "--ff-only", "topic");
    }
    git(main, "update-ref", "refs/remotes/origin/main", "HEAD");
    return { main, wt, log: join(main, ".git", "dpf-worktree-reap.jsonl") };
  }

  function hook(main, cwd, event, env, file = script) {
    const r = spawnSync(process.execPath, [file], {
      cwd: main,
      input: JSON.stringify({ hook_event_name: event, session_id: "ending", cwd }),
      env: fixtureEnv(env),
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stderr);
    return r;
  }

  const records = (log) => readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);

  it("never calls a fresh branch merged on SessionStart", (t) => {
    const { main, wt } = checkout(t);
    const r = hook(main, wt, "SessionStart", { T3CODE_THREAD_ID: "thread-fixture" });
    assert.doesNotMatch(r.stdout, /already merged|will be reaped/);
  });

  it("keeps a T3 fresh checkout across turns and logs each refusal", (t) => {
    const { main, wt, log } = checkout(t);
    for (let turn = 0; turn < 3; turn++) {
      hook(main, wt, "SessionEnd", { T3CODE_THREAD_ID: "thread-fixture" });
      assert.equal(existsSync(join(wt, "tracked.txt")), true);
      assert.equal(readFileSync(join(wt, "tracked.txt"), "utf8"), "base");
      assert.equal(git(wt, "status", "--porcelain"), "");
    }
    const entries = records(log);
    assert.equal(entries.length, 3);
    for (const row of entries) {
      assert.equal(row.path, wt);
      assert.equal(row.branch, "topic");
      assert.equal(row.tier, null);
      assert.equal(row.outcome, "refused");
      assert.match(row.reason, /T3/);
    }
  });

  it("keeps an otherwise merged, clean checkout when SessionEnd names that cwd", (t) => {
    const { main, wt, log } = checkout(t, { merged: true });
    hook(main, wt, "SessionEnd");
    assert.equal(existsSync(join(wt, "tracked.txt")), true);
    assert.equal(readFileSync(join(wt, "tracked.txt"), "utf8"), "topic");
    assert.equal(git(wt, "status", "--porcelain"), "");
    assert.match(records(log)[0].reason, /session cwd/);
  });

  it("keeps tracked edits and untracked files, including with the legacy reap flag set", (t) => {
    const { main, wt, log } = checkout(t, { merged: true });
    writeFileSync(join(wt, "tracked.txt"), "local edit");
    writeFileSync(join(wt, "untracked.txt"), "new local work");
    const before = git(wt, "status", "--porcelain", "--untracked-files=all");
    hook(main, wt, "SessionEnd");
    assert.equal(git(wt, "status", "--porcelain", "--untracked-files=all"), before);
    assert.equal(readFileSync(join(wt, "tracked.txt"), "utf8"), "local edit");
    assert.equal(readFileSync(join(wt, "untracked.txt"), "utf8"), "new local work");
    assert.equal(records(log)[0].outcome, "refused");
  });

  it("never attempts a reap or writes a reap record on Stop or an unknown event", (t) => {
    const { main, wt, log } = checkout(t, { merged: true });
    hook(main, wt, "Stop");
    hook(main, wt, "Unknown");
    assert.equal(existsSync(join(wt, "tracked.txt")), true);
    assert.equal(existsSync(log), false);
  });

  it("preserves the T3 heartbeat when the provider process exits", (t) => {
    const { main, wt } = checkout(t);
    const heartbeat = join(here, "worktree-session-heartbeat.mjs");
    const marker = join(wt, ".dpf-session-heartbeat.json");
    const env = { T3CODE_THREAD_ID: "thread-fixture" };
    hook(main, wt, "SessionStart", env, heartbeat);
    assert.equal(existsSync(marker), true);
    hook(main, wt, "SessionEnd", env, heartbeat);
    assert.equal(existsSync(marker), true);
  });
});
