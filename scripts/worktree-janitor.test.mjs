import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import * as janitor from "./worktree-janitor.mjs";

import {
  backupUnpushedBranch,
  backupUnpushedDetachedHead,
  isFreshCheckoutAtOriginMain,
  loadLeasePaths,
  pathHasActiveProcessCwd,
  pathHasLease,
  scanOrphanDirectories,
} from "./worktree-janitor.mjs";

// BI-E5C1ED0A — the janitor crashed on every UNATTENDED run.
//
// loadLeasePaths() returned the raw response STRING on success but `new Set()`
// on each failure path. pathHasLease() guards only on falsiness, and an empty
// Set is truthy, so it fell through to Set.includes(...) — not a function —
// and took the whole run down. The failure paths (no bearer token, portal
// unreachable, curl missing) are exactly the scheduled/CI case, which is why
// this survived: an interactive run with a live token took the string path.
describe("worktree janitor lease payload", () => {
  it("returns a string, never a Set, when no bearer token is configured", async () => {
    const saved = process.env.DPF_MCP_BEARER_TOKEN;
    delete process.env.DPF_MCP_BEARER_TOKEN;
    try {
      const payload = await loadLeasePaths();
      assert.equal(typeof payload, "string", "unauthenticated lease lookup must yield a string");
      assert.ok(!(payload instanceof Set), "must not return a Set — pathHasLease calls .includes()");
    } finally {
      if (saved === undefined) delete process.env.DPF_MCP_BEARER_TOKEN;
      else process.env.DPF_MCP_BEARER_TOKEN = saved;
    }
  });

  it("does not throw when the lease lookup could not run", async () => {
    const saved = process.env.DPF_MCP_BEARER_TOKEN;
    delete process.env.DPF_MCP_BEARER_TOKEN;
    try {
      const payload = await loadLeasePaths();
      assert.doesNotThrow(() => pathHasLease(payload, "/Users/x/dpf-worktrees/thing"));
      assert.equal(pathHasLease(payload, "/Users/x/dpf-worktrees/thing"), false);
    } finally {
      if (saved === undefined) delete process.env.DPF_MCP_BEARER_TOKEN;
      else process.env.DPF_MCP_BEARER_TOKEN = saved;
    }
  });

  it("still detects a leased path inside a raw payload", () => {
    const payload = JSON.stringify({ result: { leases: [{ path: "/Users/x/dpf-worktrees/leased" }] } });
    assert.equal(pathHasLease(payload, "/Users/x/dpf-worktrees/leased"), true);
    assert.equal(pathHasLease(payload, "/Users/x/dpf-worktrees/other"), false);
  });

  it("treats an empty payload as no lease rather than an error", () => {
    assert.equal(pathHasLease("", "/any/path"), false);
  });
});

// BI-EBBBDF40 — Tier B (stale, unmerged) branches are deleted with `branch -D`;
// unpushed commits must be pinned under refs/janitor-backup/ first.
describe("worktree janitor unpushed-work backup", () => {
  function fakeGit({ unpushed, countFails = false, writeFails = false }) {
    const calls = [];
    const git = (args) => {
      calls.push(args.join(" "));
      if (args[0] === "rev-list") return countFails ? { ok: false, stdout: "" } : { ok: true, stdout: String(unpushed) };
      if (args[0] === "rev-parse") return { ok: true, stdout: "a".repeat(40) };
      if (args[0] === "update-ref") return { ok: !writeFails, stdout: "" };
      return { ok: true, stdout: "" };
    };
    return { git, calls };
  }

  it("writes a dated backup ref at the tip of an unpushed branch", () => {
    const { git, calls } = fakeGit({ unpushed: 3 });
    const r = backupUnpushedBranch("/root", "feat/x", "2026-10-27", git);
    assert.deepEqual(r, { ok: true, ref: "refs/janitor-backup/2026-10-27/feat/x", unpushed: 3 });
    assert.ok(calls.includes(`update-ref refs/janitor-backup/2026-10-27/feat/x ${"a".repeat(40)}`));
  });

  it("writes nothing for a branch whose commits are all on a remote", () => {
    const { git, calls } = fakeGit({ unpushed: 0 });
    assert.deepEqual(backupUnpushedBranch("/root", "feat/x", "2026-10-27", git), { ok: true, ref: null, unpushed: 0 });
    assert.ok(!calls.some((c) => c.startsWith("update-ref")));
  });

  it("refuses (keep the worktree) when the ref cannot be written or the count cannot be read", () => {
    assert.equal(backupUnpushedBranch("/root", "feat/x", "2026-10-27", fakeGit({ unpushed: 1, writeFails: true }).git).ok, false);
    assert.equal(backupUnpushedBranch("/root", "feat/x", "2026-10-27", fakeGit({ countFails: true }).git).ok, false);
  });

  it("pins unpushed detached HEAD commits under refs/janitor-backup/<date>/detached-<slug>", () => {
    const { git, calls } = fakeGit({ unpushed: 2 });
    const r = backupUnpushedDetachedHead("/root", "/worktrees/trailer-tmp", "2026-11-22", git);
    assert.deepEqual(r, { ok: true, ref: "refs/janitor-backup/2026-11-22/detached-trailer-tmp", unpushed: 2 });
    assert.ok(calls.includes(`update-ref refs/janitor-backup/2026-11-22/detached-trailer-tmp ${"a".repeat(40)}`));

    assert.equal(
      backupUnpushedDetachedHead("/root", "/worktrees/trailer-tmp", "2026-11-22", fakeGit({ unpushed: 0 }).git).ref,
      null,
    );
    assert.equal(
      backupUnpushedDetachedHead("/root", "/worktrees/trailer-tmp", "2026-11-22", fakeGit({ countFails: true }).git).ok,
      false,
    );
  });
});

describe("worktree janitor orphan directory scanner", () => {
  it("reports unregistered DPF orphan directories while skipping registered trees, files, and foreign repos", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "dpf-janitor-orphans-"));
    try {
      const root = path.join(tmp, "dpf");
      const base = path.join(tmp, "dpf-worktrees");
      mkdirSync(root, { recursive: true });
      mkdirSync(base, { recursive: true });

      const registeredWt = path.join(base, "active-wt");
      const brokenOrphan = path.join(base, "stale-orphan");
      const emptyOrphan = path.join(base, "empty-orphan");
      const foreignClone = path.join(base, "other-repo");
      const foreignLinked = path.join(base, "other-linked");
      mkdirSync(registeredWt);
      mkdirSync(brokenOrphan);
      mkdirSync(emptyOrphan);
      mkdirSync(path.join(foreignClone, ".git"), { recursive: true });
      mkdirSync(foreignLinked);

      writeFileSync(path.join(brokenOrphan, ".git"), `gitdir: ${path.join(root, ".git", "worktrees", "stale-orphan")}\n`);
      writeFileSync(path.join(foreignLinked, ".git"), "gitdir: /elsewhere/other-repo/.git/worktrees/other-linked\n");
      writeFileSync(path.join(base, "stray.log"), "ignore non-dir files\n");

      const scan = scanOrphanDirectories(
        root,
        [{ path: root }, { path: registeredWt }],
        { available: true, activePaths: new Set() },
        { worktreeBase: base, includeT3Base: false },
      );

      assert.equal(scan.baseDir, path.resolve(base));
      assert.deepEqual(
        scan.orphans.map((o) => ({ name: o.name, kind: o.kind, empty: o.empty })),
        [
          { name: "empty-orphan", kind: "empty-dir", empty: true },
          { name: "stale-orphan", kind: "broken-worktree", empty: false },
        ],
      );

      // Also scans ~/.t3/worktrees/<repo> when present.
      const fakeHome = path.join(tmp, "home");
      const t3Orphan = path.join(fakeHome, ".t3", "worktrees", "dpf", "old-t3-backups");
      mkdirSync(t3Orphan, { recursive: true });
      const withT3 = scanOrphanDirectories(
        root,
        [{ path: root }, { path: registeredWt }],
        { available: true, activePaths: new Set() },
        { worktreeBase: base, homeDir: fakeHome },
      );
      assert.ok(withT3.orphans.some((o) => o.name === "old-t3-backups"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("matches active process CWDs at or below a worktree path and protects fresh checkouts at origin/main", () => {
    const cwds = new Set(["/users/x/dpf-worktrees/active/apps/web"]);
    assert.equal(pathHasActiveProcessCwd(cwds, "/Users/x/dpf-worktrees/active"), true);
    assert.equal(pathHasActiveProcessCwd(cwds, "/Users/x/dpf-worktrees/active-other"), false);

    const tmp = mkdtempSync(path.join(os.tmpdir(), "dpf-janitor-fresh-"));
    try {
      writeFileSync(path.join(tmp, ".git"), "gitdir: /root/.git/worktrees/fresh\n");
      const sameShaGit = () => ({ ok: true, stdout: "a".repeat(40) });
      const movedShaGit = (args) => ({ ok: true, stdout: args[1] === "HEAD" ? "b".repeat(40) : "a".repeat(40) });
      assert.equal(isFreshCheckoutAtOriginMain("/root", tmp, { git: sameShaGit }), true);
      assert.equal(isFreshCheckoutAtOriginMain("/root", tmp, { git: movedShaGit }), false);
      assert.equal(isFreshCheckoutAtOriginMain("/root", tmp, { git: sameShaGit, freshGraceMs: 0 }), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("fresh branches and atomic retirement (BI-F52EF21B)", () => {
  function fixture(t) {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "dpf-reap-")));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const root = path.join(dir, "root");
    const wt = path.join(dir, "topic-checkout");
    mkdirSync(root);
    const env = { ...process.env };
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[name];
    const git = (args, cwd = root) => {
      try {
        return { ok: true, stdout: execFileSync("git", args, { cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim() };
      } catch (err) {
        return { ok: false, stdout: "", stderr: String(err.stderr ?? err) };
      }
    };
    const mustGit = (args, cwd = root) => {
      const result = git(args, cwd);
      assert.ok(result.ok, result.stderr);
      return result.stdout;
    };
    mustGit(["init", "-qb", "main"]);
    mustGit(["config", "core.hooksPath", path.join(dir, "no-hooks")]);
    mustGit(["config", "user.email", "test@example.test"]);
    mustGit(["config", "user.name", "Test"]);
    mustGit(["config", "commit.gpgSign", "false"]);
    writeFileSync(path.join(root, "tracked.txt"), "base");
    writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
    mustGit(["add", "."]);
    mustGit(["commit", "-qm", "base"]);
    mustGit(["worktree", "add", "-qb", "topic", wt]);
    return { dir, root, wt, git, mustGit };
  }

  it("distinguishes an old-base or copied branch from genuine merged work", (t) => {
    const { root, wt, git, mustGit } = fixture(t);
    mustGit(["commit", "--allow-empty", "-qm", "main advanced"]);
    mustGit(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    assert.equal(janitor.branchWorkAtTip(root, "topic", git), "no-commits");
    mustGit(["commit", "--allow-empty", "-qm", "topic work"], wt);
    mustGit(["merge", "--no-edit", "topic"]);
    mustGit(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    assert.equal(janitor.branchWorkAtTip(root, "topic", git), "has-commits");
    mustGit(["branch", "-c", "topic", "copied"]);
    assert.equal(janitor.branchWorkAtTip(root, "copied", git), "no-commits");
    mustGit(["reflog", "expire", "--expire=all", "refs/heads/topic"]);
    assert.equal(janitor.branchWorkAtTip(root, "topic", git), "unknown");
  });

  it("refuses dirty, untracked, or unreadable status before touching the tree", (t) => {
    const { dir, root, wt, git, mustGit } = fixture(t);
    mustGit(["config", "status.showUntrackedFiles", "no"], wt);
    writeFileSync(path.join(wt, "secret-local.txt"), "new work");
    let result = janitor.retireWorktree(root, wt, { git });
    assert.equal(result.ok, false);
    assert.match(result.detail, /dirty/);
    assert.equal(readFileSync(path.join(wt, "secret-local.txt"), "utf8"), "new work");
    result = janitor.retireWorktree(root, wt, { git: () => ({ ok: false }) });
    assert.equal(result.ok, false);
    assert.match(result.detail, /status/);
    assert.ok(!readdirSync(dir).some((p) => p.startsWith(".dpf-reap-")));
  });

  it("refuses to retire the janitor invocation cwd even without process-scan evidence", (t) => {
    const { root, wt } = fixture(t);
    const source = `
      import { retireWorktree } from ${JSON.stringify(new URL("./worktree-janitor.mjs", import.meta.url).href)};
      console.log(JSON.stringify(retireWorktree(process.argv[1], process.argv[2])));
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, root, wt], { cwd: wt, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(result.stdout).detail, /current working directory/);
    assert.equal(readFileSync(path.join(wt, "tracked.txt"), "utf8"), "base");
  });

  it("does not purge files written after the initial clean check", (t) => {
    const { root, wt, git, mustGit } = fixture(t);
    const added = path.join(wt, "late.txt");
    const result = janitor.retireWorktree(root, wt, {
      git,
      onIntent() { writeFileSync(added, "late work"); },
    });
    assert.equal(result.ok, false);
    assert.equal(readFileSync(added, "utf8"), "late work");
    assert.match(mustGit(["worktree", "list", "--porcelain"]), /topic-checkout/);
  });

  it("rolls back an intact checkout when Git refuses to unregister it", (t) => {
    const { root, wt, git, mustGit } = fixture(t);
    mustGit(["worktree", "lock", wt]);
    const result = janitor.retireWorktree(root, wt, { git });
    assert.equal(result.ok, false);
    assert.equal(readFileSync(path.join(wt, "tracked.txt"), "utf8"), "base");
    assert.equal(mustGit(["status", "--porcelain"], wt), "");
    assert.match(mustGit(["worktree", "list", "--porcelain"]), /locked/);
  });

  it("unregisters before deleting and leaves failures outside the original checkout", (t) => {
    const { dir, root, wt, git, mustGit } = fixture(t);
    const shared = path.join(dir, "shared");
    mkdirSync(shared);
    writeFileSync(path.join(shared, "valuable.txt"), "keep");
    symlinkSync(shared, path.join(wt, "node_modules"), "junction");
    const result = janitor.retireWorktree(root, wt, {
      git,
      purge(quarantine) {
        assert.equal(existsSync(wt), false);
        assert.equal(mustGit(["worktree", "list", "--porcelain"]).includes(wt), false);
        rmSync(path.join(quarantine, "checkout", "tracked.txt"));
        throw new Error("simulated interruption after first deletion");
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.quarantine);
    assert.equal(existsSync(wt), false);
    assert.equal(readFileSync(path.join(shared, "valuable.txt"), "utf8"), "keep");
  });

  it("survives SIGKILL during deletion without a partial original checkout", { skip: process.platform === "win32" }, (t) => {
    const { dir, root, wt, mustGit } = fixture(t);
    const source = `
      import { rmSync } from "node:fs";
      import { join } from "node:path";
      import { retireWorktree } from ${JSON.stringify(new URL("./worktree-janitor.mjs", import.meta.url).href)};
      retireWorktree(process.argv[1], process.argv[2], {
        purge(quarantine) {
          rmSync(join(quarantine, "checkout", "tracked.txt"));
          process.kill(process.pid, "SIGKILL");
        },
      });
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, root, wt], { cwd: root, encoding: "utf8" });
    assert.equal(result.signal, "SIGKILL", result.stderr);
    assert.equal(existsSync(wt), false);
    assert.equal(mustGit(["worktree", "list", "--porcelain"]).includes(wt), false);
    const quarantine = readdirSync(dir).find((name) => name.startsWith(".dpf-reap-"));
    assert.ok(quarantine);
    assert.equal(readFileSync(path.join(dir, quarantine, "original-path"), "utf8").trim(), wt);
  });

  it("purges a retired checkout without following dependency links", (t) => {
    const { dir, root, wt, git, mustGit } = fixture(t);
    const shared = path.join(dir, "shared");
    mkdirSync(shared);
    writeFileSync(path.join(shared, "valuable.txt"), "keep");
    symlinkSync(shared, path.join(wt, "node_modules"), "junction");
    const result = janitor.retireWorktree(root, wt, { git });
    assert.equal(result.ok, true, result.detail);
    assert.equal(existsSync(wt), false);
    assert.equal(mustGit(["worktree", "list", "--porcelain"]).includes(wt), false);
    assert.equal(readFileSync(path.join(shared, "valuable.txt"), "utf8"), "keep");
  });
});
