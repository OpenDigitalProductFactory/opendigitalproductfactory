import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { writeExecutionCheckpoint, validateExecutionCheckpoint, validatePendingPublication } from "./gate-execution-checkpoint.mjs";

function fixture(exitCode = 0) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-execution-checkpoint-"));
  const context = {
    path: join(dir, "execution.json"), metadataFile: join(dir, "metadata.json"),
    artifactFile: join(dir, "artifact.json"),
    ownerSessionId: "session-1", provider: "codex", leaseId: "NPEL-TEST",
    gateKey: "a".repeat(64), branch: "fix/example", sha: "b".repeat(40),
  };
  const metadata = {
    candidateSha: context.sha, candidateRef: context.branch, runLeaseId: context.leaseId,
    baseSha: "c".repeat(40), integrationCommitSha: "d".repeat(40), synthesizedTreeSha: "e".repeat(40),
    evidencePlan: { digest: "f".repeat(64), policyVersion: "v1" }, toolchainFingerprint: "1".repeat(64),
    commands: ["test"], execution: { status: exitCode === 0 ? "passed" : "failed", exitCode, completedCommandCount: exitCode === 0 ? 1 : 0 },
    completedAt: new Date().toISOString(), productionArtifact: exitCode === 0 ? { kind: "delegated", identity: "merge-queue" } : null,
  };
  writeFileSync(context.metadataFile, JSON.stringify(metadata));
  writeFileSync(context.artifactFile, JSON.stringify(metadata.productionArtifact));
  return { context, metadata };
}

test("loss after checkpoint publication retains completed material while the owned job closes", { skip: process.platform !== "win32", timeout: 20_000 }, async () => {
  const { context } = fixture();
  const writer = `${context.path}.writer.mjs`;
  writeFileSync(writer, `import { writeExecutionCheckpoint } from ${JSON.stringify(new URL("./gate-execution-checkpoint.mjs", import.meta.url).href)};
writeExecutionCheckpoint(JSON.parse(process.env.DPF_GATE_EXECUTION_CONTEXT), 0);
console.log("checkpoint-written");
setInterval(() => {}, 1000);`);
  const child = spawn("powershell.exe", ["-NoProfile", "-File", fileURLToPath(new URL("./run-in-windows-job.ps1", import.meta.url))], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, DPF_WINDOWS_JOB_COMMAND: JSON.stringify({ kind: "argv", value: [process.execPath, "-e", "process.exit(0)"] }),
      DPF_GATE_NODE: process.execPath, DPF_GATE_CHECKPOINT_WRITER: writer,
      DPF_GATE_EXECUTION_CONTEXT: JSON.stringify(context) },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const closed = once(child, "close");
  try {
    const deadline = Date.now() + 12_000;
    while (!output.includes("checkpoint-written") && child.exitCode === null && Date.now() < deadline) await delay(50);
    assert.match(output, /checkpoint-written/);
    child.stdin.end();
    const [exitCode] = await closed;
    assert.equal(exitCode, 75, output);
    const packet = JSON.parse(readFileSync(context.path, "utf8"));
    assert.equal(validateExecutionCheckpoint(packet, context).valid, true);
    assert.equal(packet.canonicalEvidenceId, null);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});

test("completed execution is persisted with its immutable provenance before returning", () => {
  const { context } = fixture();
  const packet = writeExecutionCheckpoint(context, 0);
  assert.equal(packet.kind, "execution-completed");
  assert.equal(packet.canonicalEvidenceId, null);
  assert.deepEqual(JSON.parse(readFileSync(context.path, "utf8")), packet);
  assert.equal(validateExecutionCheckpoint(packet, context).valid, true);
});

test("command failure stays failed in the checkpoint", () => {
  const { context } = fixture(2);
  const packet = writeExecutionCheckpoint(context, 2);
  assert.equal(packet.exitCode, 2);
  assert.equal(packet.metadata.execution.status, "failed");
});

test("wrong owner, changed candidate, stale and incomplete material are refused", () => {
  const { context } = fixture();
  const packet = writeExecutionCheckpoint(context, 0);
  for (const change of [{ ownerSessionId: "other" }, { sha: "9".repeat(40) }, { leaseId: "other" }, { gateKey: "2".repeat(64) }]) {
    assert.equal(validateExecutionCheckpoint(packet, { ...context, ...change }).valid, false);
  }
  assert.equal(validateExecutionCheckpoint({ ...packet, completedAt: "2020-01-01T00:00:00Z" }, context).valid, false);
  assert.equal(validateExecutionCheckpoint({ ...packet, metadata: null }, context).valid, false);
});

test("mutating retained metadata or artifact invalidates its digest", () => {
  const { context } = fixture();
  const packet = writeExecutionCheckpoint(context, 0);
  assert.equal(validateExecutionCheckpoint({ ...packet, artifact: { kind: "invented" } }, context).valid, false);
});

test("republication retains the original failed outcome and refuses a forged pass", () => {
  const { context, metadata } = fixture(2);
  const packet = writeExecutionCheckpoint(context, 2);
  const pending = { branch: context.branch, sha: context.sha, recordArgs: {
    provider: context.provider, externalSessionId: context.ownerSessionId,
    candidateBranch: context.branch, leaseId: context.leaseId, gateKey: context.gateKey,
    status: "failed", evidence: { sha: context.sha, content: metadata, buildExitCode: 2, gatePassed: false },
  } };
  assert.equal(validatePendingPublication(pending, packet, context).valid, true);
  pending.recordArgs.status = "passed";
  pending.recordArgs.evidence.gatePassed = true;
  assert.equal(validatePendingPublication(pending, packet, context).valid, false);
});

test("republication rejects changed source evidence and a different authenticated session", () => {
  const { context, metadata } = fixture();
  const packet = writeExecutionCheckpoint(context, 0);
  const pending = { branch: context.branch, sha: context.sha, recordArgs: {
    provider: context.provider, externalSessionId: context.ownerSessionId,
    candidateBranch: context.branch, leaseId: context.leaseId, gateKey: context.gateKey,
    status: "passed", evidence: { sha: context.sha, content: metadata, buildExitCode: 0, gatePassed: true },
  } };
  assert.equal(validatePendingPublication(pending, packet, context).valid, true);
  assert.equal(validatePendingPublication(pending, packet, { ...context, ownerSessionId: "different" }).valid, false);
  pending.recordArgs.evidence.content = { ...metadata, synthesizedTreeSha: "0".repeat(40) };
  assert.equal(validatePendingPublication(pending, packet, context).valid, false);
});
