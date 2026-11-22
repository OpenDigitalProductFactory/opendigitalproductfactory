import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  backupUnpushedBranch,
  backupUnpushedDetachedHead,
  loadLeasePaths,
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
        { worktreeBase: base },
      );

      assert.equal(scan.baseDir, path.resolve(base));
      assert.deepEqual(
        scan.orphans.map((o) => ({ name: o.name, kind: o.kind, empty: o.empty })),
        [
          { name: "empty-orphan", kind: "empty-dir", empty: true },
          { name: "stale-orphan", kind: "broken-worktree", empty: false },
        ],
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
