import { sha256Bytes } from "./ci-build-artifact.mjs";

export const CI_EVIDENCE_RECEIPT_SCHEMA_VERSION = 1;
export const CI_EVIDENCE_RECEIPT_KIND = "dpf-github-ci-evidence";
export const CI_EVIDENCE_ARTIFACT_PREFIX = "ci-evidence";
export const CI_EVIDENCE_LIFETIME_MS = 24 * 60 * 60_000;

const TERMINAL_SUCCESS = new Set(["success", "skipped"]);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_DIGEST = /^sha256:[a-f0-9]{64}$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function normalizedGates(gates) {
  return Object.entries(gates ?? {})
    .map(([jobId, value]) => ({
      jobId,
      result: typeof value === "string" ? value : value?.result,
    }))
    .sort((left, right) => left.jobId.localeCompare(right.jobId));
}

export function normalizeArtifactInventory(artifacts) {
  return (artifacts ?? [])
    .filter((artifact) =>
      !new RegExp(`^${CI_EVIDENCE_ARTIFACT_PREFIX}-[a-f0-9]{40}$`).test(artifact.name ?? ""))
    .map((artifact) => ({
      name: artifact.name,
      digest: artifact.digest,
      sizeInBytes: Number(artifact.sizeInBytes ?? artifact.size_in_bytes),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function invalidArtifacts(artifacts) {
  return artifacts.filter((artifact) =>
    typeof artifact.name !== "string"
    || !artifact.name
    || !ARTIFACT_DIGEST.test(artifact.digest ?? "")
    || !Number.isSafeInteger(artifact.sizeInBytes)
    || artifact.sizeInBytes <= 0);
}

export function receiptChecksum(receipt) {
  return sha256Bytes(JSON.stringify(canonical(receipt)));
}

export function createEvidenceReceipt(input) {
  if (input.workflow?.eventName !== "merge_group") {
    throw new Error("CI evidence receipts may only attest merge_group runs");
  }
  const gates = normalizedGates(input.gates);
  const incomplete = gates.filter((gate) => !TERMINAL_SUCCESS.has(gate.result));
  if (incomplete.length > 0) {
    throw new Error(
      `cannot attest incomplete CI gates: ${
        incomplete.map((gate) => `${gate.jobId}=${gate.result ?? "missing"}`).join(", ")
      }`,
    );
  }
  if (gates.length === 0) throw new Error("cannot attest an empty CI gate set");

  const artifacts = normalizeArtifactInventory(input.artifacts);
  if (artifacts.length === 0) throw new Error("cannot attest an empty artifact inventory");
  const invalid = invalidArtifacts(artifacts);
  if (invalid.length > 0) {
    throw new Error(`cannot attest invalid artifacts: ${invalid.map((entry) => entry.name || "unnamed").join(", ")}`);
  }

  return {
    schemaVersion: CI_EVIDENCE_RECEIPT_SCHEMA_VERSION,
    kind: CI_EVIDENCE_RECEIPT_KIND,
    repository: input.repository,
    source: {
      commitSha: input.source.commitSha,
      treeSha: input.source.treeSha,
    },
    workflow: {
      eventName: input.workflow.eventName,
      runId: String(input.workflow.runId),
      runAttempt: String(input.workflow.runAttempt),
      path: input.workflow.workflowPath,
      fingerprint: input.workflow.workflowFingerprint,
    },
    planner: {
      planDigest: input.planner.planDigest,
      implementationFingerprint: input.planner.implementationFingerprint,
    },
    mergePolicy: {
      manifestFingerprint: input.mergePolicy.manifestFingerprint,
      requiredContexts: [...input.mergePolicy.requiredContexts].sort(),
    },
    toolchain: canonical(input.toolchain),
    gates,
    artifacts,
    result: "success",
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
}

export function validateEvidenceReceipt({ receipt, expected, checksum, now = Date.now() }) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { ok: false, reasons: ["receipt is not an object"] };
  }

  const reasons = [];
  if (receipt.schemaVersion !== CI_EVIDENCE_RECEIPT_SCHEMA_VERSION) {
    reasons.push("unsupported schema version");
  }
  if (receipt.kind !== CI_EVIDENCE_RECEIPT_KIND) reasons.push("unexpected receipt kind");
  if (receiptChecksum(receipt) !== checksum) reasons.push("receipt checksum mismatch");
  if (receipt.repository !== expected.repository) reasons.push("repository mismatch");
  if (!SHA40.test(receipt.source?.commitSha ?? "")) reasons.push("invalid source commit SHA");
  if (receipt.source?.commitSha !== expected.sourceCommitSha) reasons.push("source commit SHA mismatch");
  if (!SHA40.test(receipt.source?.treeSha ?? "")) reasons.push("invalid source tree SHA");
  if (receipt.source?.treeSha !== expected.treeSha) reasons.push("tree SHA mismatch");
  if (receipt.workflow?.eventName !== "merge_group") reasons.push("source event must be merge_group");
  if (receipt.workflow?.runId !== String(expected.sourceRunId)) reasons.push("source run mismatch");
  if (receipt.workflow?.path !== expected.workflowPath) reasons.push("workflow path mismatch");
  if (receipt.workflow?.fingerprint !== expected.workflowFingerprint) {
    reasons.push("workflow fingerprint mismatch");
  }
  if (!SHA256.test(receipt.planner?.planDigest ?? "")) reasons.push("invalid producer plan digest");
  if (receipt.planner?.implementationFingerprint !== expected.plannerImplementationFingerprint) {
    reasons.push("planner fingerprint mismatch");
  }
  if (receipt.mergePolicy?.manifestFingerprint !== expected.mergePolicyManifestFingerprint) {
    reasons.push("merge-policy fingerprint mismatch");
  }
  if (!same(
    [...(receipt.mergePolicy?.requiredContexts ?? [])].sort(),
    [...expected.mergePolicyRequiredContexts].sort(),
  )) {
    reasons.push("required-context set mismatch");
  }
  const checksByName = new Map(
    (expected.sourceChecks ?? []).map((check) => [check.name, check]),
  );
  for (const context of receipt.mergePolicy?.requiredContexts ?? []) {
    const check = checksByName.get(context);
    if (check?.status !== "completed" || check.conclusion !== "success") {
      reasons.push(`required context ${context} is not successful`);
    }
  }
  if (!same(receipt.toolchain, expected.toolchain)) reasons.push("toolchain mismatch");

  const receiptGateIds = (receipt.gates ?? []).map((gate) => gate.jobId);
  if (new Set(receiptGateIds).size !== receiptGateIds.length) {
    reasons.push("duplicate gate evidence");
  }
  const gates = normalizedGates(
    Object.fromEntries((receipt.gates ?? []).map((gate) => [gate.jobId, gate.result])),
  );
  const failedGates = gates.filter((gate) => !TERMINAL_SUCCESS.has(gate.result));
  if (receipt.result !== "success" || failedGates.length > 0) {
    reasons.push("receipt does not prove complete successful gates");
  }
  const actualGateIds = gates.map((gate) => gate.jobId).sort();
  const expectedGateIds = [...expected.gateIds].sort();
  if (!same(actualGateIds, expectedGateIds)) reasons.push("gate set mismatch");

  const artifacts = normalizeArtifactInventory(receipt.artifacts);
  if (invalidArtifacts(artifacts).length > 0 || artifacts.length === 0) {
    reasons.push("invalid artifact inventory");
  }
  if (!same(artifacts, normalizeArtifactInventory(expected.artifacts))) {
    reasons.push("artifact inventory mismatch");
  }

  const createdAt = Date.parse(receipt.createdAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
    reasons.push("invalid evidence lifetime");
  } else if (expiresAt - createdAt > CI_EVIDENCE_LIFETIME_MS) {
    reasons.push("evidence lifetime exceeds policy");
  } else if (now > expiresAt) {
    reasons.push("evidence expired");
  } else if (now < createdAt - 5 * 60_000) {
    reasons.push("evidence was created in the future");
  }

  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function evidenceArtifactDiscoveryVerdict({
  artifacts,
  runsById,
  artifactName,
}) {
  const candidates = (artifacts ?? [])
    .filter((artifact) => artifact.name === artifactName && artifact.expired !== true)
    .sort((left, right) =>
      Date.parse(right.created_at ?? 0) - Date.parse(left.created_at ?? 0));
  for (const artifact of candidates) {
    const sourceRunId = artifact.workflow_run?.id;
    const run = runsById.get(sourceRunId);
    if (
      run?.event === "merge_group"
      && run.status === "completed"
      && run.conclusion === "success"
    ) {
      return {
        decision: "found",
        artifactId: artifact.id,
        artifactName: artifact.name,
        sourceRunId,
        reason: `found successful merge-group evidence in run ${sourceRunId}`,
      };
    }
  }
  return {
    decision: "exhaustive",
    artifactId: null,
    artifactName,
    sourceRunId: null,
    reason: candidates.length === 0
      ? "no unexpired exact-tree evidence artifact"
      : "no exact-tree artifact has a completed successful merge-group producer",
  };
}
