import assert from "node:assert/strict";
import { test } from "node:test";

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
  const got = findReparsePoints(WT, { readdir, isReparse: (p) => reparse.has(p) });
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
