#!/usr/bin/env node
// Pre-PR readiness orchestrator for external agents.
//
// `pr-health` answers "is an existing GitHub PR merge-ready?" This script
// answers the earlier question: "is this local branch ready to become or re-enter
// a PR without letting GitHub Actions discover the first obvious blocker?"

import { parseArgs as utilParseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { buildGatePlan, evaluateReadiness, formatReadinessReport } from "./pr-readiness/core.mjs";
import { collectWorktreeDiff } from "./gate-context.mjs";
import { resolvePolicyGuardInvocation } from "./lib/ci-policy-guards.mjs";
import { buildGateContext } from "./lib/gate-context.mjs";
import { fetchOriginMainSharedSafe, isShallowRepository } from "./lib/git-fetch-shared-safe.mjs";
import { isEnvironmentFailureOutput } from "./lib/pregate-preflight.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import { GitCommandError, runGit } from "./lib/git.mjs";

function git(args, { allowFail = false } = {}) {
  const result = runGit(args, { cwd: process.cwd(), maxBuffer: 32 * 1024 * 1024 });
  if (result.ok || allowFail) return result.stdout;
  throw new GitCommandError(args, result);
}

function parseArgs(argv) {
  const options = {
    "pr-body-file": { type: "string" },
    "pr-body": { type: "string" },
    "labels-json": { type: "string" },
    "skip-gates": { type: "boolean" },
    "published-ref": { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  };
  // strict: false plus the token check keeps the old message for unknown input and
  // still accepts a --pr-body that starts with "-" (a markdown list, say).
  const { values, tokens } = utilParseArgs({ args: argv.slice(2), options, strict: false, allowPositionals: true, tokens: true });
  const unknown = tokens.find((token) => token.kind !== "option" || !Object.hasOwn(options, token.name));
  if (unknown) throw new Error(`Unknown argument: ${unknown.rawName ?? unknown.value ?? "--"}`);
  // A value flag given last with nothing after it falls back as before.
  const text = (name, fallback) => (typeof values[name] === "string" ? values[name] : fallback);
  const args = {
    prBody: process.env.PR_BODY || "",
    prLabelsJson: values["labels-json"] === undefined ? process.env.PR_LABELS_JSON || "[]" : text("labels-json", "[]"),
    runGates: values["skip-gates"] !== true,
    json: values.json === true,
    publishedRef: values["published-ref"] === undefined ? null : text("published-ref", ""),
  };
  // Every --pr-body-file is read, as before; the body flag given last wins.
  if (values["pr-body-file"] !== undefined) args.prBody = readFileSync(text("pr-body-file", undefined), "utf8");
  const lastBody = tokens.findLast((token) => token.name === "pr-body" || token.name === "pr-body-file");
  if (lastBody?.name === "pr-body") args.prBody = text("pr-body", "");
  if (values.help) args.help = true;
  return args;
}

function usage() {
  return [
    "Usage: node scripts/pr-readiness.mjs [--pr-body-file path | --pr-body text] [--labels-json json] [--published-ref ref] [--json] [--skip-gates]",
    "",
    "Runs local pre-PR governance checks against the exact diff from current origin/main to HEAD.",
    "Exit 0 means safe to open or queue the PR. Exit 1 means fix the listed blockers first.",
  ].join("\n");
}

function readCommits() {
  const raw = git(["log", "origin/main..HEAD", "--format=%H%x1f%s%x1f%an%x1f%ae%x1f%B%x1e"], { allowFail: true });
  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, authorName, authorEmail, ...bodyParts] = entry.split("\x1f");
      return {
        sha: sha ?? "",
        subject: subject ?? "",
        authorName: authorName ?? "",
        authorEmail: authorEmail ?? "",
        body: bodyParts.join("\x1f"),
      };
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

function readRepoState(publishedRef = null) {
  fetchOriginMainSharedSafe((args) => git(args));

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const headSha = git(["rev-parse", "HEAD"]).trim();
  const publishedSha = publishedRef
    ? git(["rev-parse", "--verify", publishedRef], { allowFail: true }).trim()
    : "";
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
    publishedRef,
    publishedRefMatchesHead: Boolean(publishedRef) && publishedSha === headSha,
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
    repo = readRepoState(args.publishedRef);
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
  if (args.json) {
    process.stdout.write(`DPF_PR_READINESS_JSON=${JSON.stringify({
      ready: verdict.ready,
      blockers: verdict.blockers,
      warnings: verdict.warnings,
      branch: verdict.branch,
      changedFiles: verdict.changedFiles,
    })}\n`);
  }
  process.exit(verdict.ready ? 0 : 1);
}

if (isEntryModule(import.meta.url)) main();
