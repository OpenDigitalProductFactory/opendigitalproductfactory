#!/usr/bin/env node
// scripts/bind-worktree-cli.mjs
//
// Bind a worktree to a Workroom from a shell caller (BI-0B292D84 layer 1).
//
// WHY THIS EXISTS
//   Bind-at-birth landed in packages/dpf-skill-pack/hooks/worktree-create.mjs,
//   which is the Claude Code WorktreeCreate hook. That is ONE of the two paths
//   that create worktrees here. The other is scripts/new-dev-worktree.sh — the
//   path the branch-and-worktree runbook documents, the path the CLI surfaces
//   use, and the path every worktree in this session was actually created with.
//   It never bound anything.
//
//   The effect was measurable within a day: reconciliation took binding
//   coverage to 95%, and it fell back to 82% as new branches were created
//   through the shell path. Automating one of two entry points does not
//   automate the obligation; it just moves where the leak is.
//
// Usage:  node scripts/bind-worktree-cli.mjs <worktree-path> [branch]
//
// Prints a one-line human result to stderr and always exits 0: a worktree that
// could not be bound is still a usable worktree, and worktree creation must
// never fail because the coordination plane is unreachable. The claim guard is
// what makes an unbound tree consequential, not this script.

import { execFileSync } from "node:child_process";

import { bindWorktreeToWorkroom } from "./lib/workroom-bind.mjs";

const DEFAULT_REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

function repoFullNameFrom(remoteUrl) {
  const m = String(remoteUrl ?? "").match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : DEFAULT_REPO;
}

async function main() {
  const worktreePath = process.argv[2];
  if (!worktreePath) {
    process.stderr.write("[bind-worktree] usage: node scripts/bind-worktree-cli.mjs <worktree-path> [branch]\n");
    return;
  }
  const branch = process.argv[3] || git(worktreePath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!branch) {
    process.stderr.write("[bind-worktree] no branch (detached HEAD) — nothing to claim against.\n");
    return;
  }

  const result = await bindWorktreeToWorkroom({
    branch,
    worktreePath,
    gitDir: git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-dir"]),
    repositoryFullName: repoFullNameFrom(git(worktreePath, ["config", "--get", "remote.origin.url"])),
    headSha: git(worktreePath, ["rev-parse", "HEAD"]),
  });

  if (result.status === "bound") {
    process.stderr.write(`[bind-worktree] Workroom claimed for ${branch}: ${result.capsuleId}\n`);
  } else {
    process.stderr.write(
      `[bind-worktree] NOT bound (${result.status}: ${result.reason}) — AGENTS.md 12 still requires a claim, `
      + `and the claim guard refuses edits without one. Call adopt_worktree, or re-run: node scripts/reconcile-workroom-bindings.mjs --apply\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`[bind-worktree] binding failed: ${err?.message ?? err}\n`);
}).finally(() => process.exit(0));
