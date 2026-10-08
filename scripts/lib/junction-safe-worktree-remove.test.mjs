import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scrubGitRepoLocationEnv } from "./git-hook-env.mjs";
import {
  candidateNodeModulesPaths,
  findReparsePoints,
  unlinkReparsePoint,
  safeRemoveWorktree,
} from "./junction-safe-worktree-remove.mjs";

const WT = "D:/DPF/.claude/worktrees/topic";

// readdir stub: apps -> [web, mobile], packages -> [db], services -> []
const readdir = (dir) => {
  if (dir.endsWith("/apps")) return ["web", "mobile"];
  if (dir.endsWith("/packages")) return ["db"];
  return [];
};

test("candidateNodeModulesPaths covers top-level + workspace package node_modules", () => {
  const got = candidateNodeModulesPaths(WT, readdir);
  assert.deepEqual(got, [
    `${WT}/node_modules`,
    `${WT}/apps/web/node_modules`,
    `${WT}/apps/mobile/node_modules`,
    `${WT}/packages/db/node_modules`,
  ]);
});

test("candidateNodeModulesPaths normalizes backslash worktree paths", () => {
  const got = candidateNodeModulesPaths("D:\\DPF\\.claude\\worktrees\\topic", () => []);
  assert.equal(got[0], `${WT}/node_modules`);
});

test("findReparsePoints returns only the candidates that are reparse points", () => {
  const reparse = new Set([`${WT}/node_modules`, `${WT}/apps/web/node_modules`]);
  const got = findReparsePoints(WT, { readdir, isReparse: (p) => reparse.has(p), readEntries: () => [] });
  assert.deepEqual(got, [`${WT}/node_modules`, `${WT}/apps/web/node_modules`]);
});

test("unlinkReparsePoint uses rmdir on win32, unlink on posix", () => {
  const calls = [];
  unlinkReparsePoint("x/node_modules", { platform: "win32", rmdir: (p) => calls.push(["rmdir", p]), unlink: (p) => calls.push(["unlink", p]) });
  unlinkReparsePoint("y/node_modules", { platform: "linux", rmdir: (p) => calls.push(["rmdir", p]), unlink: (p) => calls.push(["unlink", p]) });
  assert.deepEqual(calls, [["rmdir", "x/node_modules"], ["unlink", "y/node_modules"]]);
});

test("unlinkReparsePoint falls back to unlink when rmdir fails on win32 (true symlink)", () => {
  const calls = [];
  unlinkReparsePoint("z/node_modules", {
    platform: "win32",
    rmdir: () => { throw new Error("not a junction"); },
    unlink: (p) => calls.push(["unlink", p]),
  });
  assert.deepEqual(calls, [["unlink", "z/node_modules"]]);
});

test("safeRemoveWorktree unlinks reparse points THEN git worktree remove --force", () => {
  const unlinked = [];
  const gitCalls = [];
  const res = safeRemoveWorktree({
    root: "D:/DPF",
    worktreePath: WT,
    force: true,
    deps: {
      findReparsePoints: () => [`${WT}/node_modules`, `${WT}/apps/web/node_modules`],
      unlinkReparsePoint: (p) => unlinked.push(p),
      git: (args) => { gitCalls.push(args); return { ok: true, detail: "" }; },
    },
  });
  assert.deepEqual(unlinked, [`${WT}/node_modules`, `${WT}/apps/web/node_modules`]);
  assert.deepEqual(gitCalls, [["-C", "D:/DPF", "worktree", "remove", WT, "--force"]]);
  assert.equal(res.removed, true);
});

test("safeRemoveWorktree REFUSES (does not call git) when a reparse point can't be unlinked", () => {
  const gitCalls = [];
  const res = safeRemoveWorktree({
    root: "D:/DPF",
    worktreePath: WT,
    force: true,
    deps: {
      findReparsePoints: () => [`${WT}/node_modules`],
      unlinkReparsePoint: () => { throw new Error("EBUSY"); },
      git: (args) => { gitCalls.push(args); return { ok: true, detail: "" }; },
    },
  });
  assert.equal(res.removed, false);
  assert.equal(gitCalls.length, 0, "git must NOT run when a junction is still present (it would follow it)");
  assert.match(res.detail, /could not unlink reparse point/i);
});

test("safeRemoveWorktree runs git directly when there are no reparse points (no --force)", () => {
  const gitCalls = [];
  const res = safeRemoveWorktree({
    root: "D:/DPF",
    worktreePath: WT,
    force: false,
    deps: {
      findReparsePoints: () => [],
      git: (args) => { gitCalls.push(args); return { ok: true, detail: "" }; },
    },
  });
  assert.deepEqual(gitCalls, [["-C", "D:/DPF", "worktree", "remove", WT]]);
  assert.equal(res.removed, true);
});

// ── BI-995E17AB: links nested inside a REAL node_modules directory ────────────
//
// With a real pnpm install, services/*/node_modules is a real directory whose
// @dpf/* entries are directory junctions. git on Windows cannot remove those, so
// it unregistered the worktree and then stopped at "Directory not empty", leaving
// a half-deleted tree no later reap would retry. These run against the real
// filesystem and real git.

function fixtureGit(args) {
  try {
    const stdout = execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: scrubGitRepoLocationEnv(process.env),
      windowsHide: true,
    });
    return { ok: true, detail: stdout.trim() };
  } catch (err) {
    return { ok: false, detail: String(err.stderr ?? err.message).trim() };
  }
}

/** A repo with one worktree whose services/adp/node_modules is a REAL directory
 *  holding a scoped junction back into the worktree and one to a dir OUTSIDE it. */
function nestedLinkFixture() {
  const base = mkdtempSync(join(tmpdir(), "dpf-junction-safe-"));
  const root = join(base, "root").replace(/\\/g, "/");
  const wt = join(base, "wt").replace(/\\/g, "/");
  const outside = join(base, "outside").replace(/\\/g, "/");
  mkdirSync(root);
  const git = (...a) => {
    const res = fixtureGit(["-C", root, ...a]);
    assert.ok(res.ok, `fixture git ${a.join(" ")} failed: ${res.detail}`);
  };
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  git("worktree", "add", "-q", "-b", "topic", wt);

  mkdirSync(`${wt}/packages/integration-shared`, { recursive: true });
  writeFileSync(`${wt}/packages/integration-shared/index.js`, "export {};\n");
  mkdirSync(outside);
  writeFileSync(`${outside}/sentinel.txt`, "keep me\n");

  const nm = `${wt}/services/adp/node_modules`;
  mkdirSync(`${nm}/@dpf`, { recursive: true });
  writeFileSync(`${nm}/.modules.yaml`, "real directory\n");
  symlinkSync(`${wt}/packages/integration-shared`, `${nm}/@dpf/integration-shared`, "junction");
  symlinkSync(outside, `${nm}/outside-dep`, "junction");
  return { base, root, wt, outside, nm };
}

test("findReparsePoints finds scoped links nested inside a real node_modules directory (BI-995E17AB)", () => {
  const fx = nestedLinkFixture();
  try {
    const got = findReparsePoints(fx.wt).sort();
    assert.deepEqual(got, [`${fx.nm}/@dpf/integration-shared`, `${fx.nm}/outside-dep`].sort());
  } finally {
    rmFixture(fx);
  }
});

test("safeRemoveWorktree fully removes a worktree with nested junctions and never follows one (BI-995E17AB)", () => {
  const fx = nestedLinkFixture();
  try {
    const res = safeRemoveWorktree({ root: fx.root, worktreePath: fx.wt, force: true, deps: { git: fixtureGit } });
    assert.equal(res.removed, true, `removal failed: ${res.detail}`);
    assert.equal(existsSync(fx.wt), false, "the worktree directory must be gone, not half-deleted");
    assert.equal(readFileSync(`${fx.outside}/sentinel.txt`, "utf8"), "keep me\n", "a link's target outside the worktree must survive");
  } finally {
    rmFixture(fx);
  }
});

function rmFixture(fx) {
  // Unlink any links left behind first so cleanup can never follow one.
  for (const p of [`${fx.nm}/@dpf/integration-shared`, `${fx.nm}/outside-dep`]) {
    try {
      unlinkReparsePoint(p);
    } catch {
      /* already gone */
    }
  }
  rmSync(fx.base, { recursive: true, force: true });
}
