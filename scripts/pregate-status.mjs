#!/usr/bin/env node
// scripts/pregate-status.mjs — `pnpm run pregate:status` (BI-B1065D41 Phase 2).
//
// The one authoritative answer to "did the gate pass for what I am about to
// push?". It reads the records the gate already wrote — it never runs a gate,
// never claims a lease, and never talks to the portal, so it is safe to call at
// any moment including while another session's gate is mid-run.
//
// Read scripts/lib/pregate-status.mjs for WHY a reader exists at all: the exit
// code, the log tail, and even `^gate passed` each lie in a documented
// direction, and each has been paid for at least once.
//
// Exit code: 0 only when the verdict is PASS for the current HEAD. That makes
// `pnpm run pregate:status && git push` a correct composition — which the raw
// pregate exit code never was.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLocalCiSlotManifest,
  LOCAL_CI_SLOT_KEYS,
} from "./lib/local-ci-slot-manifest.mjs";
import {
  classifySlotRecord,
  exitCodeForVerdict,
  formatStatusReport,
  reconcileSlots,
} from "./lib/pregate-status.mjs";
import { installBrokenPipeTolerance } from "./lib/pregate-console.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);

function gitText(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function resolveWorktreeContext(cwd = process.cwd()) {
  const worktreePath = gitText(["rev-parse", "--show-toplevel"], cwd);
  if (!worktreePath) return null;
  const gitCommonDirRaw = gitText(["rev-parse", "--git-common-dir"], worktreePath);
  const statePathRaw = gitText(["rev-parse", "--git-path", "dpf-local-ci-gate.json"], worktreePath);
  if (!gitCommonDirRaw || !statePathRaw) return null;
  const gitCommonDir = resolvePath(worktreePath, gitCommonDirRaw);
  return {
    worktreePath,
    gitCommonDir,
    rootClone: dirname(gitCommonDir),
    candidateGitDir: dirname(resolvePath(worktreePath, statePathRaw)),
    headBranch: gitText(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath),
    headSha: gitText(["rev-parse", "HEAD"], worktreePath),
  };
}

/** Read and classify every slot's records for this worktree. */
export function collectSlotVerdicts(context, { now = Date.now(), readJsonImpl = readJson } = {}) {
  return LOCAL_CI_SLOT_KEYS.map((slotKey) => {
    const manifest = createLocalCiSlotManifest({
      slotKey,
      rootClone: context.rootClone,
      gitCommonDir: context.gitCommonDir,
      candidateGitDir: context.candidateGitDir,
    });
    const state = readJsonImpl(manifest.evidence.state);
    // No state at all means this slot never ran here — it is absent, not failing.
    // Only slots with a record participate, so an unused slot cannot drag the
    // reconciled verdict down to NO-RECORD while the other slot holds a PASS.
    if (!state) return null;
    return {
      slotKey,
      logFile: manifest.output.log,
      ...classifySlotRecord({
        state,
        metadata: readJsonImpl(manifest.evidence.metadata),
        headSha: context.headSha,
        headBranch: context.headBranch,
        now,
      }),
    };
  }).filter(Boolean);
}

function main() {
  installBrokenPipeTolerance();
  const asJson = process.argv.slice(2).includes("--json");

  const context = resolveWorktreeContext();
  if (!context) {
    process.stderr.write("pregate:status: not inside a git worktree (or git is unavailable).\n");
    process.exit(1);
  }

  const slots = collectSlotVerdicts(context);
  const result = slots.length > 0
    ? reconcileSlots(slots)
    : {
      verdict: "NO-RECORD",
      reason: "no gate record for this worktree — pregate has not run here",
      slot: null,
    };

  if (asJson) {
    process.stdout.write(`${JSON.stringify({
      verdict: result.verdict,
      reason: result.reason,
      headBranch: context.headBranch,
      headSha: context.headSha,
      boundSha: result.boundSha ?? "",
      boundBranch: result.boundBranch ?? "",
      candidateSha: result.candidateSha ?? "",
      staleness: result.staleness ?? "",
      evidenceId: result.evidenceId ?? "",
      recordedAt: result.recordedAt ?? "",
      slot: result.slot,
      logFile: result.logFile ?? "",
      worktreePath: context.worktreePath,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatStatusReport(result, {
      headBranch: context.headBranch,
      headSha: context.headSha,
    }).join("\n")}\n`);
  }

  process.exit(exitCodeForVerdict(result.verdict));
}

if (process.argv[1] === THIS_FILE) main();
