#!/usr/bin/env node
// scripts/reconcile-workroom-bindings.mjs
//
// Reconcile live worktree branches against their Workroom bindings
// (BI-0B292D84 layer 4).
//
// Bind-at-birth closes the gap for worktrees created from now on. It does
// nothing for the ones that already exist, and those are the whole measured
// problem: 31 of 91 live branches carried no binding on 2026-08-27, a number
// that had not moved since the rule was written. A rule with no reconciliation
// only ever governs the future.
//
// DRY RUN BY DEFAULT. Pass --apply to bind. That is the same posture the
// worktree janitor takes, and for the same reason: a sweep that mutates the
// coordination plane on a typo is worse than one that has to be asked twice.
//
// Usage:
//   node scripts/reconcile-workroom-bindings.mjs            # report only
//   node scripts/reconcile-workroom-bindings.mjs --apply    # bind the unbound
//   node scripts/reconcile-workroom-bindings.mjs --json     # machine-readable

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isClaimExemptBranch } from "../packages/dpf-skill-pack/hooks/lib/workroom-claim-lookup.mjs";
import { bindWorktreeToWorkroom, resolveMcpAccess } from "./lib/workroom-bind.mjs";

const DEFAULT_REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

// ── pure ─────────────────────────────────────────────────────────────────────

/**
 * Parse `git worktree list --porcelain` into {path, branch} pairs.
 * A detached worktree has no branch and is skipped: there is nothing to claim.
 * @param {string} porcelain
 */
export function parseWorktrees(porcelain) {
  const out = [];
  let current = null;
  for (const line of String(porcelain ?? "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) current = { path: line.slice(9).trim(), branch: null };
    else if (line.startsWith("branch ") && current) current.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    else if (line === "" && current) { out.push(current); current = null; }
  }
  if (current) out.push(current);
  return out.filter((w) => w.path);
}

/**
 * Split worktrees into those that need a claim and those that never do.
 * @param {{path:string,branch:string|null}[]} worktrees
 */
export function partitionForReconciliation(worktrees) {
  const claimable = [];
  const exempt = [];
  for (const w of worktrees) {
    if (!w.branch) exempt.push({ ...w, why: "detached HEAD — nothing to claim against" });
    else if (isClaimExemptBranch(w.branch)) exempt.push({ ...w, why: "exempt branch (merge-queue / parked / CI slot)" });
    else claimable.push(w);
  }
  return { claimable, exempt };
}

/**
 * Human summary. Reports the coverage number this exists to move.
 *
 * The dry run says "ensure", not "create". adopt_worktree is bind-or-reuse: it
 * returns the existing live capsule for a branch that already has one. Without
 * asking MCP per branch this pass cannot tell bound from unbound, and claiming
 * it can would be the same overstatement this effort exists to remove.
 */
export function summarize({ claimable, exempt, bound, failed, applied }) {
  const total = claimable.length + exempt.length;
  const pct = claimable.length ? Math.round((bound / claimable.length) * 100) : 100;
  const lines = [
    `${total} worktree(s): ${claimable.length} need a Workroom claim, ${exempt.length} exempt`,
    applied
      ? `claim ensured for ${bound}/${claimable.length} (${pct}%)${failed ? `, ${failed} could not be bound` : ""}`
      : `${claimable.length} branch(es) would have a claim ENSURED (adopt_worktree reuses an existing one) - re-run with --apply for the real split`,
  ];
  return lines.join("\n");
}

// ── effectful ────────────────────────────────────────────────────────────────

function git(args, cwd = process.cwd()) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 15_000 }).trim();
}

function gitDirFor(worktreePath) {
  try {
    return git(["rev-parse", "--path-format=absolute", "--git-dir"], worktreePath);
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const asJson = args.includes("--json");
  const repo = process.env.DPF_REPO_FULL_NAME || DEFAULT_REPO;

  if (apply && !resolveMcpAccess()) {
    console.error("[reconcile-workrooms] --apply needs DPF_MCP_BEARER_TOKEN; MCP is the only authority on claims.");
    process.exit(1);
  }

  const { claimable, exempt } = partitionForReconciliation(parseWorktrees(git(["worktree", "list", "--porcelain"])));

  const results = [];
  let bound = 0;
  let failed = 0;
  for (const w of claimable) {
    if (!apply) { results.push({ ...w, status: "would-bind" }); bound += 1; continue; }
    const r = await bindWorktreeToWorkroom({
      branch: w.branch,
      worktreePath: w.path,
      gitDir: gitDirFor(w.path),
      repositoryFullName: repo,
      headSha: (() => { try { return git(["rev-parse", "HEAD"], w.path); } catch { return null; } })(),
    });
    results.push({ ...w, ...r });
    if (r.status === "bound") bound += 1; else failed += 1;
    console.log(`  ${r.status === "bound" ? "BOUND  " : "SKIP   "} ${w.branch}${r.capsuleId ? ` -> ${r.capsuleId}` : ""}${r.reason ? ` (${r.reason})` : ""}`);
  }

  if (asJson) {
    console.log(JSON.stringify({ claimable: claimable.length, exempt: exempt.length, bound, failed, applied: apply, results }, null, 2));
  } else {
    console.log(summarize({ claimable, exempt, bound, failed, applied: apply }));
  }
  process.exit(failed > 0 && apply ? 1 : 0);
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`[reconcile-workrooms] ${err?.message ?? err}`);
    process.exit(1);
  });
}
