#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/shared-clone-occupancy.mjs
//
// SessionStart advisory (BI-D234C277): say, before any work begins, that this
// session is standing in the SHARED root clone — and who else is in it.
//
// The existing readiness banner reports "Worktree verification-readiness:
// SOURCE-ONLY". That is a dependency status. It reads as "your tooling is
// limited", not as "other sessions are working in this checkout". On 2026-08-21
// a session read it the first way, edited the root clone for hours, and lost the
// work when a second session cleaned the tree — a `git checkout -- .` leaves no
// reflog entry, so nothing else would have told it either.
//
// Reads git state only: no MCP, no portal, no network. It still reports when
// everything else is down, which is exactly when a session is most likely to be
// improvising in the wrong directory. Advisory, always exit 0.
// Silence with DPF_SKIP_CLONE_OCCUPANCY=1.

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

const REMEDY = "git worktree add -b <branch> ../dpf-worktrees/<topic> origin/main";

function gitOut(args) {
  try {
    const r = spawnSync("git", args, { encoding: "utf8", timeout: 10_000 });
    return r.status === 0 && r.stdout ? r.stdout : "";
  } catch {
    return "";
  }
}

function isDirReal(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/**
 * @param {string} cwd
 * @param {(args: string[]) => string} runGit stdout, "" on failure
 * @param {(p: string) => boolean} isDir
 */
export function describeCloneOccupancy(cwd, runGit, isDir = () => false) {
  const norm = String(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  // A linked worktree's .git is a FILE; only the primary clone has a directory.
  if (!isDir(`${norm}/.git`)) return { isRootClone: false, lines: [] };

  const branch = runGit(["-C", norm, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
  // Porcelain XY is column-significant: " M f" is unstaged, "M  f" is staged.
  // Trimming first would read every unstaged edit as another session's staged work.
  const dirty = runGit(["-C", norm, "status", "--porcelain"])
    .split("\n")
    .filter((l) => l.trim() !== "");
  const staged = dirty.filter((l) => /^[MARCD]/.test(l));
  const others = runGit(["-C", norm, "worktree", "list"])
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith(`${norm} `));

  const lines = [
    "SHARED ROOT CLONE — this is not your worktree.",
    `  ${norm}${branch && branch !== "HEAD" ? ` (on ${branch})` : ""}`,
  ];
  if (staged.length > 0) {
    lines.push(
      `  ${staged.length} staged change(s) are already here — another session is mid-work. Do not commit, stash, or reset them.`,
    );
  } else if (dirty.length > 0) {
    lines.push(`  ${dirty.length} uncommitted change(s) are already here; they may not be yours.`);
  }
  if (others.length > 0) {
    lines.push(`  ${others.length} other worktree(s) exist — sessions are expected to take one.`);
  }
  lines.push(
    "  Take your own before editing anything:",
    `    ${REMEDY}`,
    "  Editing here races every other session in this clone, and a tree-clean from any of them destroys your uncommitted work with no reflog entry.",
  );
  return { isRootClone: true, lines };
}

function main() {
  if (process.env.DPF_SKIP_CLONE_OCCUPANCY === "1") process.exit(0);
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const { isRootClone, lines } = describeCloneOccupancy(cwd, gitOut, isDirReal);
  if (!isRootClone) process.exit(0);
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("shared-clone-occupancy.mjs")) {
  main();
}
