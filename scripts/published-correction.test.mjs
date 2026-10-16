import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateReadiness, buildGatePlan } from "./pr-readiness/core.mjs";
import { evaluatePrHealth } from "./pr-health.mjs";
import { evaluateGateRecord, evaluateGateVerdict, decide } from "../packages/dpf-skill-pack/hooks/pregate-evidence-guard.mjs";
import { correctionPlanDigest, classifyPublishedCorrection } from "../packages/dpf-skill-pack/hooks/lib/published-correction.mjs";
import { verifyPublishedCorrection, chooseInitialAnchor, buildCorrectionCommands, qualifyCorrectionExecution, correctionReceiptPath, inspectCorrectionRecord, readPublishedContext, execute } from "./published-correction.mjs";
import { guardShellEnv } from "./lib/guard-bash.mjs";
import { guardGitEnv } from "./lib/git-hook-env.mjs";
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

test("exit zero without an executed complete test report is not affected verification", () => {
  const node = { command: "node", args: ["--test", "--test-reporter=tap", "fixture.test.mjs"] };
  assert.equal(qualifyCorrectionExecution(node, { exitCode: 0, stdout: "no tests executed" }).outcome, "test-report-unproven");
  assert.equal(qualifyCorrectionExecution(node, { exitCode: 0, stdout: "# tests 2\n# pass 1\n# fail 0\n# skipped 1\n# cancelled 0\n# todo 0\n" }).outcome, "test-report-incomplete");
  const vitest = { command: "pnpm", args: ["exec", "vitest", "run", "fixture.test.ts", "--reporter=json"] };
  const report = { numTotalTests: 2, numPassedTests: 1, numFailedTests: 0, numPendingTests: 1, success: true };
  assert.equal(qualifyCorrectionExecution(vitest, { exitCode: 0, stdout: JSON.stringify(report) }).outcome, "test-report-incomplete");
  report.numPassedTests = 2; report.numPendingTests = 0;
  assert.equal(qualifyCorrectionExecution(vitest, { exitCode: 0, stdout: JSON.stringify(report) }).outcome, undefined);
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
