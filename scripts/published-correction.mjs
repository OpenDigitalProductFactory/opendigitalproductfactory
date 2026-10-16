#!/usr/bin/env node
// Existing-PR publication policy. No sandbox lease and no integration PASS.
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gitText } from "./lib/git.mjs";
import { resolveHostCommandInvocation } from "./lib/host-command-invocation.mjs";
import { guardShellEnv } from "./lib/guard-bash.mjs";
import { createStageReceiptWriter, readStageReceipt, stageIdentityMatches } from "./lib/local-ci-stage-receipt.mjs";
import { guardReceiptDirectory, identifyGuardExecution } from "./lib/pregate-preflight-receipt.mjs";
import { createEvidencePlan, loadEvidencePolicy } from "./lib/ci-evidence-plan.mjs";
import { LOCAL_CI_SLOT_KEYS, createLocalCiSlotManifest } from "./lib/local-ci-slot-manifest.mjs";
import { resolveWorktreeContext } from "./pregate-status.mjs";
import { readLocalCiGateState } from "./lib/local-ci-gate-state.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import { acquireLocalConvergenceLock, releaseLocalConvergenceLock } from "./lib/local-convergence-lock.mjs";
import { CORRECTION_POLICY, CORRECTION_TTL_MS, classifyInitialPublication, classifyPublishedCorrection, correctionPlanDigest } from "../packages/dpf-skill-pack/hooks/lib/published-correction.mjs";

const STAGE = "published-correction";
export const correctionReceiptPath = cwd => join(guardReceiptDirectory(cwd), `${correctionPlanDigest(STAGE)}.json`);
export function readCorrectionRecord(cwd = process.cwd(), candidateGitDir = null) {
  try {
    const path = candidateGitDir ? join(candidateGitDir, "dpf-host-guard-receipts", `${correctionPlanDigest(STAGE)}.json`) : correctionReceiptPath(cwd);
    const receipt = readStageReceipt(path);
    return receipt?.stage === STAGE && receipt.status === "passed" ? receipt.result : null;
  } catch { return null; }
}

function execute(command, args, { cwd = process.cwd(), env = process.env, timeout = 30_000 } = {}) {
  const invocation = resolveHostCommandInvocation(command, args, { env });
  const childEnv = { ...guardShellEnv(env) };
  // This is a separate execution, including when its adapter is tested under
  // node:test. Inheriting this private parent marker makes Node skip the child.
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(invocation.command, invocation.args, { cwd, env: childEnv,
    encoding: "utf8", timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { exitCode: result.status ?? -1, outcome: result.error?.code ?? result.signal ?? null,
    stdout: result.stdout ?? "", output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
export function qualifyCorrectionExecution(command, result) {
  if (result.exitCode !== 0 || result.outcome) return result;
  if (command.command === "node" && command.args.includes("--test")) {
    const output = String(result.stdout ?? result.output ?? "");
    const count = name => [...output.matchAll(new RegExp(`^# ${name} (\\d+)\\r?$`, "gm"))].at(-1)?.[1];
    const counts = ["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(count);
    if (counts.some(value => value === undefined) || Number(counts[0]) <= 0) return { ...result, outcome: "test-report-unproven" };
    if (Number(counts[1]) !== Number(counts[0]) || counts.slice(2).some(value => Number(value) !== 0)) return { ...result, skipped: Number(counts[3]) > 0, outcome: "test-report-incomplete" };
  }
  if (command.args.includes("vitest")) {
    try {
      const report = JSON.parse(String(result.stdout ?? result.output));
      if (report.numTotalTests <= 0 || report.numFailedTests !== 0 || report.numPendingTests !== 0
        || report.numPassedTests !== report.numTotalTests || report.success !== true) return { ...result, outcome: "test-report-incomplete" };
    } catch { return { ...result, outcome: "test-report-unproven" }; }
  }
  return result;
}
function jsonCommand(command, args, cwd) {
  const result = execute(command, args, { cwd });
  if (result.exitCode !== 0 || result.outcome) throw new Error(`${command} could not read publication identity: ${result.output.slice(-1000)}`);
  return JSON.parse(result.output);
}
export function readPublishedContext(cwd = process.cwd()) {
  const remote = gitText(["remote", "get-url", "origin"], { cwd });
  const match = remote.match(/^(?:https:\/\/([^/]+)\/|git@([^:]+):)([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new Error("Configured origin is not a supported GitHub repository identity.");
  const repositoryHost = match[1] ?? match[2];
  const repositoryFullName = `${match[3]}/${match[4]}`;
  const pr = jsonCommand("gh", ["pr", "view", "--repo", `${repositoryHost}/${repositoryFullName}`, "--json", "number,state,isDraft,headRefName,headRefOid,baseRefName,url"], cwd);
  const rules = jsonCommand("gh", ["api", "--hostname", repositoryHost, `repos/${repositoryFullName}/rules/branches/main`], cwd);
  return { pullRequest: { ...pr, repositoryFullName, repositoryHost }, protection: {
    repositoryFullName, branch: "main", mergeQueue: rules.some(rule => rule.type === "merge_queue"),
    requiredChecks: rules.filter(rule => rule.type === "required_status_checks")
      .flatMap(rule => rule.parameters?.required_status_checks ?? []).map(check => check.context),
    observedAt: new Date().toISOString(),
  } };
}
const contextIdentity = context => ({ pr: context.pullRequest, protection: {
  ...context.protection, observedAt: undefined,
} });

export function inspectCorrectionRecord(cwd = process.cwd(), { contextReader = readPublishedContext, identify = identifyGuardExecution, now = Date.now() } = {}) {
  try {
  const state = readCorrectionRecord(cwd);
  const git = args => gitText(args, { cwd });
  const verdict = classifyPublishedCorrection(state, { sha: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]), tree: git(["rev-parse", "HEAD^{tree}"]), now });
  if (!verdict.ok) return verdict;
  const proof = verdict.proof;
  const planned = describeCorrection({ cwd, anchor: proof.anchor, head: proof.sha, tree: proof.tree, relatedTestsBySource: proof.relatedTestsBySource ?? {} });
  if (correctionPlanDigest(planned.commands) !== proof.planDigest || planned.classification !== proof.classification
    || !stageIdentityMatches(planned.changedFiles, proof.changedFiles)) return { ok: false, reason: "Expected affected plan or cumulative source coverage differs from the recorded command list." };
  const current = contextReader(cwd);
  const expected = { ...current, pullRequest: { ...current.pullRequest, headRefOid: proof.pullRequest.headRefOid } };
  if (![proof.sha, proof.pullRequest.headRefOid].includes(current.pullRequest.headRefOid)
    || !stageIdentityMatches(contextIdentity(expected), contextIdentity({ pullRequest: proof.pullRequest, protection: proof.protection }))) return { ok: false, reason: "Published PR or protection changed; correction proof is not current." };
  const identity = identify({ cwd, plan: proof.commands });
  const rebound = identity ? { ...identity, policy: CORRECTION_POLICY, branch: proof.branch, plan: proof.planDigest } : null;
  if (!stageIdentityMatches(proof.identity, rebound)) return { ok: false, reason: "Source, toolchain, environment or expected plan changed; correction proof cannot be reused." };
  return { ...verdict, state };
  } catch (error) { return { ok: false, reason: `Correction inspection unavailable: ${error.message}` }; }
}

export function chooseInitialAnchor({ records, previous, pullRequest, treeAt, now = Date.now() }) {
  const expected = { repositoryFullName: pullRequest.repositoryFullName, branch: pullRequest.headRefName, pullRequestNumber: pullRequest.number };
  if (previous?.sha === pullRequest.headRefOid && classifyPublishedCorrection(previous, { ...expected, sha: previous.sha, now }).ok) return previous.publicationCorrection.anchor;
  for (const { state, metadata } of records) {
    if (state?.sha !== pullRequest.headRefOid) continue;
    const anchor = { ...expected, sha: state.sha, tree: treeAt(state.sha), state, metadata,
      capturedAt: new Date(now).toISOString() };
    if (classifyInitialPublication(anchor, expected).ok) return anchor;
  }
  throw new Error("No accepted initial-publication anchor covers this published head. Reconcile its existing canonical evidence or permitted initial override; an open PR alone is insufficient.");
}

export function buildCorrectionCommands(plan, { packageScripts = {}, explicitTests = [] } = {}) {
  const tests = [...new Set([...plan.affectedTests, ...explicitTests])].sort();
  const unmapped = plan.fileDispositions.filter(file => file.kind !== "docs" && file.kind !== "test" && !file.tests.length);
  if (unmapped.length) throw new Error(`Affected mapping unresolved for ${unmapped.map(file => file.path).join(", ")}; supply the existing planner's related-test mapping, not a whole local gate.`);
  const commands = [];
  const nodeTests = tests.filter(path => /\.[cm]?js$/.test(path));
  if (nodeTests.length) commands.push({ command: "node", args: ["--test", "--test-reporter=tap", ...nodeTests] });
  for (const [root, pkg] of Object.entries(loadEvidencePolicy().packageRoots)) {
    const files = tests.filter(path => path.startsWith(`${root}/`) && !nodeTests.includes(path));
    if (files.length) commands.push({ command: "pnpm", args: ["--filter", pkg, "exec", "vitest", "run", ...files.map(path => path.slice(root.length + 1)), "--maxWorkers=1", "--reporter=json"] });
    if (plan.affectedPackages.includes(pkg)) {
      const scripts = packageScripts[pkg] ?? {};
      const check = scripts["typecheck:all"] ? "typecheck:all" : scripts.typecheck ? "typecheck" : null;
      if (check) commands.push({ command: "pnpm", args: ["--filter", pkg, "run", check] });
    }
  }
  if (tests.some(path => !nodeTests.includes(path) && !Object.keys(loadEvidencePolicy().packageRoots).some(root => path.startsWith(`${root}/`)))) throw new Error("Unsupported affected-test runner; map the existing package runner explicitly.");
  if (plan.scope.docsOnly) commands.push({ command: "node", args: ["scripts/gen-doc-index.mjs", "--check"] });
  return commands;
}

function localRecords(cwd) {
  const context = resolveWorktreeContext(cwd);
  if (!context) return [];
  return LOCAL_CI_SLOT_KEYS.map(slotKey => {
    const manifest = createLocalCiSlotManifest({ slotKey, ...context });
    return { state: readLocalCiGateState(manifest.evidence.state), metadata: readLocalCiGateState(manifest.evidence.metadata) };
  });
}

export function describeCorrection({ cwd, anchor, head, tree, relatedTestsBySource = {} }) {
  const git = args => gitText(args, { cwd });
  const paths = args => git(args).split(/\r?\n/).filter(Boolean);
  const originalBase = git(["merge-base", anchor.sha, "origin/main"]);
  const currentBase = git(["merge-base", head, "origin/main"]);
  const ownFiles = [...new Set([...paths(["diff", "--name-only", originalBase, anchor.sha]), ...paths(["diff", "--name-only", currentBase, head])])];
  const changedFiles = paths(["diff", "--name-only", anchor.sha, head]).filter(path => ownFiles.includes(path));
  const sameOwnDiff = git(["diff", "--binary", originalBase, anchor.sha]) === git(["diff", "--binary", currentBase, head]);
  const classification = head === anchor.sha ? "unchanged-head" : tree === anchor.tree ? "commit-metadata" : sameOwnDiff ? "main-refresh" : "authored-correction";
  const policy = loadEvidencePolicy();
  // Classify root Node scripts for the existing colocated-test planner without
  // changing cloud policy; all its risk/escalation advice remains recorded.
  policy.patterns.production = [...policy.patterns.production, "^scripts/.*\\.[cm]?[jt]sx?$"];
  const knownTests = paths(["ls-tree", "-r", "--name-only", head]).filter(path => policy.patterns.tests.some(pattern => new RegExp(pattern).test(path)));
  const packageScripts = {};
  for (const [root, pkg] of Object.entries(policy.packageRoots)) {
    try { packageScripts[pkg] = JSON.parse(readFileSync(join(cwd, root, "package.json"), "utf8")).scripts ?? {}; } catch { /* Source-only packages may lack checks. */ }
  }
  const plan = createEvidencePlan({ eventName: "pull_request", baseSha: anchor.sha, headSha: head,
    baseTreeSha: anchor.tree, headTreeSha: tree, changedFiles: classification === "main-refresh" ? ownFiles : changedFiles,
    knownTests, relatedTestsBySource, policy });
  const commands = tree === anchor.tree ? [] : buildCorrectionCommands(plan, { packageScripts });
  if (tree !== anchor.tree && !commands.length) throw new Error("Changed tree has no executable affected checks; no integration lease was requested.");
  return { commands, changedFiles, classification, plan };
}

export async function verifyPublishedCorrection({ cwd = process.cwd(), relatedTestsBySource = {},
  contextReader = readPublishedContext, run = execute, now = Date.now, recordsReader = localRecords,
  identify = identifyGuardExecution, persist = true } = {}) {
  const git = args => gitText(args, { cwd });
  const head = git(["rev-parse", "HEAD"]), branch = git(["branch", "--show-current"]);
  const tree = git(["rev-parse", "HEAD^{tree}"]);
  if (!branch || branch === "main" || git(["status", "--porcelain"])) throw new Error("Correction verification requires a clean named topic branch.");
  const context = contextReader(cwd), pr = context.pullRequest;
  if (pr.state !== "OPEN" || pr.isDraft || pr.headRefName !== branch || pr.baseRefName !== "main"
    || !context.protection.mergeQueue || !context.protection.requiredChecks.length) throw new Error("Matching published PR and active protected checks/merge queue are required.");
  const prior = inspectCorrectionRecord(cwd, { contextReader: () => context, identify, now: now() });
  if (prior.ok) return prior.state;
  const anchor = chooseInitialAnchor({ records: recordsReader(cwd), previous: readCorrectionRecord(cwd), pullRequest: pr,
    treeAt: sha => git(["rev-parse", `${sha}^{tree}`]), now: now() });
  const { commands, changedFiles, classification, plan } = describeCorrection({ cwd, anchor, head, tree, relatedTestsBySource });
  const identityNow = () => {
    const value = identify({ cwd, plan: commands });
    return value ? { ...value, policy: CORRECTION_POLICY, branch, plan: correctionPlanDigest(commands) } : null;
  };
  const identity = identityNow();
  if (!identity) throw new Error("Source/toolchain/environment identity is unproven; no correction checks started.");
  const directory = guardReceiptDirectory(cwd);
  if (persist) mkdirSync(directory, { recursive: true });
  const writer = createStageReceiptWriter({ path: persist ? correctionReceiptPath(cwd) : null, stage: STAGE, identity });
  const lockPath = `${correctionReceiptPath(cwd)}.lock`;
  const claim = persist ? acquireLocalConvergenceLock({ path: lockPath }) : null;
  if (claim && claim.status !== "acquired") throw new Error("Correction verification is already running or its owner is unmeasurable; observe the existing execution.");
  const results = [];
  try {
    writer.start({ integrationStatus: "UNRUN" });
    for (const command of commands) {
      const result = qualifyCorrectionExecution(command, await run(command.command, command.args, { cwd, timeout: 10 * 60_000 }));
      const { stdout: _stdout, ...observation } = result;
      results.push({ ...observation, output: String(result.output ?? "").slice(-8000) });
      writer.heartbeat({ command, exitCode: result.exitCode, outcome: result.outcome ?? null });
      if (result.exitCode !== 0 || result.outcome || result.skipped) throw new Error(`Affected check failed or did not run: ${command.command} ${command.args.join(" ")} (${result.outcome ?? result.exitCode})\n${String(result.output ?? "").slice(-1500)}`);
    }
    if (!stageIdentityMatches(identity, identityNow()) || git(["rev-parse", "HEAD"]) !== head || git(["rev-parse", "HEAD^{tree}"]) !== tree
      || git(["branch", "--show-current"]) !== branch || git(["status", "--porcelain"])) throw new Error("Source identity changed during correction verification.");
    if (!stageIdentityMatches(contextIdentity(context), contextIdentity(contextReader(cwd)))) throw new Error("Published PR or protection changed during correction verification.");
    const completedAt = new Date(now()).toISOString(), expiresAt = new Date(now() + CORRECTION_TTL_MS).toISOString();
    const result = { branch, sha: head, gatePassed: false, skipped: true, status: "gate-unrun", expiresAt,
      skipReason: "published-correction: affected checks executed; integration delegated to protected GitHub",
      publicationCorrection: { schemaVersion: 1, repositoryFullName: pr.repositoryFullName, branch, sha: head, tree,
        completedAt, expiresAt, pullRequest: pr, protection: context.protection, anchor, classification, changedFiles,
        planDigest: correctionPlanDigest(commands), identity, commands, results, plannerEscalations: plan.escalations, relatedTestsBySource,
        delegated: ["full-local-integration", "protected-github-checks", "merge-queue"] } };
    const qualified = classifyPublishedCorrection(result, { sha: head, branch, now: now() });
    if (!qualified.ok) throw new Error(qualified.reason);
    writer.complete("passed", { integrationStatus: "UNRUN", result });
    return result;
  } catch (error) {
    if (writer.snapshot()?.status === "running") writer.complete("inconclusive", { integrationStatus: "UNRUN", results, error: String(error.message) });
    throw error;
  } finally { if (claim) releaseLocalConvergenceLock({ path: lockPath, token: claim.owner.token }); }
}

async function main() {
  const { values } = parseArgs({ options: { status: { type: "boolean" }, eligible: { type: "boolean" }, "related-tests": { type: "string" } } });
  try {
    if (values.status) {
      const verdict = inspectCorrectionRecord();
      console.log(JSON.stringify({ ok: verdict.ok, reason: verdict.reason }));
      process.exitCode = verdict.ok ? 0 : 1;
      return;
    }
    if (values.eligible) {
      const context = readPublishedContext(), pr = context.pullRequest;
      if (pr.state !== "OPEN" || pr.isDraft || pr.headRefName !== gitText(["branch", "--show-current"]) || pr.baseRefName !== "main"
        || !context.protection.mergeQueue || !context.protection.requiredChecks.length || gitText(["status", "--porcelain"])) throw new Error("No matching protected published correction candidate.");
      chooseInitialAnchor({ records: localRecords(process.cwd()), previous: readCorrectionRecord(), pullRequest: pr, treeAt: sha => gitText(["rev-parse", `${sha}^{tree}`]) });
      console.log("Eligible for affected verification by the Git pre-push hook; this is not a check result or integration PASS.");
      return;
    }
    const relatedTestsBySource = values["related-tests"] ? JSON.parse(readFileSync(values["related-tests"], "utf8")) : {};
    const result = await verifyPublishedCorrection({ relatedTestsBySource });
    console.log(`Local-CI-Override: ${result.skipReason}`);
    console.log("Affected verification completed. Full local integration UNRUN; protected GitHub checks and merge queue remain required.");
  } catch (error) { console.error(`Published correction: ${error.message}`); process.exitCode = 1; }
}
if (isEntryModule(import.meta.url)) await main();
