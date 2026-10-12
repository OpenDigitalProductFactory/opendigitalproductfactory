// BI-FFCFCCE0 — `pregate -- --finalize-evidence` resolved its record before
// admission, so it always read slot-0's UNSLOTTED `dpf-local-ci-gate.json`
// while `pregate:status` reconciles across every `dpf-local-ci-gate-slot-*.json`.
// A real pending PASS recorded on slot-1 was therefore unfinalizable, and the
// two commands disagreed about which record was authoritative.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { resolveFinalizeSlot } from "./gate-worktree.mjs";
import { createLocalCiSlotManifest } from "./lib/local-ci-slot-manifest.mjs";
import { writeLocalCiGateState } from "./lib/local-ci-gate-state.mjs";
import { writeExecutionCheckpoint } from "./lib/gate-execution-checkpoint.mjs";
import { loadEvidencePolicy } from "./lib/ci-evidence-plan.mjs";

const BRANCH = "fix/principle-decide-requires-option-id";
const SHA = "04f681eae8d6c3f19a0d3d6e5c9c9b1f2a3b4c5d";

function fixture() {
  const rootClone = mkdtempSync(join(tmpdir(), "dpf-finalize-slot-"));
  const gitCommonDir = join(rootClone, ".git");
  const candidateGitDir = join(gitCommonDir, "worktrees", "candidate");
  mkdirSync(candidateGitDir, { recursive: true });
  return { rootClone, gitCommonDir, candidateGitDir };
}

function manifestFor(slotKey, paths) {
  return createLocalCiSlotManifest({ slotKey, ...paths });
}

test("a pending PASS on slot-1 is found, not refused because slot-0 is empty", () => {
  const paths = fixture();
  const slot1 = manifestFor("slot-1", paths);
  writeFileSync(
    slot1.evidence.pending,
    `${JSON.stringify({ branch: BRANCH, sha: SHA, recordArgs: {} }, null, 2)}\n`,
  );

  const resolved = resolveFinalizeSlot({ branch: BRANCH, sha: SHA, ...paths, defaultSlotKey: "slot-0" });

  assert.equal(resolved.manifest.slotKey, "slot-1");
  assert.equal(resolved.matchedBy, "pending");
});

test("a published PASS on slot-1 is found when no pending record exists", () => {
  const paths = fixture();
  const slot1 = manifestFor("slot-1", paths);
  writeLocalCiGateState(slot1.evidence.state, {
    branch: BRANCH,
    sha: SHA,
    gatePassed: true,
    leaseId: "NPEL-50DF305E6C",
    evidenceId: "cmtv4u0220h4301qn5r8le9ev",
    status: "passed",
    expiresAt: "2026-09-11T06:00:00.000Z",
    resilience: null,
    leaseEvents: [],
  });

  const resolved = resolveFinalizeSlot({ branch: BRANCH, sha: SHA, ...paths, defaultSlotKey: "slot-0" });

  assert.equal(resolved.manifest.slotKey, "slot-1");
  assert.equal(resolved.matchedBy, "published-pass");
});

test("a record for another candidate does not claim the finalize, and the refusal can name every path searched", () => {
  const paths = fixture();
  const slot1 = manifestFor("slot-1", paths);
  writeLocalCiGateState(slot1.evidence.state, {
    branch: BRANCH,
    sha: "f".repeat(40),
    gatePassed: true,
    leaseId: "NPEL-OTHER",
    evidenceId: "E-other",
    status: "passed",
    expiresAt: "2026-09-11T06:00:00.000Z",
    resilience: null,
    leaseEvents: [],
  });

  const resolved = resolveFinalizeSlot({ branch: BRANCH, sha: SHA, ...paths, defaultSlotKey: "slot-0" });

  assert.equal(resolved.matchedBy, "none");
  assert.equal(resolved.manifest.slotKey, "slot-0");
  // Both slots' pending AND state paths are reported, so an operator reading the
  // refusal can tell a missing record from one the gate failed to look for.
  for (const slotKey of ["slot-0", "slot-1"]) {
    const manifest = manifestFor(slotKey, paths);
    assert.ok(resolved.searched.includes(manifest.evidence.pending), `${slotKey} pending`);
    assert.ok(resolved.searched.includes(manifest.evidence.state), `${slotKey} state`);
  }
});

for (const exitCode of [0, 2]) {
  test(`finalizer republishes exit ${exitCode} after lost acknowledgement without changing its verdict`, async () => {
    const rootClone = mkdtempSync(join(tmpdir(), "dpf-finalize-recovery-"));
    const git = (args) => {
      const result = spawnSync("git", args, { cwd: rootClone, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(["init", "-q", "-b", "fix/recovery-test"]);
    git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "fixture"]);
    const sha = git(["rev-parse", "HEAD"]);
    const gitCommonDir = join(rootClone, ".git");
    const slot = manifestFor("slot-0", { rootClone, gitCommonDir, candidateGitDir: gitCommonDir });
    const log = join(rootClone, "build.log");
    const context = {
      path: `${log}.NPEL-RECOVERY.execution.json`, metadataFile: slot.evidence.metadata,
      artifactFile: slot.evidence.artifact, ownerSessionId: "recovery-session", provider: "codex",
      leaseId: "NPEL-RECOVERY", gateKey: "a".repeat(64), branch: "fix/recovery-test", sha,
    };
    const completedAt = new Date(Date.now() - 30_000).toISOString();
    const metadata = {
      candidateSha: sha, candidateRef: context.branch, runLeaseId: context.leaseId,
      baseSha: sha, integrationCommitSha: sha, synthesizedTreeSha: git(["rev-parse", "HEAD^{tree}"]),
      evidencePlan: { digest: "b".repeat(64), policyVersion: loadEvidencePolicy().policyVersion },
      toolchainFingerprint: "c".repeat(64), commands: ["fixture"], completedAt,
      execution: { status: exitCode === 0 ? "passed" : "failed", exitCode, completedCommandCount: exitCode === 0 ? 1 : 0 },
      productionArtifact: exitCode === 0 ? { kind: "delegated", identity: "merge-queue" } : null,
    };
    writeFileSync(context.metadataFile, JSON.stringify(metadata));
    writeFileSync(context.artifactFile, JSON.stringify(metadata.productionArtifact));
    writeExecutionCheckpoint(context, exitCode);
    const args = {
      provider: context.provider, externalSessionId: context.ownerSessionId, candidateBranch: context.branch,
      leaseId: context.leaseId, gateKey: context.gateKey, mode: "single-branch", status: metadata.execution.status,
      summary: "fixture only", evidence: { sha, content: metadata, buildExitCode: exitCode, gatePassed: exitCode === 0,
        fullLogFile: log, leaseId: context.leaseId },
    };
    const pending = { branch: context.branch, sha, recordArgs: args };
    writeFileSync(slot.evidence.pending, JSON.stringify(pending));
    let calls = 0;
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const payload = JSON.parse(body);
        if (payload.params.name === "record_local_integration_result") {
          assert.deepEqual(payload.params.arguments, args);
          assert.equal(existsSync(slot.evidence.pending), true);
          calls += 1;
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id,
          result: { content: [{ type: "text", text: JSON.stringify({ success: true, entityId: "already-published" }) }] } }));
      });
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const run = () => new Promise((done, reject) => {
      const child = spawn(process.execPath, [resolve("scripts/gate-worktree.mjs"), "--finalize-evidence",
        "--branch", context.branch, "--sha", sha, "--worktree", rootClone,
        "--owner-provider", "codex", "--owner-session-id", context.ownerSessionId,
        "--mcp-url", `http://127.0.0.1:${server.address().port}`, "--no-push"],
      { env: { ...process.env, DPF_MCP_BEARER_TOKEN: "test-token" } });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.once("error", reject);
      child.once("close", (code) => done({ code, output }));
    });
    try {
      const result = await run();
      assert.equal(result.code, exitCode === 0 ? 0 : 1, result.output);
      const state = JSON.parse(readFileSync(slot.evidence.state, "utf8"));
      assert.equal(state.gatePassed, exitCode === 0);
      assert.equal(state.status, metadata.execution.status);
      assert.equal(state.evidenceRecordId, "already-published");
      assert.equal(state.evidenceValidity.issuedAt, completedAt);
      assert.equal(existsSync(slot.evidence.pending), false);
      assert.equal(calls, 1);
      // A different caller cannot replay the original owner's retained packet.
      pending.recordArgs.externalSessionId = "other-session";
      writeFileSync(slot.evidence.pending, JSON.stringify(pending), { flag: "wx" });
      const refused = await run();
      assert.notEqual(refused.code, 0);
      assert.match(refused.output, /publication-identity-mismatch/);
      assert.equal(calls, 1);
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  });
}
