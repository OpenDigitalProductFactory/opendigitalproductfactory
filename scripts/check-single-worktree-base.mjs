#!/usr/bin/env node
// One worktree base, or none (BI-541156EE).
//
// Every location decider in the repo applies the same formula —
// `<dirname(root)>/<basename(root)>-worktrees` — so two bases can only appear
// when they are handed different roots. That is exactly what happened: a client
// hook derived its base from the installed instance (`D:\DPF`, which is not a
// git repository at all) and produced one pile of 141, while the source scripts
// derived it from the clone and produced another of 31.
//
// The resolver is now anchored on `git rev-parse --git-common-dir`, so there is
// one answer from anywhere. This guard makes the invariant enforceable rather
// than merely intended: if git reports linked worktrees under more than one
// parent directory, a second base has returned and something is deriving its
// location from the caller instead of the repository.
//
// Advisory by default — an existing install can legitimately be mid-migration —
// and strict under --strict for CI once a repo is converged.

import { execFileSync } from "node:child_process";
import { isEntryModule } from "./lib/entry-module.mjs";
import { dirname, resolve } from "node:path";

/** Parse `git worktree list --porcelain` into absolute worktree paths. */
export function parseWorktreePaths(porcelain) {
  return String(porcelain ?? "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

/**
 * Group linked worktrees by their parent directory. The main worktree (the
 * clone itself) is excluded: it is not IN a base, it OWNS one.
 *
 * @returns {{ bases: Map<string, string[]>, mainWorktree: string | null }}
 */
export function groupByBase(paths) {
  const normalized = paths.map((p) => resolve(p.replace(/\\/g, "/")));
  const mainWorktree = normalized.length > 0 ? normalized[0] : null;
  const bases = new Map();
  for (const path of normalized.slice(1)) {
    const base = dirname(path);
    if (!bases.has(base)) bases.set(base, []);
    bases.get(base).push(path);
  }
  return { bases, mainWorktree };
}

function main(argv) {
  const strict = argv.includes("--strict");
  let porcelain;
  try {
    porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" });
  } catch (err) {
    // Not a repository, or git unavailable: nothing to assert about bases.
    console.log("[single-worktree-base] no git worktree list available — skipping.");
    return 0;
  }

  const { bases } = groupByBase(parseWorktreePaths(porcelain));

  if (bases.size <= 1) {
    const only = [...bases.keys()][0];
    console.log(
      bases.size === 0
        ? "[single-worktree-base] OK — no linked worktrees."
        : `[single-worktree-base] OK — one base: ${only} (${bases.get(only).length} worktree(s)).`,
    );
    return 0;
  }

  const ordered = [...bases.entries()].sort((a, b) => b[1].length - a[1].length);
  console.error(`[single-worktree-base] ${bases.size} worktree bases in use — expected 1:`);
  for (const [base, list] of ordered) {
    console.error(`  ${list.length.toString().padStart(4)}  ${base}`);
  }
  console.error(
    "\nEvery decider derives <dirname(root)>/<basename(root)>-worktrees, so more than one base\n" +
      "means something resolved `root` from the caller's directory rather than from the repository.\n" +
      "Fix the decider to use resolveWorktreeBase() in scripts/lib/worktree-base.mjs, which anchors\n" +
      "on `git rev-parse --git-common-dir` and gives one answer from anywhere (BI-541156EE).",
  );

  if (!strict) {
    console.error("\nAdvisory (no --strict): an install mid-migration can legitimately hold both.");
    return 0;
  }
  return 1;
}

// Windows drive letters make the naive `file://${argv[1]}` comparison fail
// (file://D:/... vs file:///D:/...), which silently turns a guard into a no-op.
if (isEntryModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

export { main };
