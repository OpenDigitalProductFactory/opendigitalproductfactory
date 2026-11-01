import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { evaluateReadiness, buildGatePlan } from "./pr-readiness/core.mjs";
import { evaluatePrHealth } from "./pr-health.mjs";
import { evaluateGateRecord, evaluateGateVerdict, decide } from "../packages/dpf-skill-pack/hooks/pregate-evidence-guard.mjs";
import { correctionPlanDigest, classifyInitialPublication, classifyPublishedCorrection } from "../packages/dpf-skill-pack/hooks/lib/published-correction.mjs";
import { verifyPublishedCorrection, reducedTierClassification, chooseInitialAnchor, buildCorrectionCommands, qualifyCorrectionExecution, correctionReceiptPath, inspectCorrectionRecord, readPublishedContext, execute, readFreshTestReport } from "./published-correction.mjs";
import { guardShellEnv } from "./lib/guard-bash.mjs";
import { guardGitEnv } from "./lib/git-hook-env.mjs";
import { guardResultEnvironment } from "./lib/pregate-preflight-receipt.mjs";
import { readPublicationGateRecords } from "./pr-readiness.mjs";

const now = Date.parse("2026-10-16T05:30:00Z");
const sha = "a".repeat(40);
const original = "b".repeat(40);
const branch = "fix/example-correction";
const repositoryFullName = "example/platform";
const reason = "published-correction: affected checks executed; integration delegated to protected GitHub";

test("actual correction children cannot inherit the pushing Git repository location", () => {
  const result = execute("node", ["--input-type=module", "-e",
    "import assert from 'node:assert/strict'; for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE']) assert.equal(process.env[key],undefined,key); console.log('isolated');"],
  { env: { ...process.env, GIT_DIR: "/parent/repository", GIT_WORK_TREE: "/parent/tree", GIT_INDEX_FILE: "/parent/index" } });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.stdout, /isolated/);
});

test("GitHub context lookup supplies the actual branch with an explicit origin repository", () => {
  const cwd = mkdtempSync(join(tmpdir(), "correction-context-"));
  try {
    execFileSync("git", ["init", "-b", branch], { cwd, stdio: "pipe" });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/example/platform.git"], { cwd });
    const calls = [];
    const result = readPublishedContext(cwd, { readJson(command, args) {
      calls.push({ command, args });
      if (args[0] === "pr") {
        assert.equal(args[2], branch, "gh requires a PR number, URL or branch when --repo is supplied");
        assert.deepEqual(args.slice(3, 5), ["--repo", "github.com/example/platform"]);
        return { number: 7, headRefName: branch };
      }
      if (args.at(-1).endsWith("/rules/branches/main")) return [{ type: "merge_queue" }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }] } }];
      return { required_status_checks: { contexts: ["DCO", "CI"] } };
    } });
    assert.equal(calls.length, 3);
    assert.equal(result.protection.mergeQueue, true);
    assert.deepEqual(result.protection.requiredChecks, ["CI", "DCO"]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("GitHub context accepts observed classic required checks alongside a ruleset merge queue", () => {
  const cwd = mkdtempSync(join(tmpdir(), "correction-protection-"));
  try {
    execFileSync("git", ["init", "-b", branch], { cwd, stdio: "pipe" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:example/platform.git"], { cwd });
    const result = readPublishedContext(cwd, { readJson(command, args) {
      if (args[0] === "pr") return { number: 7, headRefName: branch };
      if (args.at(-1).endsWith("/rules/branches/main")) return [{ type: "merge_queue" }];
      assert.equal(args.at(-1), "repos/example/platform/branches/main/protection");
      return { required_status_checks: { contexts: ["DCO", "Merge Readiness"], checks: [{ context: "DCO" }] } };
    } });
    assert.equal(result.protection.mergeQueue, true);
    assert.deepEqual(result.protection.requiredChecks, ["DCO", "Merge Readiness"]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

function record() {
  const value = {
    branch, sha, gatePassed: false, skipped: true, status: "gate-unrun",
    skipReason: reason, expiresAt: new Date(now + 3600_000).toISOString(),
    publicationCorrection: {
      schemaVersion: 1, repositoryFullName, branch, sha, tree: "c".repeat(40),
      completedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600_000).toISOString(),
      pullRequest: { number: 7, state: "OPEN", isDraft: false, headRefName: branch,
        headRefOid: original, baseRefName: "main", repositoryFullName },
      protection: { repositoryFullName, branch: "main", mergeQueue: true,
        requiredChecks: ["CI"], observedAt: new Date(now).toISOString() },
      anchor: { repositoryFullName, branch, pullRequestNumber: 7, sha: original,
        tree: "d".repeat(40), capturedAt: new Date(now - 60_000).toISOString(),
        state: { branch, sha: original, gatePassed: false, skipped: true,
          skipReason: "operator-emergency: explicitly authorized initial DEV publication",
          recordedAt: new Date(now - 120_000).toISOString() } },
      classification: "authored-correction", changedFiles: ["scripts/example.mjs"],
      planDigest: "e".repeat(64), identity: { policy: "published-correction-v1",
        tree: "c".repeat(40), head: sha, branch, toolchain: { node: "test" }, environment: "f".repeat(64) },
      commands: [{ command: "node", args: ["--test", "scripts/example.test.mjs"] }],
      results: [{ exitCode: 0, outcome: null, skipped: false }],
      delegated: ["full-local-integration", "protected-github-checks", "merge-queue"],
    },
  };
  value.publicationCorrection.planDigest = correctionPlanDigest(value.publicationCorrection.commands);
  value.publicationCorrection.identity.plan = value.publicationCorrection.planDigest;
  return value;
}

const repo = { branch, headSha: sha, repositoryFullName, isDetached: false, isShallow: false,
  mergeBases: [original], changedFiles: ["scripts/example.mjs"], statusPorcelain: "",
  upstream: `origin/${branch}`, ahead: 0, commits: [] };

test("readiness accepts executed proportional proof without relabelling it a full local PASS", () => {
  const state = record();
  const result = evaluateReadiness({ repo, now, prBody: `Local-CI-Override: ${reason}`,
    localCiRecords: [{ state, metadata: null, publicationInspection: { ok: true, state } }] });
  assert.equal(result.ready, true, result.blockers.join("\n"));
  assert.match(result.notes.join("\n"), /UNRUN.*delegated|delegated.*UNRUN/);
  assert.equal(state.gatePassed, false);
});

test("published-correction prose cannot substitute for machine proof", () => {
  const result = evaluateReadiness({ repo, now, prBody: `Local-CI-Override: ${reason}` });
  assert.equal(result.ready, false);
});

test("raw self-consistent proof cannot replace fresh inspection in either public reader", () => {
  const state = record();
  assert.equal(evaluateReadiness({ repo, now, prBody: `Local-CI-Override: ${reason}`,
    localCiRecords: [{ state, metadata: null }] }).ready, false);
  assert.ok(evaluatePrHealth({ meta: { state: "OPEN", mergeable: "MERGEABLE" },
    localCi: { headSha: sha, stateRecord: state }, now }).blockers.length > 0);
});

test("the packaged publish guard requires fresh source inspection rather than a raw slot record", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-correction-reader-"));
  try {
    const file = join(directory, "state.json");
    const state = record();
    // This reader uses the real clock; the proof remains bounded to its capture.
    const delta = Date.now() - now;
    for (const key of ["completedAt", "expiresAt"]) state.publicationCorrection[key] = new Date(Date.parse(state.publicationCorrection[key]) + delta).toISOString();
    state.expiresAt = state.publicationCorrection.expiresAt;
    state.publicationCorrection.protection.observedAt = state.publicationCorrection.completedAt;
    writeFileSync(file, JSON.stringify(state));
    const result = evaluateGateRecord(file, sha, branch);
    assert.equal(result.ok, false);
    mkdirSync(join(directory, "scripts"));
    writeFileSync(join(directory, "scripts", "published-correction.mjs"), "// adapter fixture\n");
    const head = { sha, branch, statePath: file, topLevel: directory };
    assert.equal(evaluateGateVerdict(head, { readerPath: "", spawnImpl: () => ({ status: 0 }) }).ok, true);
    assert.equal(evaluateGateVerdict(head, { readerPath: "", spawnImpl: () => ({ status: 1 }) }).ok, false);
    delete state.publicationCorrection.anchor;
    writeFileSync(file, JSON.stringify(state));
    assert.equal(evaluateGateRecord(file, sha, branch).ok, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("PR health reports delegated integration and refuses a prose-only correction", () => {
  const state = record();
  const good = evaluatePrHealth({ meta: { state: "OPEN", mergeable: "MERGEABLE" },
    localCi: { headSha: sha, stateRecord: state, publicationInspection: { ok: true, state } }, now });
  assert.equal(good.blockers.length, 0, good.blockers.join("\n"));
  assert.match(good.notes.join("\n"), /delegated/);
  const bad = evaluatePrHealth({ meta: { state: "OPEN", mergeable: "MERGEABLE" },
    localCi: { headSha: sha, attestation: { kind: "override", value: reason } }, now });
  assert.ok(bad.blockers.length > 0);
});

test("proof refuses foreign, stale, unexecuted and self-anchored correction evidence", () => {
  const mutations = [
    value => { value.publicationCorrection.anchor = null; },
    value => { value.publicationCorrection.anchor.state.skipReason = reason; },
    value => { value.publicationCorrection.anchor.repositoryFullName = "foreign/repository"; },
    value => { value.publicationCorrection.pullRequest.state = "CLOSED"; },
    value => { value.publicationCorrection.pullRequest.isDraft = true; },
    value => { value.publicationCorrection.protection.mergeQueue = false; },
    value => { value.publicationCorrection.protection.requiredChecks = []; },
    value => { value.publicationCorrection.results[0].exitCode = 1; },
    value => { value.publicationCorrection.results[0].skipped = true; },
    value => { value.publicationCorrection.identity.plan = "foreign"; },
    value => { value.publicationCorrection.expiresAt = new Date(now).toISOString(); },
    value => { value.publicationCorrection.identity.head = original; },
  ];
  for (const mutate of mutations) {
    const value = record(); mutate(value);
    assert.equal(classifyPublishedCorrection(value, { sha, branch, repositoryFullName, now }).ok, false, mutate.toString());
  }
});

test("empty or metadata-labelled execution cannot hide a changed source tree", () => {
  const value = record();
  const proof = value.publicationCorrection;
  proof.changedFiles = [];
  proof.commands = []; proof.results = [];
  proof.planDigest = correctionPlanDigest([]); proof.identity.plan = proof.planDigest;
  proof.classification = "commit-metadata";
  assert.equal(classifyPublishedCorrection(value, { sha, branch, now }).ok, false);
});

test("a publish environment reason cannot stand in for machine evidence", () => {
  const decision = decide("git push", { DPF_SKIP_PREPUSH_GATE: "1", DPF_SKIP_PREPUSH_GATE_REASON: reason });
  assert.equal(decision.block, true);
});

test("an open PR without qualified initial evidence cannot bootstrap correction eligibility", () => {
  const pullRequest = record().publicationCorrection.pullRequest;
  assert.throws(() => chooseInitialAnchor({ records: [], previous: null, pullRequest, treeAt: () => "d".repeat(40), now }), /initial-publication anchor/);
  const previous = record();
  previous.publicationCorrection.anchor.state.skipReason = reason;
  assert.throws(() => chooseInitialAnchor({ records: [], previous, pullRequest, treeAt: () => "d".repeat(40), now }), /initial-publication anchor/);
});

test("an exact synthesized integration tree reconciles a rebased canonical publication anchor", () => {
  const pullRequest = record().publicationCorrection.pullRequest;
  const recordedSha = "f".repeat(40);
  const integratedTree = "d".repeat(40);
  const state = {
    branch, sha: recordedSha, gatePassed: true, skipped: false, status: "passed",
    evidenceRecordId: "canonical-evidence", leaseId: "canonical-lease",
    // The anchor is evaluated at the original gate capture, not at this
    // later correction. Its fresh correction proof has a separate TTL.
    recordedAt: new Date(now - 120_000).toISOString(), expiresAt: new Date(now - 60_000).toISOString(),
  };
  const metadata = {
    candidateSha: recordedSha, runLeaseId: "canonical-lease", synthesizedTreeSha: integratedTree,
    execution: { status: "passed" },
  };
  const anchor = chooseInitialAnchor({ records: [{ state, metadata }], previous: null, pullRequest,
    treeAt: value => { assert.equal(value, original); return integratedTree; }, now });
  assert.equal(anchor.sha, original);
  assert.equal(anchor.state, state, "the original canonical gate record remains intact");
  assert.deepEqual(anchor.equivalentCandidate, { sha: recordedSha, synthesizedTreeSha: integratedTree });
  assert.equal(classifyInitialPublication(anchor, { repositoryFullName, branch, pullRequestNumber: 7 }).ok, true);
  for (const metadataCandidate of ["e".repeat(40), undefined]) {
    const candidate = { ...anchor, metadata: { ...metadata } };
    if (metadataCandidate === undefined) delete candidate.metadata.candidateSha;
    else candidate.metadata.candidateSha = metadataCandidate;
    assert.equal(classifyInitialPublication(candidate, { repositoryFullName, branch, pullRequestNumber: 7 }).ok, false,
      "canonical evidence must remain bound to its recorded candidate SHA");
  }
  const direct = { ...anchor, sha: recordedSha, equivalentCandidate: undefined };
  for (const metadataCandidate of ["e".repeat(40), undefined]) {
    const candidate = { ...direct, metadata: { ...metadata } };
    if (metadataCandidate === undefined) delete candidate.metadata.candidateSha;
    else candidate.metadata.candidateSha = metadataCandidate;
    assert.equal(classifyInitialPublication(candidate, { repositoryFullName, branch, pullRequestNumber: 7 }).ok, false,
      "same-SHA canonical evidence also requires the recorded candidate metadata");
  }
});

function historicalCanonicalCorrection() {
  const previous = record();
  const anchor = previous.publicationCorrection.anchor;
  anchor.state = { branch, sha: original, gatePassed: true, status: "passed",
    skipped: false, evidenceRecordId: "fixture-evidence", leaseId: "fixture-lease",
    recordedAt: new Date(now - 120_000).toISOString(),
    expiresAt: new Date(now + 120_000).toISOString() };
  anchor.metadata = { candidateSha: original, runLeaseId: "fixture-lease",
    execution: { status: "passed" } };
  return previous;
}

test("an interrupted push recovers only its historical anchor after both proofs expire", () => {
  const previous = historicalCanonicalCorrection();
  const snapshot = JSON.stringify(previous);
  const later = now + 2 * 3600_000;
  const pullRequest = previous.publicationCorrection.pullRequest;
  assert.equal(classifyPublishedCorrection(previous, { now: later }).ok, false);
  const anchor = chooseInitialAnchor({ records: [], previous, pullRequest,
    treeAt: value => (value === sha ? "c" : "d").repeat(40), now: later });
  assert.equal(anchor, previous.publicationCorrection.anchor);
  assert.equal(JSON.stringify(previous), snapshot, "retained evidence is never rewritten");
  assert.equal(classifyPublishedCorrection(previous, { now: later }).ok, false,
    "anchor recovery does not renew affected-check proof");
  const published = { ...pullRequest, headRefOid: previous.sha };
  assert.equal(chooseInitialAnchor({ records: [], previous, pullRequest: published,
    treeAt: value => (value === sha ? "c" : "d").repeat(40), now: later }), anchor);
});

test("a verified correction keeps its recorded published predecessor while the next push is pending", () => {
  const previous = historicalCanonicalCorrection();
  const predecessor = "e".repeat(40);
  previous.publicationCorrection.pullRequest.headRefOid = predecessor;
  const pullRequest = { ...previous.publicationCorrection.pullRequest };
  const anchor = chooseInitialAnchor({ records: [], previous, pullRequest,
    treeAt: value => (value === sha ? "c" : "d").repeat(40), now: now + 2 * 3600_000 });
  assert.equal(anchor, previous.publicationCorrection.anchor);
  assert.equal(classifyPublishedCorrection(previous, { now: now + 2 * 3600_000 }).ok, false);
});

test("historical anchor recovery refuses foreign or unqualified retained evidence", () => {
  const mutations = [
    value => { value.publicationCorrection.anchor.state.expiresAt = value.publicationCorrection.anchor.capturedAt; },
    value => { value.publicationCorrection.results[0].exitCode = 1; },
    value => { value.publicationCorrection.results[0].skipped = true; },
    value => { value.publicationCorrection.pullRequest.number = 8; },
    value => { value.publicationCorrection.anchor.repositoryFullName = "foreign/repository"; },
    value => { value.publicationCorrection.completedAt = new Date(now + 4 * 3600_000).toISOString(); },
  ];
  const pullRequest = record().publicationCorrection.pullRequest;
  for (const mutate of mutations) {
    const previous = historicalCanonicalCorrection(); mutate(previous);
    assert.throws(() => chooseInitialAnchor({ records: [], previous, pullRequest,
      treeAt: value => (value === sha ? "c" : "d").repeat(40), now: now + 2 * 3600_000 }), /initial-publication anchor/);
  }
  const previous = historicalCanonicalCorrection();
  for (const options of [
    { pullRequest: { ...pullRequest, number: 9 } },
    { pullRequest: { ...pullRequest, headRefOid: "f".repeat(40) } },
    { pullRequest: { ...pullRequest, repositoryFullName: "foreign/repository" } },
    { treeAt: () => "f".repeat(40) },
  ]) assert.throws(() => chooseInitialAnchor({ records: [], previous, pullRequest,
    treeAt: value => (value === sha ? "c" : "d").repeat(40), now: now + 2 * 3600_000, ...options }), /initial-publication anchor/);
});

test("an unmapped change cannot silently run zero affected checks", () => {
  assert.throws(() => buildCorrectionCommands({ affectedTests: [], fileDispositions: [{ path: "scripts/unknown.mjs", kind: "other", tests: [] }], affectedPackages: [], scope: {} }), /mapping unresolved/);
});

test("published readiness refreshes metadata guards while delegating broad source checks", () => {
  const profiles = { source: [{ id: "broad-source", name: "Broad source", commands: [["node", ["source.mjs"]]] }],
    workspace: [], "pull-request": [{ id: "design-grounding-gate", name: "Design grounding", commands: [["node", ["design.mjs"]]] }] };
  assert.equal(buildGatePlan({ profiles }).length, 2);
  assert.deepEqual(buildGatePlan({ profiles, publishedCorrection: true }).map(gate => gate.name), ["Design grounding"]);
});

function gitFixture() {
  const cwd = mkdtempSync(join(tmpdir(), "dpf-published-correction-git-"));
  const git = (...args) => execFileSync("git", args, { cwd, env: guardGitEnv(), encoding: "utf8", windowsHide: true }).trim();
  git("init", "--quiet", "-b", "main");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Fixture Author"); git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(cwd, "README.md"), "Fixture base\n");
  git("add", "."); git("commit", "--quiet", "-m", "fixture base");
  git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
  git("switch", "--quiet", "-c", branch);
  mkdirSync(join(cwd, "scripts"));
  const write = version => {
    writeFileSync(join(cwd, "scripts", "example.mjs"), `export const value = ${version};\n`);
    writeFileSync(join(cwd, "scripts", "example.test.mjs"), `import assert from 'node:assert/strict'; import {value} from './example.mjs'; assert.equal(value, ${version});\n`);
  };
  write(1); git("add", "."); git("commit", "--quiet", "-m", "initial publication");
  const originalSha = git("rev-parse", "HEAD");
  const initial = { branch, sha: originalSha, gatePassed: false, skipped: true,
    skipReason: "operator-emergency: existing explicit initial fixture publication", recordedAt: new Date(Date.now() - 1000).toISOString() };
  const contextReader = () => ({ pullRequest: { number: 7, state: "OPEN", isDraft: false,
    baseRefName: "main", headRefName: branch, headRefOid: originalSha, repositoryFullName },
  protection: { branch: "main", repositoryFullName, mergeQueue: true, requiredChecks: ["CI"], observedAt: new Date().toISOString() } });
  const identify = () => ({ head: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"),
    toolchain: { node: process.version }, environment: "fixture", base: git("rev-parse", "origin/main") });
  return { cwd, git, write, originalSha, contextReader, identify,
    options: { cwd, contextReader, identify, persist: false, recordsReader: () => [{ state: initial, metadata: null }] },
    remove() { rmSync(cwd, { recursive: true, force: true }); } };
}

test("actual affected Node checks run after a changed published tree without invoking integration", async () => {
  const fixture = gitFixture();
  try {
    fixture.write(2); fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "repair actual source");
    const result = await verifyPublishedCorrection(fixture.options);
    assert.equal(result.gatePassed, false);
    assert.equal(result.publicationCorrection.classification, "authored-correction");
    assert.deepEqual(result.publicationCorrection.commands, [{ command: "node", args: ["--test", "--test-reporter=tap", "scripts/example.test.mjs"] }]);
    assert.equal(result.publicationCorrection.results[0].exitCode, 0);
    assert.equal(classifyPublishedCorrection(result).ok, true);
  } finally { fixture.remove(); }
});

test("unchanged and commit-metadata corrections execute zero source commands", async () => {
  const fixture = gitFixture();
  try {
    const run = () => { throw new Error("source checks must not run"); };
    const unchanged = await verifyPublishedCorrection({ ...fixture.options, run });
    assert.equal(unchanged.publicationCorrection.classification, "unchanged-head");
    fixture.git("commit", "--quiet", "--amend", "-m", "metadata-only correction");
    const amended = await verifyPublishedCorrection({ ...fixture.options, run });
    assert.equal(amended.publicationCorrection.classification, "commit-metadata");
    assert.deepEqual(amended.publicationCorrection.commands, []);
  } finally { fixture.remove(); }
});

test("failed affected commands and concurrent PR drift refuse publication", async () => {
  const fixture = gitFixture();
  try {
    fixture.write(2); fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "repair source");
    await assert.rejects(verifyPublishedCorrection({ ...fixture.options, run: () => ({ exitCode: 1, output: "actual named failure" }) }), /Affected check failed/);
    let reads = 0;
    const changedContext = () => {
      const value = fixture.contextReader();
      if (++reads > 1) value.pullRequest.headRefOid = "f".repeat(40);
      return value;
    };
    await assert.rejects(verifyPublishedCorrection({ ...fixture.options, contextReader: changedContext }), /PR or protection changed/);
  } finally { fixture.remove(); }
});

test("a clean main refresh runs only the existing affected plan and retains the original anchor", async () => {
  const fixture = gitFixture();
  try {
    fixture.git("switch", "--quiet", "main");
    writeFileSync(join(fixture.cwd, "README.md"), "New main documentation\n");
    fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "main change");
    fixture.git("update-ref", "refs/remotes/origin/main", fixture.git("rev-parse", "HEAD"));
    fixture.git("switch", "--quiet", branch); fixture.git("merge", "--quiet", "--no-edit", "main");
    const result = await verifyPublishedCorrection(fixture.options);
    assert.equal(result.publicationCorrection.classification, "main-refresh");
    assert.equal(result.publicationCorrection.anchor.sha, fixture.originalSha);
    assert.equal(result.gatePassed, false);
    assert.equal(result.publicationCorrection.commands.length, 1);
  } finally { fixture.remove(); }
});

test("dirty source appearing during an affected command cannot publish reusable proof", async () => {
  const fixture = gitFixture();
  try {
    fixture.write(2); fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "repair source");
    const run = () => { fixture.write(3); return { exitCode: 0, stdout: "# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n" }; };
    await assert.rejects(verifyPublishedCorrection({ ...fixture.options, run }), /Source identity changed/);
  } finally { fixture.remove(); }
});

function vitestResult(command, report) {
  const testReport = JSON.stringify(report);
  const path = join(tmpdir(), "dpf-correction-synthetic", "report.json");
  return { exitCode: 0, outcome: null, stdout: "launcher notices", testReport,
    report: { format: "vitest-json-file", path, command: command.command,
      args: [...command.args, "--outputFile", path], bytes: Buffer.byteLength(testReport),
      sha256: createHash("sha256").update(testReport).digest("hex") } };
}
const completeVitestReport = { numTotalTests: 1, numPassedTests: 1,
  numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true };

test("exit zero without an executed complete test report is not affected verification", () => {
  const node = { command: "node", args: ["--test", "--test-reporter=tap", "fixture.test.mjs"] };
  assert.equal(qualifyCorrectionExecution(node, { exitCode: 0, stdout: "no tests executed" }).outcome, "test-report-unproven");
  assert.equal(qualifyCorrectionExecution(node, { exitCode: 0, stdout: "# tests 2\n# pass 1\n# fail 0\n# skipped 1\n# cancelled 0\n# todo 0\n" }).outcome, "test-report-incomplete");
  const vitest = { command: "pnpm", args: ["exec", "vitest", "run", "fixture.test.ts", "--reporter=json"] };
  const report = { ...completeVitestReport, numTotalTests: 2, numPassedTests: 1, numPendingTests: 1 };
  assert.equal(qualifyCorrectionExecution(vitest, vitestResult(vitest, report)).outcome, "test-report-incomplete");
  report.numPassedTests = 2; report.numPendingTests = 0;
  assert.equal(qualifyCorrectionExecution(vitest, vitestResult(vitest, report)).outcome, null);
  assert.equal(qualifyCorrectionExecution(vitest, { exitCode: 0, stdout: JSON.stringify(report) }).outcome, "test-report-unproven");
});

test("report reading opens before classification and rejects pathname replacement using the descriptor identity", () => {
  const bytes = Buffer.from("{}");
  const stamp = { isFile: () => true, dev: 1, ino: 7, size: bytes.length, mtimeMs: 20, ctimeMs: 30 };
  for (const mode of ["same", "replacement", "symlink", "modified", "unreadable"]) {
    const events = [];
    let reads = 0;
    const fs = {
      openSync: () => { events.push("open"); return 17; },
      lstatSync: () => {
        events.push("path");
        if (mode === "unreadable") throw new Error("path unavailable");
        return mode === "replacement" ? { ...stamp, ino: 8 } : mode === "symlink" ? { ...stamp, isFile: () => false } : stamp;
      },
      fstatSync: fd => { assert.equal(fd, 17); return mode === "modified" && reads ? { ...stamp, mtimeMs: 21 } : stamp; },
      readSync: (fd, target, offset, length, position) => {
        assert.equal(fd, 17); reads++;
        const count = Math.min(length, Math.max(0, bytes.length - position));
        bytes.copy(target, offset, position, position + count); return count;
      },
      closeSync: fd => { assert.equal(fd, 17); events.push("close"); },
    };
    if (mode === "same") assert.deepEqual(readFreshTestReport("owned-report", fs), bytes);
    else assert.throws(() => readFreshTestReport("owned-report", fs));
    assert.equal(events[0], "open", mode);
    assert.equal(events.at(-1), "close", mode);
    assert.equal(events.filter(event => event === "close").length, 1, mode);
  }
});

test("real Vitest file output qualifies despite launcher noise and an old project report", { timeout: 60_000 }, () => {
  const cwd = process.cwd();
  const fixture = mkdtempSync(join(tmpdir(), "correction-vitest fixture-"));
  try {
    const config = join(fixture, "vitest.config.mjs");
    const file = join(fixture, "report.test.mjs");
    const oldPath = join(fixture, "old-output.json");
    const stale = JSON.stringify({ ...completeVitestReport, numTotalTests: 999, numPassedTests: 999 });
    writeFileSync(oldPath, stale);
    writeFileSync(config, `console.log('launcher reporter preamble'); export default { test: { root: ${JSON.stringify(fixture)}, globals: true, include: ['*.test.mjs'], outputFile: { json: ${JSON.stringify(oldPath)} } } };`);
    writeFileSync(file, "test('executes the actual Vitest runner', () => expect(2 + 2).toBe(4));\n");
    const command = { command: "pnpm", args: ["--filter", "web", "exec", "vitest", "run", file,
      "--config", config, "--maxWorkers=1", "--reporter=json"] };
    const result = execute(command.command, command.args, { cwd, timeout: 45_000 });
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.stdout, /launcher reporter preamble/);
    const qualified = qualifyCorrectionExecution(command, result);
    assert.equal(qualified.outcome, null, qualified.output);
    assert.equal(JSON.parse(result.testReport).numPassedTests, 1);
    assert.deepEqual(result.report.args, [...command.args, "--outputFile", result.report.path]);
    assert.equal(readFileSync(oldPath, "utf8"), stale, "the project-default report must not be consumed or overwritten");
    assert.equal(existsSync(result.report.path), false, "only the fresh adapter-owned report is cleaned up");
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("Vitest evidence binds the exact invocation and report bytes", () => {
  const command = { command: "pnpm", args: ["exec", "vitest", "run", "fixture.test.ts", "--reporter=json"] };
  for (const change of [
    result => { result.report.command = "other"; },
    result => { result.report.args = ["vitest", "run", "foreign.test.ts"]; },
    result => { result.report.sha256 = "0".repeat(64); },
    result => { result.report.bytes += 1; },
  ]) {
    const result = vitestResult(command, completeVitestReport); change(result);
    assert.equal(qualifyCorrectionExecution(command, result).outcome, "test-report-unproven");
  }
  for (const change of [{ numTodoTests: 1 }, { numPassedTests: "1", numTotalTests: "1" }]) {
    assert.equal(qualifyCorrectionExecution(command, vitestResult(command, { ...completeVitestReport, ...change })).outcome,
      "test-report-incomplete");
  }
});

test("Vitest cannot borrow stdout success when its fresh report is absent, malformed or oversized", () => {
  for (const mode of ["absent", "malformed", "oversized"]) {
    const script = `import { writeFileSync, openSync, ftruncateSync, closeSync } from 'node:fs';
      const index = process.argv.indexOf('--outputFile');
      const path = index < 0 ? null : process.argv[index + 1];
      console.log(${JSON.stringify(JSON.stringify(completeVitestReport))});
      if (path && ${JSON.stringify(mode)} === 'malformed') writeFileSync(path, '{');
      if (path && ${JSON.stringify(mode)} === 'oversized') { const fd = openSync(path, 'w'); ftruncateSync(fd, 32 * 1024 * 1024 + 1); closeSync(fd); }`;
    const command = { command: "node", args: ["--input-type=module", "-e", script, "--", "vitest", "--reporter=json"] };
    const result = execute(command.command, command.args);
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(qualifyCorrectionExecution(command, result).outcome, "test-report-unproven", mode);
  }
});

test("a complete Vitest file cannot overrule a failed or interrupted child", () => {
  for (const mode of ["failed", "timeout"]) {
    const script = `import { writeFileSync } from 'node:fs';
      const path = process.argv[process.argv.indexOf('--outputFile') + 1];
      writeFileSync(path, ${JSON.stringify(JSON.stringify(completeVitestReport))});
      if (${JSON.stringify(mode)} === 'failed') process.exit(7);
      else setInterval(() => {}, 1000);`;
    const command = { command: "node", args: ["--input-type=module", "-e", script, "--", "vitest", "--reporter=json"] };
    const result = execute(command.command, command.args, { timeout: 600 });
    const qualified = qualifyCorrectionExecution(command, result);
    assert.notEqual(qualified.exitCode, 0);
    if (mode === "failed") assert.equal(qualified.exitCode, 7);
    else assert.equal(qualified.outcome, "ETIMEDOUT");
    assert.equal(existsSync(result.report.path), false);
  }
});

test("failed verification receipts retain compact report identity without raw assertion payloads", async () => {
  const fixture = gitFixture();
  const marker = "raw-report-assertion-payload-must-stay-ephemeral";
  const report = JSON.stringify({ ...completeVitestReport, success: false, assertionResults: [{ failureMessages: [marker] }] });
  try {
    fixture.write(2); fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "repair source");
    const runnerPath = join(fixture.cwd, ".git", "report-fixture.mjs");
    writeFileSync(runnerPath, `import {writeFileSync} from 'node:fs';
      writeFileSync(process.argv[process.argv.indexOf('--outputFile') + 1], ${JSON.stringify(report)});
      process.exit(7);`);
    await assert.rejects(verifyPublishedCorrection({ ...fixture.options, persist: true,
      run: () => execute("node", [runnerPath, "vitest"]),
    }), /Affected check failed/);
    const bytes = readFileSync(correctionReceiptPath(fixture.cwd), "utf8");
    assert.equal(bytes.includes(marker), false, "raw JSON must not enter the durable failure receipt");
    const receipt = JSON.parse(bytes);
    assert.equal(receipt.status, "inconclusive");
    const result = receipt.results[0];
    assert.equal(result.exitCode, 7);
    assert.equal(result.outcome, null);
    assert.equal(result.report.bytes, Buffer.byteLength(report));
    assert.equal(result.report.sha256, createHash("sha256").update(report).digest("hex"));
    assert.equal(Object.hasOwn(result, "testReport"), false);
  } finally { fixture.remove(); }
});

test("a recorded arbitrary command list cannot replace the source-derived affected plan", async () => {
  const fixture = gitFixture();
  try {
    fixture.write(2); fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "repair source");
    await verifyPublishedCorrection({ ...fixture.options, persist: true });
    const inspect = () => inspectCorrectionRecord(fixture.cwd, { identify: fixture.identify, contextReader: fixture.contextReader });
    const assertReaders = (inspection, expected) => {
      const state = inspection.state ?? JSON.parse(readFileSync(correctionReceiptPath(fixture.cwd), "utf8")).result;
      const records = readPublicationGateRecords({ rootClone: fixture.cwd, gitCommonDir: join(fixture.cwd, ".git"), candidateGitDir: join(fixture.cwd, ".git") }, () => null, () => inspection);
      if (!inspection.ok) records.push({ state, metadata: null });
      const currentRepo = { ...repo, headSha: state.sha };
      const ready = evaluateReadiness({ repo: currentRepo, prBody: `Local-CI-Override: ${state.skipReason}`, localCiRecords: records });
      assert.equal(ready.ready, expected, ready.blockers.join("\n"));
      const health = evaluatePrHealth({ meta: { state: "OPEN", mergeable: "MERGEABLE" },
        localCi: { headSha: state.sha, stateRecord: state, publicationInspection: inspection } });
      assert.equal(health.blockers.length === 0, expected, health.blockers.join("\n"));
    };
    assertReaders(inspect(), true);
    assertReaders(inspectCorrectionRecord(fixture.cwd, { contextReader: fixture.contextReader,
      identify: () => ({ ...fixture.identify(), environment: "changed" }) }), false);
    assertReaders(inspectCorrectionRecord(fixture.cwd, { identify: fixture.identify, contextReader: () => {
      const changed = fixture.contextReader(); changed.protection.mergeQueue = false; return changed;
    } }), false);
    assertReaders(inspectCorrectionRecord(fixture.cwd, { identify: fixture.identify, contextReader: () => {
      const changed = fixture.contextReader(); changed.protection.requiredChecks = ["CI", "Changed classic protection"];
      return changed;
    } }), false);
    const path = correctionReceiptPath(fixture.cwd);
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    const proof = receipt.result.publicationCorrection;
    proof.commands = [{ command: "node", args: ["--version"] }];
    proof.planDigest = correctionPlanDigest(proof.commands); proof.identity.plan = proof.planDigest;
    writeFileSync(path, JSON.stringify(receipt));
    assert.equal(inspect().ok, false);
    assert.match(inspect().reason, /Expected affected plan/);
    assertReaders(inspect(), false);
  } finally { fixture.remove(); }
});

test("unrelated main advancement reuses source-bound correction proof without another affected run", async () => {
  const fixture = gitFixture();
  try {
    fixture.write(2); fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "repair source");
    await verifyPublishedCorrection({ ...fixture.options, persist: true });
    const priorMain = fixture.git("rev-parse", "origin/main");
    fixture.git("read-tree", "origin/main");
    fixture.git("update-index", "--add", "--cacheinfo", "100644", fixture.git("rev-parse", "origin/main:README.md"), "UPSTREAM.md");
    const upstreamTree = fixture.git("write-tree");
    fixture.git("read-tree", "HEAD");
    assert.notEqual(upstreamTree, fixture.git("rev-parse", "origin/main^{tree}"));
    const nextMain = fixture.git("commit-tree", upstreamTree, "-p", priorMain, "-m", "independent upstream document");
    fixture.git("update-ref", "refs/remotes/origin/main", nextMain);
    const inspection = inspectCorrectionRecord(fixture.cwd, { identify: fixture.identify, contextReader: fixture.contextReader });
    assert.equal(inspection.ok, true, inspection.reason);
    const reused = await verifyPublishedCorrection({ ...fixture.options, persist: true,
      run: () => { throw new Error("unchanged affected source must reuse its existing proof"); } });
    assert.equal(reused.sha, fixture.git("rev-parse", "HEAD"));
  } finally { fixture.remove(); }
});

test("a real TODO-only Node child exits zero but cannot qualify affected verification", async () => {
  const fixture = gitFixture();
  try {
    fixture.write(2);
    writeFileSync(join(fixture.cwd, "scripts", "example.test.mjs"), "import {test} from 'node:test'; test.todo('unfinished behavior');\n");
    fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "unfinished correction test");
    await assert.rejects(verifyPublishedCorrection(fixture.options), /test-report-incomplete/);
  } finally { fixture.remove(); }
});

test("the real Git hook executes correction verification once, reuses proof and refuses its failure", () => {
  const fixture = gitFixture();
  try {
    const hook = join(fixture.cwd, "pre-push-fixture.sh");
    writeFileSync(hook, readFileSync(new URL("../.githooks/pre-push-gate", import.meta.url), "utf8"));
    writeFileSync(join(fixture.cwd, "scripts", "pregate-status.mjs"), "process.exitCode=1;\n");
    writeFileSync(join(fixture.cwd, "scripts", "published-correction.mjs"), `
      import {existsSync,writeFileSync,appendFileSync} from 'node:fs';
      const arg=process.argv[2];
      if(arg==='--status') process.exit(existsSync('.git/correction-proof')?0:1);
      if(arg==='--eligible') process.exit(0);
      appendFileSync('.git/correction-executions','affected\\n');
      if(existsSync('.git/correction-fail')) process.exit(1);
      writeFileSync('.git/correction-proof','qualified');
    `);
    const oldSlot = join(fixture.cwd, ".git", "dpf-local-ci-gate-slot-1.json");
    const oldBytes = JSON.stringify({ sha: fixture.originalSha, status: "failed", gatePassed: false, evidenceRecordId: "fixture-history" });
    writeFileSync(oldSlot, oldBytes);
    const env = guardShellEnv({ ...process.env });
    for (const key of ["DPF_SKIP_PREPUSH_GATE", "DPF_PREPUSH_GATE_INFLIGHT", "CLAUDE_CODE_REMOTE"]) delete env[key];
    const invoke = () => execFileSync("sh", [hook], { cwd: fixture.cwd, env, input: "", encoding: "utf8", windowsHide: true });
    assert.match(invoke(), /pushing is not 'done'/);
    assert.match(invoke(), /proof reused/);
    assert.equal(readFileSync(join(fixture.cwd, ".git", "correction-executions"), "utf8"), "affected\n");
    assert.equal(readFileSync(oldSlot, "utf8"), oldBytes);
    rmSync(join(fixture.cwd, ".git", "correction-proof"));
    writeFileSync(join(fixture.cwd, ".git", "correction-fail"), "named failure");
    assert.throws(invoke);
    assert.equal(existsSync(join(fixture.cwd, ".git", "correction-proof")), false);
    assert.equal(readFileSync(oldSlot, "utf8"), oldBytes);
  } finally { fixture.remove(); }
});


function mappedCorrectionFixture() {
  const fixture = gitFixture();
  const source = "scripts/registry.mjs", target = "scripts/contract.test.mjs";
  writeFileSync(join(fixture.cwd, source), "export const value = 2;\n");
  writeFileSync(join(fixture.cwd, target), `import assert from 'node:assert/strict';
    import {value} from './registry.mjs';
    assert.equal(value, 2); assert.notEqual(process.env.DPF_CORRECTION_TEST_CONTEXT, 'fail');
`);
  fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "mapped source correction");
  return { ...fixture, source, target, mapping: { [source]: [target] } };
}

test("a correction proof survives a distinct publish-hook process but not a relevant guard input change", async () => {
  const fixture = mappedCorrectionFixture();
  let environment = { ...process.env, CODEX_SESSION_ID: "direct-shell", DPF_GATE_OWNER_SESSION_ID: "direct-owner" };
  const initialGuardEnvironment = guardResultEnvironment(environment);
  let executions = 0;
  const identify = () => ({ ...fixture.identify(), environment: createHash("sha256").update(JSON.stringify(guardResultEnvironment(environment))).digest("hex") });
  const run = () => {
    executions++;
    return { exitCode: 0, stdout: "# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n" };
  };
  const options = { ...fixture.options, persist: true, identify, run };
  try {
    const first = await verifyPublishedCorrection({ ...options, relatedTestsBySource: fixture.mapping });
    assert.equal(executions, 1);
    const pathDelimiter = process.platform === "win32" ? ";" : ":";
    const hookPrefix = process.platform === "win32" ? "C:/Program Files/Git/mingw64/libexec/git-core" : "/usr/lib/git-core";
    environment = { ...environment, CODEX_SESSION_ID: "publish-hook", DPF_GATE_OWNER_SESSION_ID: "hook-owner", CLAUDE_CODE_REMOTE: "1",
      PATH: `${hookPrefix}${pathDelimiter}${environment.PATH ?? environment.Path ?? ""}` };
    assert.deepEqual(guardResultEnvironment(environment), initialGuardEnvironment,
      "the hook wrapper must preserve the executable search identity");
    const inspection = inspectCorrectionRecord(fixture.cwd, { identify, contextReader: fixture.contextReader });
    assert.equal(inspection.ok, true, inspection.reason);
    const reused = await verifyPublishedCorrection(options);
    assert.equal(executions, 1, "a status read from the hook process must reuse the proof");
    assert.equal(reused.sha, first.sha);
    environment = { ...environment, CI: "changed-guard-input" };
    assert.equal(inspectCorrectionRecord(fixture.cwd, { identify, contextReader: fixture.contextReader }).ok, false,
      "a guard-relevant environment input must still invalidate the proof");
  } finally { fixture.remove(); }
});

test("guard-result identity retains the selected PowerShell test executable", () => {
  const legacy = guardResultEnvironment({ CI: "true", DPF_TEST_POWERSHELL: "powershell" });
  const pwsh = guardResultEnvironment({ CI: "true", DPF_TEST_POWERSHELL: "C:/Program Files/PowerShell/7/pwsh.exe" });
  assert.notDeepEqual(pwsh, legacy);
});

test("guard-result identity retains semantic base and guard-runner selectors", () => {
  const baseline = guardResultEnvironment({ CI: "true", BASE_SHA: "a".repeat(40), BASE_REF: "origin/main", DPF_PREPUSH_BASE_REF: "origin/main", DPF_GUARD_SPAWN_RETRIES: "2" });
  assert.notDeepEqual(guardResultEnvironment({ CI: "true", BASE_SHA: "b".repeat(40), BASE_REF: "origin/main", DPF_PREPUSH_BASE_REF: "origin/main", DPF_GUARD_SPAWN_RETRIES: "2" }), baseline,
    "BASE_SHA selects the diff scanned by registered guards");
  assert.notDeepEqual(guardResultEnvironment({ CI: "true", BASE_SHA: "a".repeat(40), BASE_REF: "origin/release", DPF_PREPUSH_BASE_REF: "origin/main", DPF_GUARD_SPAWN_RETRIES: "2" }), baseline,
    "BASE_REF is a fallback diff selector");
  assert.notDeepEqual(guardResultEnvironment({ CI: "true", BASE_SHA: "a".repeat(40), BASE_REF: "origin/main", DPF_PREPUSH_BASE_REF: "origin/topic", DPF_GUARD_SPAWN_RETRIES: "2" }), baseline,
    "DPF_PREPUSH_BASE_REF is a hook diff selector");
  assert.notDeepEqual(guardResultEnvironment({ CI: "true", BASE_SHA: "a".repeat(40), BASE_REF: "origin/main", DPF_PREPUSH_BASE_REF: "origin/main", DPF_GUARD_SPAWN_RETRIES: "0" }), baseline,
    "runner retry policy changes which executed guard outcome can be reused");
});

test("guard-result identity ignores only the Git hook PATH prefix", () => {
  for (const [platform, delimiter, prefix] of [["win32", ";", "C:/Program Files/Git/mingw64/libexec/git-core"], ["linux", ":", "/usr/lib/git-core"]]) {
    const base = { CI: "true", PATH: `/toolchain/openssl-a${delimiter}/toolchain/bash-a` };
    const hook = { ...base, PATH: `${prefix}${delimiter}${base.PATH}` };
    const changedTool = { ...base, PATH: `/toolchain/openssl-b${delimiter}/toolchain/bash-a` };
    const options = { platform };
    assert.deepEqual(guardResultEnvironment(hook, options), guardResultEnvironment(base, options),
      `${platform}: the known hook wrapper does not change executable resolution`);
    assert.notDeepEqual(guardResultEnvironment(changedTool, options), guardResultEnvironment(base, options),
      `${platform}: a different OpenSSL/Bash search path must not inherit an affected-check proof`);
  }
  assert.notDeepEqual(guardResultEnvironment({ PATH: "/bin", Path: "/alternate" }, { platform: "linux" }), guardResultEnvironment({ PATH: "/bin" }, { platform: "linux" }),
    "POSIX keeps distinct case-sensitive environment names");
});

test("a second unpushed correction retains the published head's receipt as its anchor", async () => {
  const fixture = mappedCorrectionFixture();
  let publishedHead = fixture.originalSha;
  const contextReader = () => {
    const context = fixture.contextReader();
    context.pullRequest.headRefOid = publishedHead;
    return context;
  };
  const run = () => ({ exitCode: 0, stdout: "# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n" });
  const options = { ...fixture.options, persist: true, contextReader, relatedTestsBySource: fixture.mapping, run };
  try {
    const first = await verifyPublishedCorrection(options);
    publishedHead = first.sha;
    fixture.write(3); fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "second local correction");
    const second = await verifyPublishedCorrection(options);
    assert.notEqual(correctionReceiptPath(fixture.cwd, first.sha), correctionReceiptPath(fixture.cwd, second.sha));
    assert.equal(reducedTierClassification(fixture.cwd, { contextReader, recordsReader: () => [] }), "authored-correction",
      "the pre-push eligibility read must find the published head's retained correction proof");
  } finally { fixture.remove(); }
});

test("explicit current mapping takes precedence over retained retry input", async () => {
  const fixture = mappedCorrectionFixture();
  let environment = "direct";
  const identify = () => ({ ...fixture.identify(), environment });
  const options = { ...fixture.options, persist: true, identify };
  try {
    await verifyPublishedCorrection({ ...options, relatedTestsBySource: fixture.mapping });
    const priorBytes = readFileSync(correctionReceiptPath(fixture.cwd), "utf8");
    await assert.rejects(verifyPublishedCorrection({ ...options, relatedTestsBySource: { [fixture.source]: [] } }), /Affected mapping unresolved/);
    assert.equal(readFileSync(correctionReceiptPath(fixture.cwd), "utf8"), priorBytes);
    const replacement = { [fixture.source]: [fixture.target, "scripts/example.test.mjs"] };
    const result = await verifyPublishedCorrection({ ...options, relatedTestsBySource: replacement });
    assert.deepEqual(result.publicationCorrection.relatedTestsBySource, replacement);
    assert.ok(result.publicationCorrection.commands[0].args.includes("scripts/example.test.mjs"));
  } finally { fixture.remove(); }
});

test("stale source, modified plan and changed protection cannot supply retry mapping", async t => {
  for (const mutation of ["source", "plan", "foreign", "protection"]) await t.test(mutation, async () => {
    const fixture = mappedCorrectionFixture();
    let environment = "direct";
    const identify = () => ({ ...fixture.identify(), environment });
    let contextReader = fixture.contextReader;
    try {
      await verifyPublishedCorrection({ ...fixture.options, persist: true, identify, relatedTestsBySource: fixture.mapping });
      environment = "git-hook";
      if (mutation === "source") {
        writeFileSync(join(fixture.cwd, fixture.source), "export const value = 3;\n");
        fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "different source");
      } else if (mutation === "plan" || mutation === "foreign") {
        const path = correctionReceiptPath(fixture.cwd), receipt = JSON.parse(readFileSync(path, "utf8"));
        if (mutation === "plan") receipt.result.publicationCorrection.relatedTestsBySource[fixture.source] = [];
        else receipt.result.publicationCorrection.repositoryFullName = "foreign/repository";
        writeFileSync(path, JSON.stringify(receipt));
      } else contextReader = () => { const value = fixture.contextReader(); value.protection.requiredChecks = ["Changed required CI"]; return value; };
      const inspected = inspectCorrectionRecord(fixture.cwd, { identify, contextReader });
      assert.equal(inspected.ok, false); assert.equal(inspected.reverificationInputs, undefined);
      await assert.rejects(verifyPublishedCorrection({ ...fixture.options, persist: true, identify, contextReader,
        run: () => assert.fail("an unvalidated retained map must never launch checks") }), /Affected mapping unresolved/);
    } finally { fixture.remove(); }
  });
});


test("completion and expiry share one clock instant without widening the proof lifetime", async () => {
  const fixture = gitFixture();
  let tick = Date.now() + 1000;
  try {
    fixture.write(2); fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "clock boundary correction");
    const contextReader = () => { const context = fixture.contextReader(); context.protection.observedAt = new Date(tick).toISOString(); return context; };
    const result = await verifyPublishedCorrection({ ...fixture.options, contextReader, now: () => tick++ });
    const proof = result.publicationCorrection;
    assert.equal(Date.parse(proof.expiresAt) - Date.parse(proof.completedAt), 60 * 60_000);
    assert.equal(classifyPublishedCorrection(result, { now: tick }).ok, true);
    assert.equal(classifyPublishedCorrection(result, { now: Date.parse(proof.expiresAt) }).ok, false);
  } finally { fixture.remove(); }
});

// BI-25CB699C / BI-1A06A1AF: a merge of origin/main onto a published head that
// only regenerates registry-generated files is still a main refresh. The
// reduced tier runs those artifacts' freshness checks plus the existing
// affected plan; it never falls back to "mapping unresolved" and a full gate.
const ROUTES_ARTIFACT = {
  id: "fixture-routes",
  sourceGlobs: ["routes/**"],
  artifactPaths: ["routes.generated.json"],
  generate: ["node", "tools/routes.mjs"],
  check: ["node", "tools/routes.mjs", "--check"],
};
const ROUTES_GENERATOR = `import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const expected = JSON.stringify(readdirSync("routes").sort()) + String.fromCharCode(10);
if (process.argv.includes("--check")) process.exit(readFileSync("routes.generated.json", "utf8") === expected ? 0 : 1);
writeFileSync("routes.generated.json", expected);
`;

function refreshFixture() {
  const fixture = gitFixture();
  const { cwd, git } = fixture;
  const generate = () => execFileSync(process.execPath, ["tools/routes.mjs"], { cwd });
  git("switch", "--quiet", "main");
  mkdirSync(join(cwd, "tools")); mkdirSync(join(cwd, "routes"));
  writeFileSync(join(cwd, "tools", "routes.mjs"), ROUTES_GENERATOR);
  writeFileSync(join(cwd, "routes", "a"), "a\n"); generate();
  git("add", "."); git("commit", "--quiet", "-m", "routes on main");
  git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
  git("switch", "--quiet", branch); git("merge", "--quiet", "--no-edit", "main");
  writeFileSync(join(cwd, "routes", "b"), "b\n"); generate();
  git("add", "."); git("commit", "--quiet", "-m", "branch route");
  const anchorSha = git("rev-parse", "HEAD");
  const contextReader = () => { const value = fixture.contextReader(); value.pullRequest.headRefOid = anchorSha; return value; };
  const initial = { branch, sha: anchorSha, gatePassed: false, skipped: true,
    skipReason: "operator-emergency: existing explicit initial fixture publication", recordedAt: new Date(Date.now() - 1000).toISOString() };
  // main moves the same artifact; the merge conflicts on the generated file only.
  git("switch", "--quiet", "main");
  writeFileSync(join(cwd, "routes", "c"), "c\n"); generate();
  git("add", "."); git("commit", "--quiet", "-m", "main route");
  git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
  git("switch", "--quiet", branch);
  try { git("merge", "--quiet", "--no-edit", "main"); } catch { /* generated-file conflict, resolved by regeneration */ }
  generate(); git("add", "."); git("commit", "--quiet", "--no-edit");
  return { ...fixture, anchorSha, options: { ...fixture.options, contextReader, registry: [ROUTES_ARTIFACT],
    recordsReader: () => [{ state: initial, metadata: null }] } };
}

test("a main refresh that only regenerates registry outputs stays a reduced main-refresh with freshness checks", async () => {
  const fixture = refreshFixture();
  try {
    const result = await verifyPublishedCorrection(fixture.options);
    const proof = result.publicationCorrection;
    assert.equal(proof.classification, "main-refresh");
    assert.equal(proof.anchor.sha, fixture.anchorSha, "the prior PASS is the reused anchor");
    assert.ok(proof.commands.some(command => command.command === "node" && command.args.join(" ") === "tools/routes.mjs --check"),
      JSON.stringify(proof.commands));
    assert.ok(proof.results.every(item => item.exitCode === 0));
    assert.deepEqual(proof.delegated, ["full-local-integration", "protected-github-checks", "merge-queue"]);
    assert.equal(result.gatePassed, false, "reuse is recorded, never relabelled a full local PASS");
  } finally { fixture.remove(); }
});

test("a stale regenerated output fails the reduced tier instead of passing", async () => {
  const fixture = refreshFixture();
  try {
    writeFileSync(join(fixture.cwd, "routes.generated.json"), "[\"a\",\"b\"]\n");
    fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "forgot to regenerate");
    await assert.rejects(verifyPublishedCorrection(fixture.options), /Affected check failed.*tools\/routes\.mjs --check/s);
  } finally { fixture.remove(); }
});

test("a refresh that also rewrites branch-authored source is not a main refresh", async () => {
  const fixture = refreshFixture();
  try {
    fixture.write(5); fixture.git("add", "."); fixture.git("commit", "--quiet", "-m", "authored change");
    const result = await verifyPublishedCorrection(fixture.options);
    assert.equal(result.publicationCorrection.classification, "authored-correction");
  } finally { fixture.remove(); }
});

test("pregate's reduced-tier probe names a regenerated main refresh and nothing else", () => {
  const fixture = refreshFixture();
  try {
    const { contextReader, recordsReader, registry } = fixture.options;
    assert.equal(reducedTierClassification(fixture.cwd, { contextReader, recordsReader, registry }), "main-refresh");
    // Unregistered, the regenerated file is unmapped authored drift: no reduced tier.
    assert.equal(reducedTierClassification(fixture.cwd, { contextReader, recordsReader, registry: [] }), null);
    assert.equal(reducedTierClassification(fixture.cwd, { contextReader: () => { throw new Error("gh unavailable"); }, recordsReader, registry }), null);
  } finally { fixture.remove(); }
});
