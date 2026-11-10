import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { scriptArgv } from "./script-argv.mjs";
import { CI_EVIDENCE_VALIDITY_LIFETIME_MS } from "./evidence-validity-policy.mjs";
import { isEntryModule } from "./entry-module.mjs";

const digest = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

export function writeDurableJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, path);
}

export function appendTerminationDecision(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
}

// A checkpoint is retained execution material, never canonical evidence. The
// recorder's authority checks remain necessary even for a locally valid packet.
export function writeExecutionCheckpoint(context, exitCode) {
  const metadata = readJson(context.metadataFile);
  const artifact = exitCode === 0 ? readJson(context.artifactFile) : null;
  const packet = {
    schemaVersion: 1, kind: "execution-completed", canonicalEvidenceId: null,
    ownerSessionId: context.ownerSessionId, provider: context.provider,
    leaseId: context.leaseId, gateKey: context.gateKey,
    branch: context.branch, sha: context.sha, exitCode,
    completedAt: new Date().toISOString(),
    metadata, metadataDigest: digest(metadata), artifact, artifactDigest: digest(artifact),
  };
  writeDurableJson(context.path, packet);
  return packet;
}

export function validateExecutionCheckpoint(packet, expected, { now = Date.now() } = {}) {
  const reasons = [];
  if (packet?.schemaVersion !== 1 || packet?.kind !== "execution-completed") reasons.push("checkpoint-incomplete");
  for (const key of ["ownerSessionId", "provider", "leaseId", "gateKey", "branch", "sha"]) {
    if (!expected[key] || packet?.[key] !== expected[key]) reasons.push(`${key}-mismatch`);
  }
  const completed = Date.parse(packet?.completedAt);
  if (!Number.isFinite(completed) || completed > now || now - completed >= CI_EVIDENCE_VALIDITY_LIFETIME_MS) reasons.push("checkpoint-stale");
  const m = packet?.metadata;
  if (!m || digest(m) !== packet?.metadataDigest || (packet?.exitCode === 0 && !packet?.artifact)
    || digest(packet?.artifact) !== packet?.artifactDigest) reasons.push("content-digest-mismatch");
  if (m?.candidateSha !== expected.sha || m?.candidateRef !== expected.branch || m?.runLeaseId !== expected.leaseId) reasons.push("execution-identity-mismatch");
  const executionCompleted = Date.parse(m?.completedAt);
  if (!Number.isFinite(executionCompleted) || executionCompleted > completed
    || now - executionCompleted >= CI_EVIDENCE_VALIDITY_LIFETIME_MS) reasons.push("execution-stale");
  if (digest(m?.productionArtifact) !== packet?.artifactDigest) reasons.push("artifact-provenance-mismatch");
  for (const key of ["baseSha", "integrationCommitSha", "synthesizedTreeSha"]) {
    if (!/^[a-f0-9]{40}$/.test(m?.[key] ?? "")) reasons.push(`${key}-missing`);
  }
  if (!/^[a-f0-9]{64}$/.test(m?.evidencePlan?.digest ?? "") || !m?.evidencePlan?.policyVersion
    || !/^[a-f0-9]{64}$/.test(m?.toolchainFingerprint ?? "")) reasons.push("policy-provenance-incomplete");
  if (expected.policyVersion && m?.evidencePlan?.policyVersion !== expected.policyVersion) reasons.push("policy-version-mismatch");
  if (!Number.isInteger(packet?.exitCode) || m?.execution?.exitCode !== packet.exitCode
    || m?.execution?.status !== (packet.exitCode === 0 ? "passed" : "failed")) reasons.push("execution-outcome-mismatch");
  if (!Array.isArray(m?.commands) || !m.commands.length
    || (packet?.exitCode === 0 && m.execution?.completedCommandCount !== m.commands.length)) reasons.push("commands-incomplete");
  return { valid: reasons.length === 0, reasons };
}

export function validatePendingPublication(pending, packet, expected, options) {
  const args = pending?.recordArgs;
  const evidence = args?.evidence;
  const result = validateExecutionCheckpoint(packet, expected, options);
  const reasons = [...result.reasons];
  if (pending?.branch !== expected.branch || pending?.sha !== expected.sha
    || args?.candidateBranch !== expected.branch || evidence?.sha !== expected.sha
    || args?.externalSessionId !== expected.ownerSessionId || args?.provider !== expected.provider
    || args?.leaseId !== expected.leaseId || args?.gateKey !== expected.gateKey) reasons.push("publication-identity-mismatch");
  if (digest(evidence?.content) !== packet?.metadataDigest) reasons.push("publication-content-mismatch");
  if (evidence?.buildExitCode !== packet?.exitCode
    || args?.status !== (packet?.exitCode === 0 ? "passed" : "failed")
    || evidence?.gatePassed !== (packet?.exitCode === 0)) reasons.push("publication-outcome-mismatch");
  return { valid: reasons.length === 0, reasons };
}

if (isEntryModule(import.meta.url)) {
  const { positionals } = parseArgs({ args: scriptArgv(), allowPositionals: true });
  writeExecutionCheckpoint(JSON.parse(process.env.DPF_GATE_EXECUTION_CONTEXT), Number(positionals.at(0)));
}
