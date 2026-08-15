import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decide,
  decideFileWrite,
  resolveAgainst,
  deriveCloneRoot,
  isUnderRootSharedArea,
  recursiveDeleteTargets,
  isDestructiveGitClean,
  isNodeModulesWritingInstall,
} from "./root-clone-guard.mjs";

// A nested worktree (the dominant, dangerous layout: inside the root clone),
// the main clone, and a canonical sibling worktree.
const NESTED = "D:/DPF/.claude/worktrees/quizzical-fermat-04968d";
const MAIN = "D:/DPF";
const SIBLING = "D:/DPF-worktrees/foo";

const yesSym = () => true;
const noSym = () => false;
const mainGit = (p) => p === "D:/DPF/.git"; // main clone: .git is a directory
const noGit = () => false; // worktree: .git is a file

// ── blocks the wipe mechanism ─────────────────────────────────────────────────

test("blocks rm -rf of a junctioned node_modules (the documented root wipe)", () => {
  const v = decide({ command: "rm -rf node_modules", cwd: NESTED, isSymlink: yesSym });
  assert.equal(v.block, true);
  assert.match(v.reason, /junction|shared root|BI-3FAA13A7/i);
});

test("blocks rm -rf of the shared root's packages (absolute, both Windows and Git-Bash drive forms)", () => {
  assert.equal(decide({ command: "rm -rf D:/DPF/packages", cwd: NESTED }).block, true);
  assert.equal(decide({ command: "rm -rf /d/DPF/packages", cwd: NESTED }).block, true);
  assert.equal(decide({ command: "rm -rf D:/DPF/node_modules", cwd: NESTED }).block, true);
});

test("blocks a relative delete that escapes the worktree into the shared clone", () => {
  assert.equal(decide({ command: "rm -rf ../../../packages", cwd: NESTED }).block, true);
});

test("blocks git clean that removes ignored dirs (-fdx / -fdX / -xfd); allows -fd and -n", () => {
  assert.equal(decide({ command: "git clean -fdx", cwd: NESTED }).block, true);
  assert.equal(decide({ command: "git clean -fdX", cwd: NESTED }).block, true);
  assert.equal(decide({ command: "git clean -xfd", cwd: NESTED }).block, true);
  assert.equal(decide({ command: "git clean -fd", cwd: NESTED }).block, false); // untracked only, not ignored
  assert.equal(decide({ command: "git clean -n", cwd: NESTED }).block, false); // dry run
});

test("blocks PowerShell Remove-Item -Recurse of a junction", () => {
  assert.equal(decide({ command: "Remove-Item -Recurse -Force node_modules", cwd: NESTED, isSymlink: yesSym }).block, true);
  assert.equal(decide({ command: "ri node_modules -Recurse", cwd: NESTED, isSymlink: yesSym }).block, true);
});

// ── allows junction-safe + normal removals ────────────────────────────────────

test("allows junction-safe removals even when the target IS a junction", () => {
  // non-recursive rmdir just unlinks the junction (does not descend into root)
  assert.equal(decide({ command: "rmdir node_modules", cwd: NESTED, isSymlink: yesSym }).block, false);
  // git is junction-aware
  assert.equal(decide({ command: "git worktree remove D:/DPF/.claude/worktrees/old", cwd: NESTED, isSymlink: yesSym }).block, false);
  // the documented PowerShell junction-safe delete
  assert.equal(decide({ command: "[IO.Directory]::Delete($p,$false)", cwd: NESTED, isSymlink: yesSym }).block, false);
});

test("allows a normal recursive delete of a real (non-linked) dir inside the worktree", () => {
  assert.equal(decide({ command: "rm -rf .next", cwd: NESTED, isSymlink: noSym }).block, false);
  assert.equal(decide({ command: "rm -rf dist build", cwd: NESTED, isSymlink: noSym }).block, false);
});

test("does not block unrelated, read-only, or empty commands", () => {
  assert.equal(decide({ command: "git status", cwd: NESTED }).block, false);
  assert.equal(decide({ command: "pnpm install", cwd: NESTED }).block, false);
  assert.equal(decide({ command: "ls -la node_modules", cwd: NESTED }).block, false);
  assert.equal(decide({ command: "rm -f stale.log", cwd: NESTED }).block, false); // non-recursive file delete
  assert.equal(decide({ command: "", cwd: NESTED }).block, false);
  assert.equal(decide({ command: undefined, cwd: NESTED }).block, false);
});

// ── emergency bypass ──────────────────────────────────────────────────────────

test("honors the emergency bypass (inline prefix + env)", () => {
  assert.equal(decide({ command: "DPF_ALLOW_ROOT_CLONE_MUTATION=1 rm -rf node_modules", cwd: NESTED, isSymlink: yesSym }).block, false);
  assert.equal(decide({ command: "rm -rf node_modules", cwd: NESTED, isSymlink: yesSym, env: { DPF_ALLOW_ROOT_CLONE_MUTATION: "1" } }).block, false);
});

// ── main clone vs sibling worktree ────────────────────────────────────────────

test("in the MAIN clone, blocks recursive deletes of its shared dirs but allows its worktrees area", () => {
  assert.equal(decide({ command: "rm -rf node_modules", cwd: MAIN, isDir: mainGit }).block, true);
  assert.equal(decide({ command: "rm -rf packages/db", cwd: MAIN, isDir: mainGit }).block, true);
  assert.equal(
    decide({ command: "rm -rf .claude/worktrees/old/build", cwd: MAIN, isDir: mainGit, isSymlink: noSym }).block,
    false,
  );
});

test("in the MAIN clone, blocks git commands that move the checkout or branch tip", () => {
  for (const command of [
    "git switch fix/root-clone-drift",
    "git checkout -b fix/root-clone-drift",
    "git reset --hard origin/main",
    "git pull --ff-only",
  ]) {
    const verdict = decide({ command, cwd: MAIN, isDir: mainGit });
    assert.equal(verdict.block, true, command);
    assert.match(verdict.reason, /root clone|worktree|BI-B6AF69E1/i);
  }
});

test("allows root-clone git drift commands only with the explicit maintenance bypass", () => {
  assert.equal(
    decide({
      command: "git switch fix/root-clone-drift",
      cwd: MAIN,
      isDir: mainGit,
      env: { DPF_ALLOW_ROOT_CLONE_MUTATION: "1" },
    }).block,
    false,
  );
  assert.equal(
    decide({
      command: "DPF_ALLOW_ROOT_CLONE_MUTATION=1 git reset --hard origin/main",
      cwd: MAIN,
      isDir: mainGit,
    }).block,
    false,
  );
});

test("blocks direct Write/Edit targets when a surface is accidentally rooted at the merge checkout", () => {
  for (const toolName of ["Write", "Edit", "MultiEdit"]) {
    const verdict = decideFileWrite({
      toolName,
      toolInput: { file_path: "apps/web/lib/routing/types.ts" },
      cwd: MAIN,
      isDir: mainGit,
    });
    assert.equal(verdict.block, true, toolName);
    assert.match(verdict.reason, /root clone|worktree|BI-FFF58567/i);
  }
});

test("allows direct writes inside a real sibling or nested worktree", () => {
  assert.equal(decideFileWrite({
    toolName: "Edit",
    toolInput: { file_path: `${SIBLING}/apps/web/page.tsx` },
    cwd: SIBLING,
    isDir: noGit,
  }).block, false);
  assert.equal(decideFileWrite({
    toolName: "Write",
    toolInput: { file_path: `${NESTED}/apps/web/page.tsx` },
    cwd: NESTED,
    isDir: noGit,
  }).block, false);
});

test("in a SIBLING worktree, normal deletes are allowed; a junctioned delete is still caught", () => {
  // worktree .git is a FILE -> clone root unknown -> rule (b) skipped
  assert.equal(decide({ command: "rm -rf build", cwd: SIBLING, isDir: noGit, isSymlink: noSym }).block, false);
  // rule (a) still protects against following a junction into the shared root
  assert.equal(decide({ command: "rm -rf node_modules", cwd: SIBLING, isDir: noGit, isSymlink: yesSym }).block, true);
  assert.equal(decide({ command: "git switch fix/real-work", cwd: SIBLING, isDir: noGit }).block, false);
  assert.equal(decide({ command: "git reset --hard origin/main", cwd: SIBLING, isDir: noGit }).block, false);
});

// ── helper units ──────────────────────────────────────────────────────────────

test("deriveCloneRoot: nested -> parent clone; main -> self; sibling -> null", () => {
  assert.equal(deriveCloneRoot(NESTED), "D:/DPF");
  assert.equal(deriveCloneRoot(MAIN, mainGit), "D:/DPF");
  assert.equal(deriveCloneRoot(SIBLING, noGit), null);
});

test("isUnderRootSharedArea: clone root + its shared dirs blocked, worktrees area + outside allowed", () => {
  assert.equal(isUnderRootSharedArea("D:/DPF/packages", "D:/DPF"), true);
  assert.equal(isUnderRootSharedArea("D:/DPF", "D:/DPF"), true);
  assert.equal(isUnderRootSharedArea("D:/DPF/.claude/worktrees/x/build", "D:/DPF"), false);
  assert.equal(isUnderRootSharedArea("D:/other/packages", "D:/DPF"), false);
  assert.equal(isUnderRootSharedArea("D:/DPF/packages", null), false);
});

test("resolveAgainst collapses .. and normalizes drive + Git-Bash forms", () => {
  assert.equal(resolveAgainst(NESTED, "../../../packages"), "D:/DPF/packages");
  assert.equal(resolveAgainst(NESTED, "node_modules"), `${NESTED}/node_modules`);
  assert.equal(resolveAgainst("D:/x", "/d/DPF/packages"), "D:/DPF/packages");
  assert.equal(resolveAgainst("d:/x", "node_modules"), "D:/x/node_modules");
});

test("recursiveDeleteTargets: detects recursion and extracts targets; safe forms return []", () => {
  assert.deepEqual(recursiveDeleteTargets("rm -rf a b"), ["a", "b"]);
  assert.deepEqual(recursiveDeleteTargets("rm -fr node_modules"), ["node_modules"]);
  assert.deepEqual(recursiveDeleteTargets("rm -rf /d/DPF/packages"), ["/d/DPF/packages"]);
  assert.deepEqual(recursiveDeleteTargets("rm -f file"), []); // not recursive
  assert.deepEqual(recursiveDeleteTargets("rmdir x"), []); // non-recursive rmdir is the safe form
  assert.deepEqual(recursiveDeleteTargets("rmdir /s /q x"), ["x"]);
  assert.deepEqual(recursiveDeleteTargets("Remove-Item -Recurse -Path foo"), ["foo"]);
});

test("isDestructiveGitClean: true only when ignored dirs are swept", () => {
  assert.equal(isDestructiveGitClean("git clean -fdx"), true);
  assert.equal(isDestructiveGitClean("git clean -fdX"), true);
  assert.equal(isDestructiveGitClean("git clean -fd"), false);
  assert.equal(isDestructiveGitClean("git status"), false);
});

// ── BI-1C1483C6: install THROUGH a junctioned node_modules ───────────────────
// The delete-through-junction case was already covered above. This is the other
// half of the same foot-gun: a package manager writing through the link into the
// shared root, which previously gutted the root clone (1198 deleted sources).

const WT = "D:/DPF-worktrees/topic";
const junctionedNodeModules = (p) => p === "D:/DPF-worktrees/topic/node_modules";

test("isNodeModulesWritingInstall: matches the commands that materialize packages", () => {
  for (const cmd of [
    "pnpm install",
    "pnpm i",
    "pnpm install --frozen-lockfile",
    "pnpm add zod",
    "pnpm update",
    "npm install",
    "npm ci --no-audit",
    "yarn",
    "bun install",
    "pnpm --filter web add zod",
    "pnpm -C apps/web install",
  ]) {
    assert.equal(isNodeModulesWritingInstall(cmd), true, cmd);
  }
});

test("isNodeModulesWritingInstall: does NOT match read-only queries or script runners", () => {
  for (const cmd of [
    "pnpm ls --depth -1",
    "pnpm why react",
    "pnpm store status",
    "pnpm run pregate",
    "pnpm test",
    "pnpm --filter web typecheck",
    "git install",
  ]) {
    assert.equal(isNodeModulesWritingInstall(cmd), false, cmd);
  }
});

test("blocks a bare pnpm install when node_modules IS a junction", () => {
  const v = decide({ command: "pnpm install", cwd: WT, isSymlink: junctionedNodeModules });
  assert.equal(v.block, true);
  assert.match(v.reason, /writes THROUGH it/);
  assert.match(v.reason, /bootstrap-worktree-deps/, "the denial must name the managed alternative");
  assert.match(v.reason, /cmd \/c rmdir/, "and the junction-safe way to drop the link");
});

test("ALLOWS the same install when node_modules is a real directory", () => {
  // The root clone, and any worktree with its own real node_modules, install
  // normally. The guard keys on runtime state, not on the command text — so it
  // can never become a blanket ban on installing.
  assert.equal(decide({ command: "pnpm install", cwd: WT, isSymlink: () => false }).block, false);
});

test("ALLOWS the managed bootstrap's own install (no node_modules yet, so no junction)", () => {
  assert.equal(
    decide({ command: "pnpm install --prefer-offline --frozen-lockfile", cwd: WT, isSymlink: () => false }).block,
    false,
  );
});

test("the junction install block honors the existing root-mutation escape hatch", () => {
  assert.equal(
    decide({ command: "DPF_ALLOW_ROOT_CLONE_MUTATION=1 pnpm install", cwd: WT, isSymlink: junctionedNodeModules }).block,
    false,
  );
});
