#!/usr/bin/env node
// Pre-PR readiness orchestrator for external agents.
//
// `pr-health` answers "is an existing GitHub PR merge-ready?" This script
// answers the earlier question: "is this local branch ready to become or re-enter
// a PR without letting GitHub Actions discover the first obvious blocker?"

import { parseArgs as utilParseArgs } from "node:util";
import { scriptArgv } from "./lib/script-argv.mjs";
import { readFileSync } from "node:fs";

import { buildGatePlan, evaluateReadiness, formatReadinessReport } from "./pr-readiness/core.mjs";
import { collectWorktreeDiff } from "./gate-context.mjs";
import { buildGateContext } from "./lib/gate-context.mjs";
import { fetchOriginMainSharedSafe, isShallowRepository } from "./lib/git-fetch-shared-safe.mjs";
import { createDefaultExecute, isEnvironmentFailureOutput } from "./lib/pregate-preflight.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import { GitCommandError, runGit } from "./lib/git.mjs";
import { guardReceiptDirectory, identifyGuardExecution, runWithGuardReceipt } from "./lib/pregate-preflight-receipt.mjs";
import { resolveWorktreeContext } from "./pregate-status.mjs";
import { LOCAL_CI_SLOT_KEYS, createLocalCiSlotManifest } from "./lib/local-ci-slot-manifest.mjs";
import { readLocalCiGateState } from "./lib/local-ci-gate-state.mjs";
import { classifyChangedFiles } from "./ci-change-scope.mjs";
import { verifyPublishedCorrection, readPublishedContext, inspectCorrectionRecord } from "./published-correction.mjs";

export function readPublicationGateRecords(context = resolveWorktreeContext(), read = readLocalCiGateState, inspect = inspectCorrectionRecord) {
  if (!context) return [];
  const records = LOCAL_CI_SLOT_KEYS.map(slotKey => {
    const manifest = createLocalCiSlotManifest({ slotKey, ...context });
    return { state: read(manifest.evidence.state), metadata: read(manifest.evidence.metadata) };
  });
  const inspected = inspect();
  if (inspected.ok) records.push({ state: inspected.state, metadata: null, publicationInspection: inspected });
  return records;
}

function git(args, { allowFail = false, cwd = process.cwd() } = {}) {
  const result = runGit(args, { cwd, maxBuffer: 32 * 1024 * 1024 });
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
  const { values, tokens } = utilParseArgs({ args: scriptArgv(argv.slice(2)), options, strict: false, allowPositionals: true, tokens: true });
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

function readCommits({ baseSha, headSha }, git) {
  const raw = git(["log", `${baseSha}..${headSha}`, "--format=%H%x1f%s%x1f%an%x1f%ae%x1f%B%x1e"], { allowFail: true });
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

function readAheadBehind(upstream, { baseSha, headSha }, git) {
  if (!upstream) {
    const ahead = Number.parseInt(git(["rev-list", "--count", `${baseSha}..${headSha}`], { allowFail: true }).trim() || "0", 10);
    return { ahead, behind: 0 };
  }
  const [behind, ahead] = git(["rev-list", "--left-right", "--count", `${upstream}...${headSha}`], { allowFail: true })
    .trim()
    .split(/\s+/)
    .map((n) => Number.parseInt(n || "0", 10));
  return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 };
}

export function readRepoState(publishedRef = null, { cwd = process.cwd(), fetch = fetchOriginMainSharedSafe } = {}) {
  const readGit = (args, options) => git(args, { ...options, cwd });
  fetch((args) => readGit(args));
  const baseSha = readGit(["rev-parse", "--verify", "origin/main^{commit}"]).trim();

  const branch = readGit(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const headSha = readGit(["rev-parse", "HEAD"]).trim();
  const publishedSha = publishedRef
    ? readGit(["rev-parse", "--verify", publishedRef], { allowFail: true }).trim()
    : "";
  const upstream = readGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { allowFail: true }).trim();
  const source = { baseSha, headSha };
  const aheadBehind = readAheadBehind(upstream, source, readGit);
  const mergeBases = readGit(["merge-base", "--all", baseSha, headSha], { allowFail: true })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const worktreeDiff = collectWorktreeDiff({ base: baseSha, head: headSha, cwd });
  const changedFiles = worktreeDiff.changedFiles.map((entry) => entry.path);

  return {
    branch,
    baseSha,
    headSha,
    isDetached: branch === "HEAD",
    isShallow: isShallowRepository((args) => readGit(args)),
    mergeBases,
    changedFiles,
    changedFileEntries: worktreeDiff.changedFiles,
    addedLinesByFile: worktreeDiff.addedLinesByFile,
    statusPorcelain: readGit(["status", "--porcelain"], { allowFail: true }),
    upstream: upstream || null,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    commits: readCommits(source, readGit),
    publishedRef,
    publishedRefMatchesHead: Boolean(publishedRef) && publishedSha === headSha,
  };
}

export async function runGate(gate, { progress, signal } = {}) {
  const [command, args] = gate.command;
  const execute = createDefaultExecute({ ...process.env, ...gate.env }, { progress, signal });
  const result = await execute(command, args, { guardName: gate.name });
  const output = result.output.trim();
  return {
    name: gate.name,
    ok: result.exitCode === 0 && !result.outcome,
    skippedEnvironment: !result.outcome && result.exitCode !== 0 && isEnvironmentFailureOutput(output),
    outcome: result.outcome,
    exitCode: result.exitCode,
    output,
  };
}

export async function verifyCurrentPublication({ contextReader = readPublishedContext, verify = verifyPublishedCorrection } = {}) {
  let publishedContext;
  try { publishedContext = contextReader(); } catch { /* Initial publication retains its existing path. */ }
  if (publishedContext) {
    const state = publishedContext.pullRequest?.state;
    if (state === "MERGED" || state === "CLOSED") return;
    if (state !== "OPEN") throw new Error("Published PR state is unproven; inspect the GitHub context before publication.");
    let observed = false;
    await verify({ contextReader: () => {
      if (!observed) { observed = true; return publishedContext; }
      return contextReader();
    } });
  }
}

async function main() {
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

  if (args.runGates) {
    try { await verifyCurrentPublication(); }
    catch (error) {
      console.error(`PR readiness: NOT READY. ${error.message} No broad local guard or integration rerun was started.`);
      process.exitCode = 1;
      return;
    }
  }
  const inspected = inspectCorrectionRecord();
  const proportional = inspected.ok;
  const gatePlan = buildGatePlan({ prBody: args.prBody, prLabelsJson: args.prLabelsJson, changeScope: classifyChangedFiles(repo.changedFiles), publishedCorrection: proportional, baseSha: repo.baseSha, headSha: repo.headSha });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  let execution;
  try { execution = args.runGates ? await runWithGuardReceipt({
    directory: guardReceiptDirectory(),
    stage: "pr-readiness",
    identify: () => identifyGuardExecution({ plan: gatePlan, source: { baseSha: repo.baseSha, headSha: repo.headSha } }),
    execute: async ({ progress }) => {
      const results = [];
      for (const gate of gatePlan) results.push(await runGate(gate, { progress, signal: controller.signal }));
      return results;
    },
    passed: results => Array.isArray(results) && results.length === gatePlan.length && results.every(result => result.ok && !result.skippedEnvironment),
  }) : { result: [], reused: false }; } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
  const gateResults = execution.result;
  const gateContext = buildGateContext({
    changedFiles: repo.changedFileEntries,
    addedLinesByFile: repo.addedLinesByFile,
  });
  // Read proof outside guard receipt reuse; publication metadata is always fresh.
  repo.publicationIdentityChanged = git(["rev-parse", "HEAD"]).trim() !== repo.headSha
    || git(["rev-parse", "--abbrev-ref", "HEAD"]).trim() !== repo.branch;
  repo.statusPorcelain = git(["status", "--porcelain"]);
  const latestBaseSha = git(["rev-parse", "--verify", "origin/main^{commit}"], { allowFail: true }).trim() || null;
  const verdict = evaluateReadiness({ repo, gateResults, prBody: args.prBody, gateContext, localCiRecords: readPublicationGateRecords() });
  if (latestBaseSha !== repo.baseSha) verdict.notes.push(`origin/main is now ${latestBaseSha ?? "unavailable"}; these checks cover pinned base ${repo.baseSha}, not the newer main. Protected GitHub checks remain the integration authority.`);
  if (proportional) verdict.notes.push("Published correction: fresh repository/DCO/metadata guards run locally; broad source guards and full integration delegated to protected GitHub, not rerun locally.");
  if (args.runGates && !execution.identityVerified) {
    verdict.ready = false;
    verdict.blockers.push("Host guard execution lacks a complete unchanged source/environment identity; inspect its receipt and recover those prerequisites before publication.");
  }
  if (execution.reused) verdict.notes.push(`Local guard results reused from ${execution.executedAt}; no guard scripts rerun. Repository and PR metadata inspected now. Protected GitHub checks remain the integration authority.`);
  process.stdout.write(formatReadinessReport(verdict));
  if (args.json) {
    process.stdout.write(`DPF_PR_READINESS_JSON=${JSON.stringify({
      ready: verdict.ready,
      blockers: verdict.blockers,
      warnings: verdict.warnings,
      notes: verdict.notes,
      branch: verdict.branch,
      source: { baseSha: repo.baseSha, headSha: repo.headSha, latestBaseSha },
      changedFiles: verdict.changedFiles,
      localGuards: {
        reused: execution.reused,
        executedAt: execution.executedAt ?? null,
        executedCount: execution.reused ? 0 : gateResults.length,
        reusedCount: execution.reused ? gateResults.length : 0,
      },
    })}\n`);
  }
  process.exit(verdict.ready ? 0 : 1);
}

if (isEntryModule(import.meta.url)) await main();
