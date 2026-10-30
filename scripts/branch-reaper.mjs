#!/usr/bin/env node
// scripts/branch-reaper.mjs
//
// BI-88D75BA3 — reap local branches whose work is already on main and that
// nobody is using; prune remote-tracking refs; report the stash.
// Complements scripts/worktree-janitor.mjs, which reaps a branch only with the
// worktree it removes, so a branch left behind without a tree was never reaped.
//
// USAGE
//   node scripts/branch-reaper.mjs [--live] [--json] [--root PATH]
//
// FLAGS
//   (default)  Dry run: classify and report; delete nothing, prune nothing.
//   --live     Delete reapable branches and run `git fetch --prune origin`.
//   --json     Machine-readable report on stdout.
//   --root     Git root clone (default: DPF_REPO_ROOT / git rev-parse).
//
// SAFETY
//   * Policy in scripts/lib/branch-reaper-core.mjs: merged into origin/main
//     (ancestor, or exactly a merged PR's head), no worktree, no open PR, no
//     live Workroom, not current/protected/pinned. Unreadable ownership or PR
//     state reaps nothing.
//   * Deletion is compare-and-delete (`update-ref -d <ref> <tip>`): a branch
//     that moved since it was classified is left alone.
//   * Pins: one branch name per line in <git-common-dir>/dpf-branch-pins.
//   * The stash is reported, never dropped: it is repository-wide.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs as utilParseArgs } from "node:util";

import { classifyBranches, stashCensus, summarizeBranchDecisions, mergedPullRequestHeads, openPullRequestBranches } from "./lib/branch-reaper-core.mjs";
import { runGit as runGitShared } from "./lib/git.mjs";
import { loadActiveWorkroomPaths } from "./lib/worktree-liveness.mjs";
import { scriptArgv } from "./lib/script-argv.mjs";

function runGit(args, cwd) {
  const r = runGitShared(args, { cwd });
  return { ok: r.ok, stdout: r.stdout.trim(), stderr: r.ok ? "" : r.stderr.trim() };
}

function resolveRoot(explicit) {
  if (explicit && existsSync(explicit)) return path.resolve(explicit);
  const envRoot = process.env.DPF_REPO_ROOT || process.env.PROJECT_ROOT;
  if (envRoot && existsSync(envRoot)) return path.resolve(envRoot);
  const r = runGit(["rev-parse", "--show-toplevel"], process.cwd());
  if (r.ok && r.stdout) return r.stdout;
  throw new Error("could not resolve git root (pass --root or set DPF_REPO_ROOT)");
}

function lines(text) {
  return text ? text.split(/\r?\n/).filter(Boolean) : [];
}

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", windowsHide: true, timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

async function gatherFacts(root) {
  const branches = lines(runGit(["for-each-ref", "refs/heads", "--format=%(refname:short)%09%(objectname)"], root).stdout)
    .map((line) => {
      const [name, tip] = line.split("\t");
      return { name, tip };
    });
  const worktreeInventory = runGit(["worktree", "list", "--porcelain"], root);
  const worktreeBranches = new Set(
    lines(worktreeInventory.stdout)
      .filter((line) => line.startsWith("branch refs/heads/"))
      .map((line) => line.slice("branch refs/heads/".length)),
  );
  const current = runGit(["symbolic-ref", "--short", "HEAD"], root);
  const ancestorMerged = new Set(lines(runGit(["branch", "--merged", "origin/main", "--format=%(refname:short)"], root).stdout));

  const open = ghJson(["pr", "list", "--state", "open", "--limit", "1000", "--json", "headRefName"]);
  const merged = ghJson(["pr", "list", "--state", "merged", "--base", "main", "--limit", "20000", "--json", "headRefName,headRefOid,baseRefName,mergeCommit"]);
  // Enumerate reachable history once. Missing shallow history is conservative:
  // an absent merge cannot establish delivery, and is never guessed from a title.
  const history = runGit(["rev-list", "origin/main"], root);
  const mainCommits = new Set(history.ok ? lines(history.stdout) : []);
  const mergedPrHeads = mergedPullRequestHeads(merged, sha => mainCommits.has(sha));
  const openBranches = openPullRequestBranches(open);

  // Branches are all the reaper needs; skipping per-room path reads keeps the
  // observation inside its read budget on an install with hundreds of rooms.
  // A scheduled sweep can wait for a large install's full observation.
  const rooms = await loadActiveWorkroomPaths({ resolvePaths: false, requireBranches: true, readBudgetMs: 900_000 });
  const pinFile = path.join(path.resolve(root, runGit(["rev-parse", "--git-common-dir"], root).stdout), "dpf-branch-pins");
  const pinned = new Set(existsSync(pinFile) ? lines(readFileSync(pinFile, "utf8")).map((l) => l.trim()) : []);

  return {
    facts: {
      branches,
      worktreeBranches,
      currentBranch: current.ok ? current.stdout : null,
      ancestorMerged,
      mergedPrHeads,
      openPrBranches: openBranches ?? new Set(),
      liveRoomBranches: rooms.activeBranches ?? new Set(),
      // An unreadable open-PR list is as unsafe as an unreadable Workroom read.
      ownershipAvailable: rooms.available && openBranches !== null && worktreeInventory.ok,
      pinned,
    },
    notes: {
      workrooms: rooms.reason,
      openPrs: openBranches === null ? "unavailable or incomplete" : `${open.length} open`,
      mergedPrs: merged === null ? "unavailable (ancestry only)" : `${merged.length} merged`,
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const { values } = utilParseArgs({
    args: scriptArgv(argv),
    strict: false,
    options: { live: { type: "boolean" }, json: { type: "boolean" }, root: { type: "string" } },
  });
  const root = resolveRoot(values.root);
  const live = values.live === true;

  const { facts, notes } = await gatherFacts(root);
  const decisions = classifyBranches(facts);
  const summary = summarizeBranchDecisions(decisions);

  let deleted = 0;
  const failures = [];
  if (live) {
    for (const d of decisions.filter((x) => x.action === "reap")) {
      const r = runGit(["update-ref", "-d", `refs/heads/${d.name}`, d.tip], root);
      if (r.ok) deleted++;
      else failures.push({ name: d.name, error: r.stderr });
    }
  }

  const remoteBefore = lines(runGit(["for-each-ref", "refs/remotes/origin", "--format=%(refname)"], root).stdout).length;
  let prune;
  if (live) {
    const r = runGit(["fetch", "--prune", "--quiet", "origin"], root);
    const after = lines(runGit(["for-each-ref", "refs/remotes/origin", "--format=%(refname)"], root).stdout).length;
    prune = { ran: r.ok, remoteRefsBefore: remoteBefore, remoteRefsAfter: after, error: r.ok ? null : r.stderr };
  } else {
    const r = runGit(["remote", "prune", "--dry-run", "origin"], root);
    prune = { ran: false, remoteRefsBefore: remoteBefore, wouldPrune: lines(r.stdout).filter((l) => l.includes("[would prune]")).length };
  }

  const stash = stashCensus(runGit(["stash", "list", "--format=%gd%x09%ct"], root).stdout, new Date());
  const report = {
    mode: live ? "live" : "dry-run",
    root,
    localBranchesBefore: facts.branches.length,
    localBranchesAfter: facts.branches.length - deleted,
    summary,
    deleted,
    failures,
    prune,
    stash,
    notes,
  };

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const reasons = Object.entries(summary.byReason).map(([k, v]) => `${k}=${v}`).join(" ");
    process.stdout.write(
      `[branch-reaper] ${report.mode}: ${summary.total} local branches, ${summary.reap} reapable (${reasons})\n`
      + (live ? `[branch-reaper] deleted ${deleted}, ${failures.length} refused; local branches ${report.localBranchesBefore} -> ${report.localBranchesAfter}\n` : "")
      + `[branch-reaper] remote-tracking refs ${live ? `${prune.remoteRefsBefore} -> ${prune.remoteRefsAfter}` : `${prune.remoteRefsBefore}, ${prune.wouldPrune} would be pruned`}\n`
      + `[branch-reaper] stash: ${stash.count} entries (${stash.olderThan30Days} older than 30 days; never dropped)\n`
      + `[branch-reaper] inputs: workrooms ${notes.workrooms}; PRs ${notes.openPrs}, ${notes.mergedPrs}\n`,
    );
  }
  return failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (error) => {
    process.stderr.write(`[branch-reaper] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  });
}

export { main };
