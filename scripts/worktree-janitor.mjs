#!/usr/bin/env node
// scripts/worktree-janitor.mjs
//
// BI-42FA7DD8 — Node worktree janitor (scheduled + host CLI).
// Complements scripts/worktree-janitor.sh (bash) with --json and Tier-A policy.
//
// USAGE
//   node scripts/worktree-janitor.mjs [--dry-run] [--live] [--tier-a-only]
//                                     [--grace-days N] [--json] [--root PATH]
//
// FLAGS
//   --dry-run       (default) Classify only; never remove.
//   --live          Remove eligible worktrees via junction-safe helper + branch -D.
//   --tier-a-only   Live reaps ONLY Tier A (merged+clean). Tier B is always observe.
//                   The Inngest schedule uses this for auto-reap.
//   --grace-days N  Stale threshold for Tier B (default 14).
//   --json          Machine-readable report on stdout.
//   --root PATH     Git root clone (default: DPF_REPO_ROOT / git rev-parse).
//
// SAFETY
//   * Dry-run by default.
//   * Tier A only for scheduled auto-reap (merged + clean + no open PR/lease + not pinned).
//   * Removals go through junction-safe-worktree-remove.mjs (BI-F6AC1A56).
//   * .worktree-pinned is always honored.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  classifyWorktree,
  isLiveReapEligible,
  summarizeDecisions,
} from "./lib/worktree-janitor-core.mjs";
import {
  isWorktreeSessionLive,
  heartbeatTtlMs,
} from "./lib/worktree-session-heartbeat.mjs";
import {
  loadActiveWorkroomPaths,
  pathHasActiveClaim,
} from "./lib/worktree-liveness.mjs";
import { runGit as runGitShared } from "./lib/git.mjs";
import { mcpPost } from "./lib/mcp-client.mjs";
import { parseArgs as utilParseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GRACE = 14;

function parseArgs(argv) {
  // strict: false keeps the old tolerance: unknown flags are ignored.
  const { values, tokens } = utilParseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    tokens: true,
    options: {
      "dry-run": { type: "boolean" },
      live: { type: "boolean" },
      "tier-a-only": { type: "boolean" },
      json: { type: "boolean" },
      "grace-days": { type: "string" },
      root: { type: "string" },
      /** Scope the scan to ONE branch's worktree (BI-848360EF). Default: every worktree. */
      branch: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 35).join("\n"));
    process.exit(0);
  }
  const text = (value) => (typeof value === "string" ? value : undefined);
  // --dry-run and --live toggle one mode; the last one given wins.
  const mode = tokens.findLast((token) => token.kind === "option" && (token.name === "dry-run" || token.name === "live"));
  let graceDays = values["grace-days"] === undefined ? DEFAULT_GRACE : Number(text(values["grace-days"]));
  if (!Number.isFinite(graceDays) || graceDays < 1) graceDays = DEFAULT_GRACE;
  return {
    dryRun: mode?.name !== "live",
    tierAOnly: values["tier-a-only"] === true,
    graceDays,
    json: values.json === true,
    root: values.root === undefined ? process.env.DPF_REPO_ROOT || process.env.PROJECT_ROOT || "" : text(values.root),
    branch: values.branch === undefined ? null : text(values.branch),
  };
}

function runGit(args, cwd) {
  const r = runGitShared(args, { cwd: cwd || process.cwd() });
  return { ok: r.ok, stdout: r.stdout.trim(), stderr: r.ok ? "" : r.stderr.trim(), status: r.status };
}

function resolveRoot(explicit) {
  if (explicit && existsSync(explicit)) return path.resolve(explicit);
  const envRoot = process.env.DPF_REPO_ROOT || process.env.PROJECT_ROOT;
  if (envRoot && existsSync(envRoot)) return path.resolve(envRoot);
  const r = runGit(["rev-parse", "--show-toplevel"]);
  if (r.ok && r.stdout) return r.stdout;
  // Container install mount
  if (existsSync("/host-dpf")) return "/host-dpf";
  throw new Error("could not resolve git root (pass --root or set DPF_REPO_ROOT)");
}

function listWorktrees(root) {
  const r = runGit(["worktree", "list", "--porcelain"], root);
  if (!r.ok) throw new Error(`git worktree list failed: ${r.stderr || r.stdout}`);
  const entries = [];
  let current = null;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length), branch: null, bare: false, detached: false };
    } else if (line.startsWith("branch ") && current) {
      // refs/heads/feat/foo
      const ref = line.slice("branch ".length);
      current.branch = ref.replace(/^refs\/heads\//, "");
    } else if (line === "detached" && current) {
      current.detached = true;
      current.branch = null;
    } else if (line === "bare" && current) {
      current.bare = true;
    } else if (line === "" && current) {
      entries.push(current);
      current = null;
    }
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * One-shot PR index so we do not call `gh` once per worktree (78+ branches
 * was multi-minute). Missing gh → empty sets (ancestry-only merge detection).
 * @returns {{ open: Set<string>, merged: Set<string> }}
 */
function loadPrBranchIndex() {
  const open = new Set();
  const merged = new Set();
  const openR = spawnSync(
    "gh",
    ["pr", "list", "--state", "open", "--limit", "500", "--json", "headRefName"],
    { encoding: "utf8", windowsHide: true, timeout: 60_000 },
  );
  if (openR.status === 0 && openR.stdout) {
    try {
      for (const row of JSON.parse(openR.stdout)) {
        if (row?.headRefName) open.add(String(row.headRefName));
      }
    } catch {
      // ignore
    }
  }
  // Squash-merged heads: list recently merged PRs (cap). Operators can re-run
  // with a higher limit later; ancestry still catches true merge commits.
  const mergedR = spawnSync(
    "gh",
    ["pr", "list", "--state", "merged", "--limit", "500", "--json", "headRefName"],
    { encoding: "utf8", windowsHide: true, timeout: 60_000 },
  );
  if (mergedR.status === 0 && mergedR.stdout) {
    try {
      for (const row of JSON.parse(mergedR.stdout)) {
        if (row?.headRefName) merged.add(String(row.headRefName));
      }
    } catch {
      // ignore
    }
  }
  return { open, merged };
}

function isMerged(root, branch, prIndex) {
  if (!branch) return false;
  const anc = runGit(["merge-base", "--is-ancestor", `refs/heads/${branch}`, "origin/main"], root);
  if (anc.ok) return true;
  return prIndex.merged.has(branch);
}

function isDirty(wtPath) {
  const r = runGit(["status", "--porcelain"], wtPath);
  return r.ok && r.stdout.length > 0;
}

/** True when a merge is in progress in this worktree (MERGE_HEAD present). For a
 *  linked worktree MERGE_HEAD lives in its per-worktree git dir, so ask git. */
function isMidMerge(wtPath) {
  const r = runGit(["rev-parse", "-q", "--verify", "MERGE_HEAD"], wtPath);
  return r.ok && r.stdout.length > 0;
}

function ageDays(wtPath) {
  const r = runGit(["log", "-1", "--format=%ct"], wtPath);
  if (!r.ok || !r.stdout) return 0;
  const ts = Number(r.stdout);
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  return Math.floor((Date.now() / 1000 - ts) / 86400);
}

/**
 * One MCP call for all leases; returns the RAW RESPONSE STRING, which
 * pathHasLease() substring-matches. Every failure path must also return a
 * string: returning a Set here (as this did) is truthy, so pathHasLease got
 * past its `!leasePayload` guard and called Set.includes — which does not
 * exist — crashing the whole janitor. That is the *unattended* path (no token,
 * portal down, curl missing), so the scheduled run died every time while an
 * interactive run with a live token appeared to work.
 */
async function loadLeasePaths() {
  const token = process.env.DPF_MCP_BEARER_TOKEN;
  if (!token) return "";
  const url = process.env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1";
  try {
    const reply = await mcpPost("tools/call", { name: "list_nonprod_environment_leases", arguments: {} }, {
      mcpUrl: url,
      bearerToken: token,
      timeoutMs: 8_000,
    });
    if (reply.status < 200 || reply.status >= 300) return "";
    // Match any path-like substrings later via includes on raw payload.
    return reply.text;
  } catch {
    return "";
  }
}

function pathHasLease(leasePayload, wtPath) {
  if (!leasePayload) return false;
  const norm = wtPath.replace(/\\/g, "/");
  return leasePayload.includes(wtPath) || leasePayload.includes(norm);
}

function gatherFacts(root, entry, prIndex, leasePayload, ttlMs, claims) {
  const wtPath = entry.path;
  const branch = entry.detached ? null : entry.branch;
  const isRoot = path.resolve(wtPath) === path.resolve(root);
  return {
    path: wtPath,
    branch,
    isRoot,
    pinned: existsSync(path.join(wtPath, ".worktree-pinned")),
    hasActiveLease: pathHasLease(leasePayload, wtPath),
    hasOpenPr: branch ? prIndex.open.has(branch) : false,
    merged: branch ? isMerged(root, branch, prIndex) : false,
    dirty: branch ? isDirty(wtPath) : false,
    ageDays: branch ? ageDays(wtPath) : 0,
    // Liveness + abandoned-merge signals — never checked on the root clone.
    hasLiveSession: branch && !isRoot ? isWorktreeSessionLive(wtPath, { ttlMs }) : false,
    midMerge: branch && !isRoot ? isMidMerge(wtPath) : false,
    // Platform-owned liveness. The heartbeat above only exists for Claude Code;
    // the Workroom claim is written by every surface, so it answers for all of
    // them — and when it cannot be read we refuse rather than guess.
    hasActiveClaim: branch && !isRoot ? pathHasActiveClaim(claims.activePaths, wtPath) : false,
    claimSourceUnavailable: branch && !isRoot ? !claims.available : false,
    claimSourceReason: claims.reason,
  };
}

function removeWorktree(root, wtPath, branch) {
  const helper = path.join(here, "lib", "junction-safe-worktree-remove.mjs");
  const rem = spawnSync(process.execPath, [helper, root, wtPath, "--force"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const branchDel =
    branch && rem.status === 0
      ? runGit(["branch", "-D", branch], root)
      : { ok: false, stdout: "", stderr: "skip branch delete" };
  return {
    worktreeRemoved: rem.status === 0,
    worktreeOut: (rem.stdout || rem.stderr || "").trim(),
    branchDeleted: Boolean(branch && branchDel.ok),
    branchOut: (branchDel.stdout || branchDel.stderr || "").trim(),
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  let root;
  try {
    root = resolveRoot(args.root);
  } catch (e) {
    const err = {
      mode: args.dryRun ? "dry-run" : "live",
      available: false,
      error: (e).message,
      decisions: [],
      summary: summarizeDecisions([]),
    };
    if (args.json) {
      console.log(JSON.stringify(err, null, 2));
      process.exit(0); // schedule treats as unavailable, not hard fail
    }
    console.error(`  [fail]  ${err.error}`);
    process.exit(1);
  }

  // Best-effort fetch so merge-base sees current main (skip when offline).
  runGit(["fetch", "origin", "main", "--quiet"], root);

  const entries = listWorktrees(root);
  const prIndex = loadPrBranchIndex();
  const leasePayload = await loadLeasePaths();
  // Ask the platform who owns what, once, for the whole scan.
  const claims = await loadActiveWorkroomPaths();
  if (!claims.available) {
    console.error(
      `[worktree-janitor] Workroom claims UNREADABLE (${claims.reason}) — every worktree will be ` +
        "kept. A reaper that cannot ask who is working must not decide that nobody is.",
    );
  }
  const ttlMs = heartbeatTtlMs(process.env);
  const policy = args.tierAOnly ? "tier-a-only" : "all";
  const decisions = [];
  const removals = [];

  // A merge tells us exactly ONE worktree just became reapable. Scanning the
  // whole fleet to act on one is wasteful and widens the blast radius of a
  // mistake, so `--branch` narrows the scan without touching a single rule:
  // every verdict below is still produced by `classifyWorktree`, which refuses
  // a live session, an active Workroom claim, a pin, a lease and an open PR.
  //
  // That ordering is load-bearing here specifically. classifyWorktree puts the
  // liveness gate ABOVE the merged/Tier-A check precisely because "the moment a
  // live session's PR merges, its clean tree first becomes Tier-A eligible —
  // exactly when it must NOT be reaped". A merge-triggered reaper is the caller
  // that walks straight into that window, so it must go through the classifier
  // rather than around it.
  const scanned = args.branch
    ? entries.filter((e) => e.branch === args.branch)
    : entries;

  if (args.branch && scanned.length === 0) {
    console.error(`[worktree-janitor] no worktree on branch ${args.branch}; nothing to scan.`);
  }

  for (const entry of scanned) {
    const facts = gatherFacts(root, entry, prIndex, leasePayload, ttlMs, claims);
    const { verdict, reason, tier } = classifyWorktree(facts, { graceDays: args.graceDays });
    const row = {
      path: facts.path,
      branch: facts.branch,
      verdict,
      reason,
      tier,
      ageDays: facts.ageDays,
      merged: facts.merged,
      dirty: facts.dirty,
      hasLiveSession: facts.hasLiveSession,
      midMerge: facts.midMerge,
    };
    decisions.push(row);

    if (!args.dryRun && isLiveReapEligible(policy, verdict)) {
      const result = removeWorktree(root, facts.path, facts.branch);
      removals.push({ path: facts.path, branch: facts.branch, ...result });
    }
  }

  const summary = summarizeDecisions(decisions);
  const report = {
    mode: args.dryRun ? "dry-run" : "live",
    available: true,
    root,
    graceDays: args.graceDays,
    policy,
    decisions,
    summary,
    removals: args.dryRun ? [] : removals,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  console.log(
    `\nWorktree janitor — ${report.mode} (grace=${args.graceDays}d, policy=${policy})\n`,
  );
  for (const d of decisions) {
    console.log(`  ${d.verdict.padEnd(12)} ${d.path}  (${d.reason})`);
  }
  for (const p of summary.flaggedPaths ?? []) {
    console.log(`  [flag]  abandoned mid-merge (MERGE_HEAD, no live session): ${p} — quarantined, never auto-reaped`);
  }
  console.log(
    `\nSummary: TierA=${summary.counts.PRUNE_TIER_A} TierB=${summary.counts.PRUNE_TIER_B} ` +
      `KEEP=${summary.counts.KEEP} SKIP=${summary.counts.SKIP} PINNED=${summary.counts.PINNED} ` +
      `FLAG_ABANDONED_MERGE=${summary.counts.FLAG_ABANDONED_MERGE ?? 0}`,
  );
  if (args.dryRun) console.log("\n(Dry run — nothing removed. Pass --live to prune.)\n");
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}

export { main, loadLeasePaths, pathHasLease };
