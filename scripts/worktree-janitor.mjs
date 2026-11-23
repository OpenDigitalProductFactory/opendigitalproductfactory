#!/usr/bin/env node
// scripts/worktree-janitor.mjs
//
// BI-42FA7DD8 — Node worktree janitor (scheduled + host CLI).
// Complements scripts/worktree-janitor.sh (bash) with --json and Tier-A policy.
//
// USAGE
//   node scripts/worktree-janitor.mjs [--dry-run] [--live] [--tier-a-only]
//                                     [--grace-days N] [--prune-detached]
//                                     [--detached-grace-days N] [--json]
//                                     [--root PATH] [--worktree-base PATH]
//
// FLAGS
//   --dry-run                (default) Classify only; never remove.
//   --live                   Remove eligible worktrees via junction-safe helper + branch -D.
//                            A Tier B branch (or detached HEAD) with commits on no remote
//                            is first saved at refs/janitor-backup/<YYYY-MM-DD>/<name>;
//                            if that fails it is kept.
//   --tier-a-only            Live reaps ONLY Tier A (merged+clean, or stale clean detached
//                            HEAD with no unpushed commits when --prune-detached is set).
//                            Tier B is always observe. The Inngest schedule uses this.
//   --grace-days N           Stale threshold for Tier B (default 14).
//   --prune-detached         Opt-in age-bounded classification/cleanup of stale clean
//                            detached-HEAD scratch worktrees (fail-closed on unreadable
//                            Workroom claims, active leases/heartbeats, pins, or dirtiness).
//   --detached-grace-days N  Age threshold for --prune-detached (default: --grace-days).
//   --json                   Machine-readable report on stdout (includes orphanDirs).
//   --root PATH              Git root clone (default: DPF_REPO_ROOT / git rev-parse).
//   --worktree-base PATH     Override canonical sibling worktree directory for orphan scan.
//
// SAFETY
//   * Dry-run by default.
//   * Tier A only for scheduled auto-reap (merged + clean + no open PR/lease + not pinned).
//   * Removals go through junction-safe-worktree-remove.mjs (BI-F6AC1A56).
//   * .worktree-pinned is always honored.
//   * Unregistered orphan directories in the sibling worktree base are reported, never auto-deleted.

import { closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  classifyOrphanDirectory,
  classifyWorktree,
  isLiveReapEligible,
  summarizeDecisions,
} from "./lib/worktree-janitor-core.mjs";
import {
  isWorktreeSessionLive,
  heartbeatTtlMs,
} from "./lib/worktree-session-heartbeat.mjs";
import { sanitizeForLog } from "./lib/safe-log.mjs";
import {
  loadActiveWorkroomPaths,
  normalizePath,
  pathHasActiveClaim,
} from "./lib/worktree-liveness.mjs";
import { resolveWorktreeBase } from "./lib/worktree-base.mjs";
import { runGit as runGitShared } from "./lib/git.mjs";
import { mcpPost } from "./lib/mcp-client.mjs";
import { parseArgs as utilParseArgs } from "node:util";
import { scriptArgv } from "./lib/script-argv.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GRACE = 14;

function parseArgs(argv) {
  // strict: false keeps the old tolerance: unknown flags are ignored.
  const { values, tokens } = utilParseArgs({
    args: scriptArgv(argv),
    strict: false,
    allowPositionals: true,
    tokens: true,
    options: {
      "dry-run": { type: "boolean" },
      live: { type: "boolean" },
      "tier-a-only": { type: "boolean" },
      "prune-detached": { type: "boolean" },
      "detached-grace-days": { type: "string" },
      "allow-fresh": { type: "boolean" },
      json: { type: "boolean" },
      "grace-days": { type: "string" },
      root: { type: "string" },
      "worktree-base": { type: "string" },
      /** Scope the scan to ONE branch's worktree (BI-848360EF). Default: every worktree. */
      branch: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 42).join("\n"));
    process.exit(0);
  }
  const text = (value) => (typeof value === "string" ? value : undefined);
  // --dry-run and --live toggle one mode; the last one given wins.
  const mode = tokens.findLast((token) => token.kind === "option" && (token.name === "dry-run" || token.name === "live"));
  let graceDays = values["grace-days"] === undefined ? DEFAULT_GRACE : Number(text(values["grace-days"]));
  if (!Number.isFinite(graceDays) || graceDays < 1) graceDays = DEFAULT_GRACE;
  let detachedGraceDays = values["detached-grace-days"] === undefined
    ? graceDays
    : Number(text(values["detached-grace-days"]));
  if (!Number.isFinite(detachedGraceDays) || detachedGraceDays < 1) detachedGraceDays = graceDays;
  return {
    dryRun: mode?.name !== "live",
    tierAOnly: values["tier-a-only"] === true,
    pruneDetached: values["prune-detached"] === true,
    allowFresh: values["allow-fresh"] === true,
    graceDays,
    detachedGraceDays,
    json: values.json === true,
    root: values.root === undefined ? process.env.DPF_REPO_ROOT || process.env.PROJECT_ROOT || "" : text(values.root),
    worktreeBase: values["worktree-base"] === undefined ? "" : text(values["worktree-base"]) || "",
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

function isDetachedHeadMerged(wtPath) {
  const anc = runGit(["merge-base", "--is-ancestor", "HEAD", "origin/main"], wtPath);
  return anc.ok;
}

function detachedHeadUnpushedStatus(wtPath) {
  const count = runGit(["rev-list", "--count", "HEAD", "--not", "--remotes"], wtPath);
  const unpushed = Number(count.stdout);
  if (!count.ok || !Number.isInteger(unpushed)) {
    return { hasUnpushedCommits: false, unpushedCommitsUnknown: true };
  }
  return { hasUnpushedCommits: unpushed > 0, unpushedCommitsUnknown: false };
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

const DEFAULT_FRESH_GRACE_MS = 60 * 60_000;

/** One-shot active OS process CWDs so the reaper never deletes a tree with a live shell/agent inside it. */
export function loadActiveProcessCwds(platform = process.platform) {
  const cwds = new Set();
  if (platform === "win32") return cwds;
  const r = spawnSync("lsof", ["-d", "cwd", "-Fn"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout) {
    for (const line of r.stdout.split(/\r?\n/)) {
      if (line.startsWith("n/")) cwds.add(normalizePath(line.slice(1)));
    }
  }
  return cwds;
}

/** True when any running process CWD equals or is nested inside `wtPath`. */
export function pathHasActiveProcessCwd(activeCwds, wtPath) {
  if (!(activeCwds instanceof Set) || activeCwds.size === 0) return false;
  const norm = normalizePath(path.resolve(wtPath));
  if (!norm) return false;
  const prefix = `${norm}/`;
  for (const cwd of activeCwds) {
    if (cwd === norm || cwd.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * True when a linked worktree was created within `freshGraceMs` AND its HEAD
 * still matches `origin/main` (the "brand-new T3/Codex checkout before first
 * commit" window where `merge-base --is-ancestor` would otherwise call it Tier A).
 */
export function isFreshCheckoutAtOriginMain(root, wtPath, { nowMs = Date.now(), freshGraceMs = DEFAULT_FRESH_GRACE_MS, git = runGit } = {}) {
  if (!Number.isFinite(freshGraceMs) || freshGraceMs <= 0) return false;
  const gitMarker = path.join(wtPath, ".git");
  let createdMs = null;
  const birthMs = (st) => (st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs);
  try {
    createdMs = birthMs(lstatSync(gitMarker));
  } catch (err) {
    if (!err || err.code !== "ENOENT") return false;
    try {
      createdMs = birthMs(lstatSync(wtPath));
    } catch {
      return false;
    }
  }
  if (!Number.isFinite(createdMs) || nowMs - createdMs > freshGraceMs) return false;
  const head = git(["rev-parse", "HEAD"], wtPath);
  const originMain = git(["rev-parse", "origin/main"], root);
  return head.ok && originMain.ok && Boolean(head.stdout) && head.stdout === originMain.stdout;
}

function gatherFacts(root, entry, prIndex, leasePayload, ttlMs, claims, runtimeOpts = {}) {
  const wtPath = entry.path;
  const branch = entry.detached ? null : entry.branch;
  const isRoot = path.resolve(wtPath) === path.resolve(root);
  const detachedUnpushed = !branch && !isRoot
    ? detachedHeadUnpushedStatus(wtPath)
    : { hasUnpushedCommits: false, unpushedCommitsUnknown: false };
  return {
    path: wtPath,
    branch,
    isRoot,
    pinned: existsSync(path.join(wtPath, ".worktree-pinned")),
    hasActiveLease: pathHasLease(leasePayload, wtPath),
    hasOpenPr: branch ? prIndex.open.has(branch) : false,
    merged: branch ? isMerged(root, branch, prIndex) : (!isRoot ? isDetachedHeadMerged(wtPath) : false),
    dirty: !isRoot ? isDirty(wtPath) : false,
    ageDays: !isRoot ? ageDays(wtPath) : 0,
    // Liveness + abandoned-merge signals — checked for every linked worktree
    // (named branch OR detached HEAD), never on the root clone.
    hasLiveSession: !isRoot ? isWorktreeSessionLive(wtPath, { ttlMs }) : false,
    hasActiveProcessCwd: !isRoot ? pathHasActiveProcessCwd(runtimeOpts.activeCwds, wtPath) : false,
    isFreshCheckout: !isRoot && !runtimeOpts.allowFresh
      ? isFreshCheckoutAtOriginMain(root, wtPath, { freshGraceMs: runtimeOpts.freshGraceMs })
      : false,
    midMerge: !isRoot ? isMidMerge(wtPath) : false,
    // Platform-owned liveness. The heartbeat above only exists for Claude Code;
    // the Workroom claim is written by every surface, so it answers for all of
    // them — and when it cannot be read we refuse rather than guess.
    hasActiveClaim: !isRoot ? pathHasActiveClaim(claims.activePaths, wtPath) : false,
    claimSourceUnavailable: !isRoot ? !claims.available : false,
    claimSourceReason: claims.reason,
    hasUnpushedCommits: detachedUnpushed.hasUnpushedCommits,
    unpushedCommitsUnknown: detachedUnpushed.unpushedCommitsUnknown,
  };
}

/**
 * Classify a directory's `.git` entry without exists-then-open.
 * A file is opened once (O_NOFOLLOW where the platform has it) and read
 * through that descriptor. A directory open fails on Windows, so a failed
 * open is confirmed with one lstat and never followed by a read of the path.
 */
function inspectGitEntry(gitEntry) {
  const empty = { gitKind: "none", gitdirTarget: null, gitdirTargetExists: false };
  const nofollow = fsConstants.O_NOFOLLOW;
  let fd;
  try {
    fd = openSync(gitEntry, nofollow ? (fsConstants.O_RDONLY | nofollow) : "r");
  } catch (err) {
    const code = err && err.code;
    if (code === "EISDIR" || code === "EPERM" || code === "EACCES") {
      try {
        if (lstatSync(gitEntry).isDirectory()) return { ...empty, gitKind: "dir" };
      } catch {
        // The entry disappeared between the failed open and the lstat.
      }
    }
    return empty;
  }
  try {
    const st = fstatSync(fd);
    if (st.isDirectory()) return { ...empty, gitKind: "dir" };
    if (!st.isFile()) return empty;
    const raw = readFileSync(fd, "utf8").trim();
    const match = raw.match(/^gitdir:\s*(.+)$/m);
    if (!match) return { ...empty, gitKind: "file" };
    const gitdirTarget = match[1].trim();
    const targetPath = path.isAbsolute(gitdirTarget) ? gitdirTarget : path.resolve(path.dirname(gitEntry), gitdirTarget);
    let gitdirTargetExists = false;
    try {
      lstatSync(targetPath);
      gitdirTargetExists = true;
    } catch {
      gitdirTargetExists = false;
    }
    return { gitKind: "file", gitdirTarget, gitdirTargetExists };
  } finally {
    closeSync(fd);
  }
}

/**
 * Scan the canonical sibling worktree directory (e.g. `../dpf-worktrees`) for
 * unregistered orphan directories that git no longer tracks. Never mutates or
 * deletes anything; foreign repositories and linked worktrees belonging to
 * other repos are excluded by `classifyOrphanDirectory`.
 */

export function scanOrphanDirectories(root, entries, claims, options = {}) {
  const baseDir = options.worktreeBase
    ? path.resolve(options.worktreeBase)
    : resolveWorktreeBase({ rootClone: root, env: options.env ?? process.env }).base;
  const t3RepoBase = options.includeT3Base === false
    ? null
    : path.join(options.homeDir ?? os.homedir(), ".t3", "worktrees", path.basename(path.resolve(root)));
  const candidateBases = [baseDir, ...(options.extraBases ?? []), ...(t3RepoBase ? [t3RepoBase] : [])]
    .filter(Boolean)
    .map((b) => path.resolve(b))
    .filter((b, i, arr) => arr.indexOf(b) === i);
  if (candidateBases.length === 0) {
    return { baseDir, scannedBases: [], orphans: [] };
  }
  const scannedBases = [];
  const nowMs = options.nowMs ?? Date.now();
  const registered = new Set(entries.map((e) => normalizePath(path.resolve(e.path))));
  const orphans = [];
  for (const scanBase of candidateBases) {
    let dirEntries;
    try {
      dirEntries = readdirSync(scanBase, { withFileTypes: true });
    } catch (err) {
      if (err && err.code !== "ENOENT") scannedBases.push(scanBase);
      continue;
    }
    scannedBases.push(scanBase);
    for (const dirent of dirEntries) {
      if (!dirent.isDirectory()) continue;
      const full = path.join(scanBase, dirent.name);
      if (registered.has(normalizePath(path.resolve(full)))) continue;

      let ageDaysVal = 0;
      try {
        const st = lstatSync(full);
        ageDaysVal = Math.max(0, Math.floor((nowMs - st.mtimeMs) / 86400000));
      } catch {
        // keep 0
      }

      let children = [];
      try {
        children = readdirSync(full);
      } catch {
        // unreadable
      }
      const empty = children.length === 0;
      const pinned = existsSync(path.join(full, ".worktree-pinned"));
      const hasActiveClaim = pathHasActiveClaim(claims?.activePaths, full);

      const gitEntry = path.join(full, ".git");
      const inspected = inspectGitEntry(gitEntry);
      const gitKind = inspected.gitKind;
      const gitdirTarget = inspected.gitdirTarget;
      const gitdirTargetExists = inspected.gitdirTargetExists;

      const classified = classifyOrphanDirectory({
        path: full,
        name: dirent.name,
        root,
        ageDays: ageDaysVal,
        empty,
        pinned,
        hasActiveClaim,
        gitKind,
        gitdirTarget,
        gitdirTargetExists,
      });
      if (classified) orphans.push(classified);
    }
  }
  orphans.sort((a, b) => a.path.localeCompare(b.path));
  return { baseDir, scannedBases, orphans };
}

/**
 * Pin an unpushed detached HEAD commit under refs/janitor-backup/<date>/detached-<slug>
 * before live Tier-B removal so no commit can be orphaned from the object store.
 */
export function backupUnpushedDetachedHead(root, wtPath, date = new Date().toISOString().slice(0, 10), git = runGit) {
  const count = git(["rev-list", "--count", "HEAD", "--not", "--remotes"], wtPath);
  const unpushed = Number(count.stdout);
  if (!count.ok || !Number.isInteger(unpushed)) {
    return { ok: false, ref: null, unpushed: null, reason: "cannot count unpushed detached commits" };
  }
  if (unpushed === 0) return { ok: true, ref: null, unpushed: 0 };
  const slug = path.basename(wtPath).replace(/[^A-Za-z0-9._-]+/g, "-") || "detached";
  const ref = `refs/janitor-backup/${date}/detached-${slug}`;
  const tip = git(["rev-parse", "HEAD"], wtPath);
  const write = tip.ok && tip.stdout ? git(["update-ref", ref, tip.stdout], root) : tip;
  if (!write.ok) return { ok: false, ref, unpushed, reason: `could not write ${ref}` };
  return { ok: true, ref, unpushed };
}

/**
 * BI-EBBBDF40 — a Tier B branch is unmerged, and `branch -D` leaves commits that
 * are on no remote reachable only from the reflog. Pin such a tip at
 * refs/janitor-backup/<date>/<branch> first. `ok: false` means the branch has
 * (or may have) unpushed commits and no backup was written: keep the worktree.
 */
export function backupUnpushedBranch(root, branch, date = new Date().toISOString().slice(0, 10), git = runGit) {
  const count = git(["rev-list", "--count", `refs/heads/${branch}`, "--not", "--remotes"], root);
  const unpushed = Number(count.stdout);
  if (!count.ok || !Number.isInteger(unpushed)) {
    return { ok: false, ref: null, unpushed: null, reason: "cannot count unpushed commits" };
  }
  if (unpushed === 0) return { ok: true, ref: null, unpushed: 0 };
  const ref = `refs/janitor-backup/${date}/${branch}`;
  const tip = git(["rev-parse", `refs/heads/${branch}`], root);
  const write = tip.ok && tip.stdout ? git(["update-ref", ref, tip.stdout], root) : tip;
  if (!write.ok) return { ok: false, ref, unpushed, reason: `could not write ${ref}` };
  return { ok: true, ref, unpushed };
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
      `[worktree-janitor] Workroom claims UNREADABLE (${sanitizeForLog(claims.reason)}) — every worktree will be ` +
        "kept. A reaper that cannot ask who is working must not decide that nobody is.",
    );
  }
  const ttlMs = heartbeatTtlMs(process.env);
  const freshMins = Number(process.env.DPF_WORKTREE_FRESH_GRACE_MIN);
  const freshGraceMs = Number.isFinite(freshMins) && freshMins >= 0 ? freshMins * 60_000 : DEFAULT_FRESH_GRACE_MS;
  const activeCwds = loadActiveProcessCwds();
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
    const facts = gatherFacts(root, entry, prIndex, leasePayload, ttlMs, claims, {
      activeCwds,
      allowFresh: args.allowFresh,
      freshGraceMs,
    });
    const { verdict, reason, tier } = classifyWorktree(facts, {
      graceDays: args.graceDays,
      pruneDetached: args.pruneDetached,
      detachedGraceDays: args.detachedGraceDays,
    });
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
      const backup = verdict === "PRUNE_TIER_B"
        ? (facts.branch
            ? backupUnpushedBranch(root, facts.branch)
            : backupUnpushedDetachedHead(root, facts.path))
        : null;
      if (backup && !backup.ok) {
        console.error(
          `[worktree-janitor] KEEP ${sanitizeForLog(facts.path)}: ${sanitizeForLog(backup.reason)} for ${sanitizeForLog(facts.branch ?? "detached HEAD")}`,
        );
        removals.push({ path: facts.path, branch: facts.branch, worktreeRemoved: false, branchDeleted: false, backup });
        continue;
      }
      if (backup?.ref) {
        console.error(
          `[worktree-janitor] backed up ${backup.unpushed} unpushed commit(s) of ${sanitizeForLog(facts.branch ?? "detached HEAD")} at ${backup.ref}`,
        );
      }
      const result = removeWorktree(root, facts.path, facts.branch);
      removals.push({ path: facts.path, branch: facts.branch, ...result, ...(backup ? { backup } : {}) });
    }
  }

  const orphanScan = args.branch
    ? { baseDir: null, orphans: [] }
    : scanOrphanDirectories(root, entries, claims, { worktreeBase: args.worktreeBase });
  const summary = summarizeDecisions(decisions, orphanScan.orphans);
  const report = {
    mode: args.dryRun ? "dry-run" : "live",
    available: true,
    root,
    worktreeBase: orphanScan.baseDir,
    graceDays: args.graceDays,
    pruneDetached: args.pruneDetached,
    detachedGraceDays: args.detachedGraceDays,
    policy,
    // Why every claim-dependent tree was kept, or how ownership was proven (BI-83345811).
    claims: { available: claims.available, reason: claims.reason },
    decisions,
    orphanDirs: orphanScan.orphans,
    summary,
    removals: args.dryRun ? [] : removals,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  console.log(
    `\nWorktree janitor — ${report.mode} (grace=${args.graceDays}d, policy=${policy}, pruneDetached=${args.pruneDetached})\n`,
  );
  for (const d of decisions) {
    console.log(`  ${d.verdict.padEnd(12)} ${sanitizeForLog(d.path)}  (${sanitizeForLog(d.reason)})`);
  }
  for (const p of summary.flaggedPaths ?? []) {
    console.log(`  [flag]  abandoned mid-merge (MERGE_HEAD, no live session): ${p} — quarantined, never auto-reaped`);
  }
  if (orphanScan.orphans.length > 0) {
    console.log(`\nUnregistered orphan directories in ${sanitizeForLog(orphanScan.baseDir ?? "")} (${orphanScan.orphans.length}):`);
    for (const o of orphanScan.orphans) {
      const notes = [o.kind, `${o.ageDays}d`, ...(o.pinned ? ["pinned"] : []), ...(o.hasActiveClaim ? ["active-claim"] : [])];
      console.log(`  ORPHAN       ${sanitizeForLog(o.path)}  (${notes.join(", ")})`);
    }
  }
  console.log(
    `\nSummary: TierA=${summary.counts.PRUNE_TIER_A} TierB=${summary.counts.PRUNE_TIER_B} ` +
      `KEEP=${summary.counts.KEEP} SKIP=${summary.counts.SKIP} PINNED=${summary.counts.PINNED} ` +
      `FLAG_ABANDONED_MERGE=${summary.counts.FLAG_ABANDONED_MERGE ?? 0} ` +
      `ORPHANS=${summary.orphanCount ?? 0}`,
  );
  if (args.dryRun) console.log("\n(Dry run — nothing removed. Pass --live to prune.)\n");
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}

export { main, loadLeasePaths, pathHasLease };
