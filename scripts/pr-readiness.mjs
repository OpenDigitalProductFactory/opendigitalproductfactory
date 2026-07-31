#!/usr/bin/env node
// Pre-PR readiness orchestrator for external agents.
//
// `pr-health` answers "is an existing GitHub PR merge-ready?" This script
// answers the earlier question: "is this local branch ready to become or re-enter
// a PR without letting GitHub Actions discover the first obvious blocker?"

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildGatePlan, evaluateReadiness, formatReadinessReport } from "./pr-readiness/core.mjs";
import { collectWorktreeDiff } from "./gate-context.mjs";
import { resolvePolicyGuardInvocation } from "./lib/ci-policy-guards.mjs";
import { buildGateContext } from "./lib/gate-context.mjs";
import { fetchOriginMainSharedSafe, isShallowRepository } from "./lib/git-fetch-shared-safe.mjs";
import { isEnvironmentFailureOutput } from "./lib/pregate-preflight.mjs";

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    if (allowFail) return error.stdout?.toString() ?? "";
    throw error;
  }
}

function parseArgs(argv) {
  const args = { prBody: process.env.PR_BODY || "", prLabelsJson: process.env.PR_LABELS_JSON || "[]", runGates: true };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pr-body-file") {
      args.prBody = readFileSync(argv[++i], "utf8");
    } else if (arg === "--pr-body") {
      args.prBody = argv[++i] ?? "";
    } else if (arg === "--labels-json") {
      args.prLabelsJson = argv[++i] ?? "[]";
    } else if (arg === "--skip-gates") {
      args.runGates = false;
    } else if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: node scripts/pr-readiness.mjs [--pr-body-file path | --pr-body text] [--labels-json json] [--skip-gates]",
    "",
    "Runs local pre-PR governance checks against the exact diff from current origin/main to HEAD.",
    "Exit 0 means safe to open or queue the PR. Exit 1 means fix the listed blockers first.",
  ].join("\n");
}

function readCommits() {
  const raw = git(["log", "origin/main..HEAD", "--format=%H%x1f%s%x1f%B%x1e"], { allowFail: true });
  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, ...bodyParts] = entry.split("\x1f");
      return { sha: sha ?? "", subject: subject ?? "", body: bodyParts.join("\x1f") };
    });
}

function readAheadBehind(upstream) {
  if (!upstream) {
    const ahead = Number.parseInt(git(["rev-list", "--count", "origin/main..HEAD"], { allowFail: true }).trim() || "0", 10);
    return { ahead, behind: 0 };
  }
  const [behind, ahead] = git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], { allowFail: true })
    .trim()
    .split(/\s+/)
    .map((n) => Number.parseInt(n || "0", 10));
  return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 };
}

function readRepoState() {
  fetchOriginMainSharedSafe((args) => git(args));

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { allowFail: true }).trim();
  const aheadBehind = readAheadBehind(upstream);
  const mergeBases = git(["merge-base", "--all", "origin/main", "HEAD"], { allowFail: true })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const worktreeDiff = collectWorktreeDiff({ base: "origin/main" });
  const changedFiles = worktreeDiff.changedFiles.map((entry) => entry.path);

  return {
    branch,
    isDetached: branch === "HEAD",
    isShallow: isShallowRepository((args) => git(args)),
    mergeBases,
    changedFiles,
    changedFileEntries: worktreeDiff.changedFiles,
    addedLinesByFile: worktreeDiff.addedLinesByFile,
    statusPorcelain: git(["status", "--porcelain"], { allowFail: true }),
    upstream: upstream || null,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    commits: readCommits(),
  };
}

function runGate(gate) {
  const [command, args] = gate.command;
  const invocation = resolvePolicyGuardInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...gate.env },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join("\n")
    .trim();
  return {
    name: gate.name,
    ok: result.status === 0,
    skippedEnvironment: result.status !== 0 && isEnvironmentFailureOutput(output),
    exitCode: result.status ?? 1,
    output,
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(`pr-readiness: ${error.message}`);
    console.error(usage());
    process.exit(2);
  }
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  let repo;
  try {
    repo = readRepoState();
  } catch (error) {
    console.error(`pr-readiness: could not read repository state: ${error.message}`);
    process.exit(2);
  }

  const gatePlan = buildGatePlan({ prBody: args.prBody, prLabelsJson: args.prLabelsJson });
  const gateResults = args.runGates ? gatePlan.map(runGate) : [];
  const gateContext = buildGateContext({
    changedFiles: repo.changedFileEntries,
    addedLinesByFile: repo.addedLinesByFile,
  });
  const verdict = evaluateReadiness({ repo, gateResults, prBody: args.prBody, gateContext });
  process.stdout.write(formatReadinessReport(verdict));
  process.exit(verdict.ready ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
