import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySlotRecord } from "./pregate-status.mjs";
import { readLocalCiGateState } from "./local-ci-gate-state.mjs";
import {
  couldBeDocumentationFiles,
  createPreAdmissionGateIdentity,
  repositorySlugFromRemote,
  runPreAdmissionDocumentationLane,
} from "./documentation-evidence-lane.mjs";

describe("couldBeDocumentationFiles", () => {
  it("admits documentation plus its generated index", () => {
    assert.equal(couldBeDocumentationFiles([
      "docs/operations/gates.md",
      "apps/web/lib/docs/doc-index.generated.json",
    ]), true);
  });

  it("rejects runtime, policy, empty, and executable-standard changes", () => {
    for (const files of [
      [],
      ["scripts/gate-worktree.mjs"],
      ["config/ci-evidence-policy.json"],
      ["docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md"],
    ]) {
      assert.equal(couldBeDocumentationFiles(files), false, files.join(", "));
    }
  });
});

async function documentationFixture(t, command = "console.log('checked');") {
  const directory = mkdtempSync(join(tmpdir(), "dpf-doc-producer-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const worktreePath = join(directory, "source");
  mkdirSync(join(worktreePath, "scripts"), { recursive: true });
  mkdirSync(join(worktreePath, "docs"));
  const git = (...args) => execFileSync("git", args, { cwd: worktreePath, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Document contract test");
  git("config", "user.email", "document-test@example.invalid");
  for (const name of ["gen-doc-index.mjs", "check-doc-links.mjs", "check-guards.mjs"]) {
    writeFileSync(join(worktreePath, "scripts", name), name === "check-doc-links.mjs" ? command : "console.log('checked');");
  }
  const plannerPath = join(worktreePath, "scripts", "planner.mjs");
  writeFileSync(plannerPath, `import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const arg = key => process.argv[process.argv.indexOf(key)+1];
writeFileSync(arg('--output'), JSON.stringify({ executionLane:'documentation', fullSuite:false,
headTreeSha:execFileSync('git',['rev-parse',arg('--head')+'^{tree}'],{encoding:'utf8'}).trim(),
digest:'${"e".repeat(64)}', plannerVersion:1, policyVersion:1, globalGuards:[] }));`);
  git("add", ".");
  git("commit", "-m", "fixture baseline");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("remote", "add", "origin", "https://github.com/example/document-fixture.git");
  git("switch", "-c", "fix/document-fixture");
  writeFileSync(join(worktreePath, "docs", "example.md"), "# Exact document\n");
  git("add", ".");
  git("commit", "-m", "fixture document");
  const requests = [];
  let reply = { success: true, entityId: "EXT-DOCUMENT-TEST" };
  let onRequest = () => {};
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    requests.push(body.params);
    onRequest();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: reply } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const args = {
    branch: "fix/document-fixture", sha: git("rev-parse", "HEAD"), worktreePath, gitBin: "git",
    ownerProvider: "codex", ownerSessionId: "isolated-document-test",
    mcpUrl: `http://127.0.0.1:${server.address().port}/api/mcp/v1`, bearerToken: "test-only",
    stateFile: join(directory, "state.json"), planFile: join(directory, "plan.json"), plannerPath,
  };
  const metadataFile = join(directory, "metadata.json");
  writeFileSync(metadataFile, JSON.stringify({ candidateSha: "b".repeat(40), execution: { failedCommand: "preserved previous code failure" } }));
  const verdict = () => classifySlotRecord({
    state: readLocalCiGateState(args.stateFile), metadata: JSON.parse(readFileSync(metadataFile, "utf8")),
    headSha: git("rev-parse", "HEAD"), headBranch: args.branch,
  });
  return { args, git, requests, verdict, metadataFile, setReply: (value) => { reply = value; }, onRequest: (fn) => { onRequest = fn; } };
}

describe("documentation producer through the authoritative reader", () => {
  it("publishes its own immutable evidence without reserving capacity or overwriting old diagnostics", async (t) => {
    const f = await documentationFixture(t);
    const oldMetadata = readFileSync(f.metadataFile, "utf8");
    f.onRequest(() => assert.notEqual(f.verdict().verdict, "PASS"));
    const result = await runPreAdmissionDocumentationLane(f.args);
    assert.equal(result.status, 0);
    assert.equal(f.verdict().verdict, "PASS");
    assert.equal(f.verdict().candidateSha, f.args.sha);
    assert.equal(readFileSync(f.metadataFile, "utf8"), oldMetadata);
    assert.deepEqual(f.requests.map((r) => r.name), ["record_local_integration_result"]);
    assert.equal(f.requests[0].arguments.evidence.sha, f.args.sha);
    assert.equal(f.requests[0].arguments.evidence.leaseId, null);
  });

  it("retains a failed documentation check as FAIL with its own diagnostic", async (t) => {
    const f = await documentationFixture(t, "process.exit(2);");
    assert.equal((await runPreAdmissionDocumentationLane(f.args)).status, 2);
    const verdict = f.verdict();
    assert.equal(verdict.verdict, "FAIL");
    assert.match(verdict.reason, /check-doc-links/);
    assert.doesNotMatch(verdict.reason, /previous code failure/);
  });

  it("recovers after unavailable or incomplete evidence publication without a false PASS", async (t) => {
    const f = await documentationFixture(t);
    for (const reply of [{ success: false, error: "unavailable" }, { success: true }]) {
      f.setReply(reply);
      await assert.rejects(runPreAdmissionDocumentationLane(f.args), /failed to record documentation evidence/);
      assert.notEqual(f.verdict().verdict, "PASS");
      assert.equal(readLocalCiGateState(f.args.stateFile).evidencePending, true);
    }
    f.setReply({ success: true, entityId: "EXT-RESTORED" });
    assert.equal((await runPreAdmissionDocumentationLane(f.args)).status, 0);
    assert.equal(f.verdict().verdict, "PASS");
    assert.equal(f.verdict().evidenceId, "EXT-RESTORED");
  });

  it("a source edit during publication preserves evidence but cannot publish a current PASS", async (t) => {
    const f = await documentationFixture(t);
    f.onRequest(() => writeFileSync(join(f.args.worktreePath, "docs", "example.md"), "# Changed during publication\n"));
    assert.equal((await runPreAdmissionDocumentationLane(f.args)).status, 1);
    assert.notEqual(f.verdict().verdict, "PASS");
    assert.equal(readLocalCiGateState(f.args.stateFile).evidenceRecordId, "EXT-DOCUMENT-TEST");
  });
});

describe("pre-admission immutable gate identity", () => {
  it("maps the planner and toolchain outputs without using caller identity", () => {
    assert.deepEqual(createPreAdmissionGateIdentity({
      repository: "OpenDigitalProductFactory/OpenDigitalProductFactory",
      plan: {
        headTreeSha: "a".repeat(40),
        digest: "b".repeat(64),
      },
      toolchainFingerprint: "c".repeat(64),
    }), {
      repository: "OpenDigitalProductFactory/OpenDigitalProductFactory",
      integrationTreeSha: "a".repeat(40),
      evidencePlanDigest: "b".repeat(64),
      toolchainFingerprint: "c".repeat(64),
      gateKind: "local-integration-ci",
    });
  });

  it("normalizes supported GitHub origin URL shapes", () => {
    assert.equal(
      repositorySlugFromRemote("git@github.com:OpenDigitalProductFactory/opendigitalproductfactory.git"),
      "OpenDigitalProductFactory/opendigitalproductfactory",
    );
    assert.equal(
      repositorySlugFromRemote("https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git"),
      "OpenDigitalProductFactory/opendigitalproductfactory",
    );
  });
});
