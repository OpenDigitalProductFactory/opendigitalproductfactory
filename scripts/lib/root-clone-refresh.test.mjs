import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  overlappingPaths,
  planRootRefresh,
  gatherRootState,
  refreshRootClone,
} from "./root-clone-refresh.mjs";

describe("planRootRefresh", () => {
  it("fast-forwards a clean, on-main, behind root", () => {
    assert.deepEqual(
      planRootRefresh({ detached: false, onMain: true, clean: true, behind: 3 }).action,
      "ff",
    );
  });

  it("skips when already current", () => {
    assert.equal(planRootRefresh({ detached: false, onMain: true, clean: true, behind: 0 }).action, "skip");
  });

  it("refuses when off-main, dirty, or detached — never force-moves the root", () => {
    assert.equal(planRootRefresh({ detached: false, onMain: false, clean: true, behind: 5 }).action, "refuse");
    assert.equal(planRootRefresh({ detached: false, onMain: true, clean: false, behind: 5 }).action, "refuse");
    assert.equal(planRootRefresh({ detached: true, onMain: false, clean: true, behind: 5 }).action, "refuse");
  });
});

/**
 * Scripted fake git: maps a joined-args key to stdout. Any unmatched call returns
 * a non-zero status so gitText/measure treat it as empty.
 */
function fakeGit(map) {
  const calls = [];
  const impl = (_bin, args) => {
    calls.push(args.join(" "));
    const key = args.join(" ");
    for (const [pattern, out] of Object.entries(map)) {
      if (key.includes(pattern)) return { status: 0, stdout: out, stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "" };
  };
  return { impl, calls };
}

describe("gatherRootState", () => {
  it("reads branch, cleanliness, and behind-count", () => {
    const { impl } = fakeGit({
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": "",
      "rev-parse HEAD": "aaa",
      "rev-parse origin/main": "bbb",
      "rev-list --count aaa..bbb": "4",
    });
    const state = gatherRootState("/root", { spawnSyncImpl: impl });
    assert.equal(state.branch, "main");
    assert.equal(state.onMain, true);
    assert.equal(state.detached, false);
    assert.equal(state.clean, true);
    assert.equal(state.behind, 4);
  });

  it("flags a dirty, off-main root", () => {
    const { impl } = fakeGit({
      "rev-parse --abbrev-ref HEAD": "feat/x",
      "status --porcelain": " M file.ts",
      "rev-parse HEAD": "aaa",
      "rev-parse origin/main": "bbb",
      "rev-list --count aaa..bbb": "2",
    });
    const state = gatherRootState("/root", { spawnSyncImpl: impl });
    assert.equal(state.onMain, false);
    assert.equal(state.clean, false);
  });
});

describe("refreshRootClone", () => {
  it("runs a ff-only merge when safe and reports changed", () => {
    const { impl, calls } = fakeGit({
      "fetch origin main": "",
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": "",
      "rev-parse HEAD": "aaa",
      "rev-parse origin/main": "bbb",
      "rev-list --count aaa..bbb": "2",
      "merge --ff-only origin/main": "Updating aaa..bbb",
    });
    const r = refreshRootClone({ rootClonePath: "/root", spawnSyncImpl: impl });
    assert.equal(r.action, "ff");
    assert.equal(r.changed, true);
    assert.ok(calls.some((c) => c.includes("merge --ff-only origin/main")));
  });

  it("does NOT merge a dirty root", () => {
    const { impl, calls } = fakeGit({
      "fetch origin main": "",
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain": " M x",
      "rev-parse HEAD": "aaa",
      "rev-parse origin/main": "bbb",
      "rev-list --count aaa..bbb": "2",
    });
    const r = refreshRootClone({ rootClonePath: "/root", spawnSyncImpl: impl });
    assert.equal(r.action, "refuse");
    assert.equal(r.changed, false);
    assert.ok(!calls.some((c) => c.includes("merge --ff-only")));
  });

  it("reports failed when the ff-only merge itself fails", () => {
    const impl = (_bin, args) => {
      const key = args.join(" ");
      if (key.includes("rev-parse --abbrev-ref HEAD")) return { status: 0, stdout: "main", stderr: "" };
      if (key.includes("status --porcelain")) return { status: 0, stdout: "", stderr: "" };
      if (key.endsWith("rev-parse HEAD")) return { status: 0, stdout: "aaa", stderr: "" };
      if (key.includes("rev-parse origin/main")) return { status: 0, stdout: "bbb", stderr: "" };
      if (key.includes("rev-list --count")) return { status: 0, stdout: "2", stderr: "" };
      if (key.includes("merge --ff-only")) return { status: 1, stdout: "", stderr: "not possible to fast-forward" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const r = refreshRootClone({ rootClonePath: "/root", spawnSyncImpl: impl, doFetch: false });
    assert.equal(r.action, "failed");
    assert.equal(r.changed, false);
    assert.match(r.reason, /fast-forward/);
  });
});

// ── BI-F676CC23: dirt nothing upstream touches does not freeze the root ─────
//
// 2026-09-23..25: one bootstrap-written .mcp.json kept the root clone 90 commits
// behind, so every hook wired from it ran old code — including a merged fix for
// the guard that was nagging about that very file.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("overlappingPaths", () => {
  it("matches exact paths and directory prefixes either way", () => {
    assert.deepEqual(overlappingPaths([".mcp.json"], ["apps/web/a.ts"]), []);
    assert.deepEqual(overlappingPaths(["apps/web/a.ts"], ["apps/web/a.ts", "b"]), ["apps/web/a.ts"]);
    assert.deepEqual(overlappingPaths(["tmp/"], ["tmp/x.ts"]), ["tmp/"]);
    assert.deepEqual(overlappingPaths(["pkg/new/file.ts"], ["pkg/new"]), ["pkg/new/file.ts"]);
    assert.deepEqual(overlappingPaths(["apps/web"], ["apps/website.ts"]), []);
  });
});

describe("planRootRefresh with uncommitted files", () => {
  const base = { detached: false, onMain: true, clean: false, behind: 3 };
  it("fast-forwards when no dirty path is changed upstream", () => {
    assert.equal(planRootRefresh({ ...base, overlap: [] }).action, "ff");
  });
  it("refuses, naming the files, when upstream changes a dirty path", () => {
    const plan = planRootRefresh({ ...base, overlap: [".mcp.json"] });
    assert.equal(plan.action, "refuse");
    assert.match(plan.reason, /\.mcp\.json/);
  });
  it("refuses when the overlap could not be determined", () => {
    assert.equal(planRootRefresh({ ...base, overlap: null }).action, "refuse");
  });
  it("skips a dirty root that is already current", () => {
    assert.equal(planRootRefresh({ ...base, behind: 0, overlap: [] }).action, "skip");
  });
});

function git(dir, ...args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** An upstream repo and a root clone of it, with upstream one commit ahead. */
function behindRoot() {
  const tmp = mkdtempSync(join(tmpdir(), "rcr-"));
  const up = join(tmp, "up");
  const root = join(tmp, "root");
  spawnSync("git", ["init", "-q", "-b", "main", up]);
  for (const d of [up]) {
    git(d, "config", "user.email", "t@t");
    git(d, "config", "user.name", "t");
  }
  writeFileSync(join(up, "shared.txt"), "v1\n");
  writeFileSync(join(up, "config.json"), "{}\n");
  git(up, "add", ".");
  git(up, "commit", "-q", "-m", "one");
  spawnSync("git", ["clone", "-q", up, root]);
  writeFileSync(join(up, "shared.txt"), "v2\n");
  git(up, "commit", "-q", "-am", "two");
  return { up, root };
}

describe("refreshRootClone against real repositories", () => {
  it("fast-forwards past a dirty file the incoming commits do not touch, and keeps the edit", () => {
    const { up, root } = behindRoot();
    writeFileSync(join(root, "config.json"), '{"local": true}\n');
    writeFileSync(join(root, "scratch.txt"), "untracked\n");
    const r = refreshRootClone({ rootClonePath: root });
    assert.equal(r.action, "ff", r.reason);
    assert.equal(git(root, "rev-parse", "HEAD"), git(up, "rev-parse", "HEAD"));
    assert.equal(readFileSync(join(root, "config.json"), "utf8"), '{"local": true}\n');
    assert.equal(readFileSync(join(root, "scratch.txt"), "utf8"), "untracked\n");
  });

  it("refuses, and moves nothing, when a dirty file is one the incoming commits change", () => {
    const { root } = behindRoot();
    const before = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "shared.txt"), "local edit\n");
    const r = refreshRootClone({ rootClonePath: root });
    assert.equal(r.action, "refuse");
    assert.match(r.reason, /shared\.txt/);
    assert.equal(git(root, "rev-parse", "HEAD"), before);
    assert.equal(readFileSync(join(root, "shared.txt"), "utf8"), "local edit\n");
  });

  it("refuses when a staged rename's source is changed upstream", () => {
    const { root } = behindRoot();
    git(root, "mv", "shared.txt", "moved.txt");
    const r = refreshRootClone({ rootClonePath: root });
    assert.equal(r.action, "refuse");
    assert.match(r.reason, /shared\.txt/);
  });
});
