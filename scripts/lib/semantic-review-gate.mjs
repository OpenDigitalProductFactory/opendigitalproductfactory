import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export const LOCAL_SEMANTIC_REVIEW_GATE_SCHEMA_VERSION = "semantic-change-review-local-gate.v1";
export const SEMANTIC_DIFF_MAX_BUFFER = 256 * 1024 * 1024;

export function readGitDiffDigest(mergeBase, spawn = spawnSync) {
  const diff = spawn("git", ["diff", "--binary", mergeBase, "HEAD"], {
    encoding: null,
    maxBuffer: SEMANTIC_DIFF_MAX_BUFFER,
  });
  if (diff.error?.code === "ENOBUFS") {
    throw new Error("git diff exceeded the 256 MiB safety limit; split or remove oversized artifacts before review");
  }
  if (diff.error) throw new Error(`git diff could not start: ${diff.error.message ?? String(diff.error)}`);
  if (diff.status !== 0) throw new Error(diff.stderr?.toString().trim() || `git diff exited ${diff.status}`);
  return createHash("sha256").update(diff.stdout).digest("hex");
}

const IDENTITY_FIELDS = [
  "branch",
  "sha",
  "capsuleId",
  "baseTreeHash",
  "headTreeHash",
  "diffDigest",
  "policyVersion",
  "reviewerVersion",
];

function normalizedIds(value) {
  return [...new Set(Array.isArray(value) ? value.map(String).map((id) => id.trim()).filter(Boolean) : [])].sort();
}

/** Deterministic local adapter: no model, portal, database, or network access. */
export function validateLocalSemanticReviewGate(state, current, nowMs = Date.now()) {
  if (!state || state.schemaVersion !== LOCAL_SEMANTIC_REVIEW_GATE_SCHEMA_VERSION) {
    return { valid: false, reason: "missing-receipt" };
  }
  if (state.receiptDecision === "inconclusive") {
    return { valid: false, reason: "infrastructure-inconclusive" };
  }
  if (state.receiptDecision === "fail") return { valid: false, reason: "semantic-failure" };
  if (state.expiresAt) {
    const expiresAt = Date.parse(state.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return { valid: false, reason: "expired-receipt" };
  }
  const stale = IDENTITY_FIELDS.some((field) => state[field] !== current[field]) ||
    JSON.stringify(normalizedIds(state.specialistIds)) !== JSON.stringify(normalizedIds(current.specialistIds));
  if (stale || !String(state.evidenceId ?? "").trim()) return { valid: false, reason: "stale-receipt" };
  return { valid: true, reason: "fresh-receipt" };
}
