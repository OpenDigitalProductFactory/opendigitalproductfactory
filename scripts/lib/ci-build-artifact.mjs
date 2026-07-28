import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const BUILD_ARTIFACT_SCHEMA_VERSION = 1;
export const BUILD_ARTIFACT_KIND = "dpf-web-production-build";
export const BUILD_ARTIFACT_ROOT = "apps/web/.next runtime subset";

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

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

export function toolchainFingerprint(toolchain) {
  return sha256Bytes(JSON.stringify(canonical(toolchain)));
}

export function createBuildArtifactReceipt({
  repository,
  commitSha,
  treeSha,
  eventName,
  runId,
  runAttempt,
  plannerDigest,
  toolchain,
  environmentFingerprint,
  payloadSha256,
  payloadSizeBytes,
  createdAt,
  expiresAt,
}) {
  return {
    schemaVersion: BUILD_ARTIFACT_SCHEMA_VERSION,
    kind: BUILD_ARTIFACT_KIND,
    repository,
    source: {
      commitSha,
      treeSha,
    },
    workflow: {
      eventName,
      runId: String(runId),
      runAttempt: String(runAttempt),
      plannerDigest,
    },
    toolchain,
    toolchainFingerprint: toolchainFingerprint(toolchain),
    environmentFingerprint,
    artifact: {
      root: BUILD_ARTIFACT_ROOT,
      payload: "web-production-build.tar.gz",
      sha256: payloadSha256,
      sizeBytes: payloadSizeBytes,
    },
    build: {
      command: "pnpm --filter web build",
      result: "success",
    },
    createdAt,
    expiresAt,
  };
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function validateBuildArtifactReceipt(receipt, expected, now = Date.now()) {
  const reasons = [];
  if (!receipt || typeof receipt !== "object") {
    return { ok: false, reasons: ["receipt is not an object"] };
  }
  if (receipt.schemaVersion !== BUILD_ARTIFACT_SCHEMA_VERSION) reasons.push("unsupported schema version");
  if (receipt.kind !== BUILD_ARTIFACT_KIND) reasons.push("unexpected artifact kind");
  if (receipt.repository !== expected.repository) reasons.push("repository mismatch");
  if (receipt.source?.commitSha !== expected.commitSha) reasons.push("commit SHA mismatch");
  if (receipt.source?.treeSha !== expected.treeSha) reasons.push("tree SHA mismatch");
  if (receipt.workflow?.eventName !== expected.eventName) reasons.push("workflow event mismatch");
  if (receipt.workflow?.runId !== String(expected.sourceRunId)) reasons.push("source run mismatch");
  if (!/^[a-f0-9]{64}$/.test(receipt.workflow?.plannerDigest ?? "")) reasons.push("missing or invalid planner digest");
  if (!same(receipt.toolchain, expected.toolchain) ||
      receipt.toolchainFingerprint !== toolchainFingerprint(expected.toolchain)) {
    reasons.push("toolchain mismatch");
  }
  if (!/^[a-f0-9]{64}$/.test(receipt.environmentFingerprint ?? "") ||
      receipt.environmentFingerprint !== expected.environmentFingerprint) {
    reasons.push("build environment mismatch");
  }
  if (receipt.artifact?.root !== BUILD_ARTIFACT_ROOT ||
      receipt.artifact?.payload !== "web-production-build.tar.gz") {
    reasons.push("artifact contract mismatch");
  }
  if (receipt.artifact?.sha256 !== expected.payloadSha256) reasons.push("payload checksum mismatch");
  if (receipt.artifact?.sizeBytes !== expected.payloadSizeBytes) reasons.push("payload size mismatch");
  if (receipt.build?.command !== "pnpm --filter web build" || receipt.build?.result !== "success") {
    reasons.push("receipt does not prove a successful build");
  }
  const createdAt = Date.parse(receipt.createdAt);
  const expiresAt = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
    reasons.push("invalid evidence lifetime");
  } else if (now > expiresAt) {
    reasons.push("build evidence expired");
  } else if (now < createdAt - 5 * 60_000) {
    reasons.push("build evidence was created in the future");
  }
  return { ok: reasons.length === 0, reasons };
}

function normalizedArchivePath(entry) {
  return entry.trim().replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

export function validateArchiveEntries(entries) {
  const reasons = [];
  const normalized = entries.map(normalizedArchivePath).filter(Boolean);
  for (const entry of normalized) {
    const segments = entry.split("/");
    if (entry.startsWith("/") || /^[A-Za-z]:\//.test(entry) || segments.includes("..")) {
      reasons.push(`unsafe archive path: ${entry}`);
      continue;
    }
    if (entry !== ".next" && !entry.startsWith(".next/")) {
      reasons.push(`archive entry outside .next: ${entry}`);
    }
  }
  if (!normalized.includes(".next/standalone/apps/web/.next/BUILD_ID")) {
    reasons.push("archive is missing the standalone BUILD_ID");
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function selectBuildArtifact({
  runs,
  artifactsByRun,
  headSha,
  eventName,
  artifactPrefix,
}) {
  const candidates = runs
    .filter((run) => run.head_sha === headSha && run.event === eventName)
    .sort((left, right) =>
      (right.run_number - left.run_number) || (right.run_attempt - left.run_attempt));
  for (const run of candidates) {
    const artifact = (artifactsByRun.get(run.id) ?? []).find((entry) =>
      !entry.expired && entry.name.startsWith(`${artifactPrefix}-`));
    if (artifact) {
      return {
        artifactId: artifact.id,
        artifactName: artifact.name,
        runId: run.id,
        runAttempt: run.run_attempt,
      };
    }
  }
  return null;
}
