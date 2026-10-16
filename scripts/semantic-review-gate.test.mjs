import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";

import { readFailureEvidenceBinding, readGitDiffDigest, validateLocalSemanticReviewGate } from "./lib/semantic-review-gate.mjs";

test("failure evidence binds the requested checkout and exact diff", () => {
  const sha = "a".repeat(40), tree = "b".repeat(40), base = "c".repeat(40);
  const binding = readFailureEvidenceBinding(sha, "candidate", (_command, args, options) => {
    assert.equal(options.cwd, "candidate");
    return { status: 0, stdout: args[0] === "diff" ? Buffer.from("exact diff")
      : args[0] === "merge-base" ? base : args[1] === "HEAD" ? sha : tree };
  });
  assert.deepEqual(binding, { headTreeHash: tree, diffDigest: createHash("sha256").update("exact diff").digest("hex") });
});

test("missing or moved source retains diagnostics without inventing verified bindings", () => {
  for (const spawn of [() => ({ status: 1, stderr: "missing repository" }),
    () => ({ status: 0, stdout: "b".repeat(40) })]) {
    const binding = readFailureEvidenceBinding("a".repeat(40), "candidate", spawn);
    assert.equal(binding.headTreeHash, null);
    assert.equal(binding.diffDigest, null);
    assert.ok(binding.failureAnalysisBindingError);
  }
});

const current = {
  branch: "feat/change-reviewer-enforcement",
  sha: "a".repeat(40),
  capsuleId: "WC-DA3CDA6A",
  baseTreeHash: "b".repeat(40),
  headTreeHash: "c".repeat(40),
  diffDigest: "d".repeat(64),
  policyVersion: "semantic-change-review-policy.v2",
  reviewerVersion: "change-reviewer.v1",
  specialistIds: ["AGT-181"],
};

const state = {
  ...current,
  schemaVersion: "semantic-change-review-local-gate.v1",
  receiptDecision: "pass",
  receiptDisposition: "reviewed",
  recordedAt: "2026-08-01T16:00:00.000Z",
  expiresAt: "2026-08-01T17:00:00.000Z",
  evidenceId: "cms-evidence-1",
};

test("role-bound sidecars cannot authorize another role or a legacy contract", () => {
  const roleCurrent = { ...current, artifactType: "spec" };
  const roleState = { ...state, ...roleCurrent, schemaVersion: "semantic-change-review-local-gate.v2" };
  const now = Date.parse("2026-08-01T16:30:00Z");
  assert.equal(validateLocalSemanticReviewGate(roleState, roleCurrent, now).valid, true);
  assert.equal(validateLocalSemanticReviewGate(roleState, { ...roleCurrent, artifactType: "plan" }, now).valid, false);
  assert.equal(validateLocalSemanticReviewGate(state, roleCurrent, now).valid, false);
  assert.equal(validateLocalSemanticReviewGate(roleState, current, now).valid, false);
});

test("accepts an exact, unexpired completed receipt without network access", () => {
  assert.deepEqual(validateLocalSemanticReviewGate(state, current, Date.parse("2026-08-01T16:30:00Z")), {
    valid: true,
    reason: "fresh-receipt",
  });
});

test("accepts an exact canonical exception while keeping native review UNRUN", () => {
  const exemption = { ...state, receiptDecision: undefined, receiptDisposition: "policy-exemption", nativeReview: "UNRUN",
    exemptionSchemaVersion: "semantic-change-review-exemption.v1", approvedByUserId: "operator", reason: "Audited source publication exception", bindingDigest: "f".repeat(64),
    reviewBasis: "operator-accepted-client-assessment", independentReview: "UNVERIFIED" };
  assert.deepEqual(validateLocalSemanticReviewGate(exemption, current, Date.parse("2026-08-01T16:30:00Z")), { valid: true, reason: "policy-exemption" });
  assert.equal(validateLocalSemanticReviewGate({ ...exemption, nativeReview: "pass" }, current, Date.parse("2026-08-01T16:30:00Z")).valid, false);
  assert.equal(validateLocalSemanticReviewGate({ ...exemption, reviewBasis: undefined }, current, Date.parse("2026-08-01T16:30:00Z")).valid, false);
  assert.equal(validateLocalSemanticReviewGate({ ...exemption, independentReview: "pass" }, current, Date.parse("2026-08-01T16:30:00Z")).valid, false);
  assert.equal(validateLocalSemanticReviewGate({ ...exemption, receiptDecision: "fail" }, current, Date.parse("2026-08-01T16:30:00Z")).valid, false);
});

test("rejects missing, stale, expired, and infrastructure-inconclusive state distinctly", () => {
  assert.deepEqual(validateLocalSemanticReviewGate(null, current, Date.now()), {
    valid: false,
    reason: "missing-receipt",
  });
  assert.equal(validateLocalSemanticReviewGate({ ...state, sha: "e".repeat(40) }, current, Date.parse("2026-08-01T16:30:00Z")).reason, "stale-receipt");
  assert.equal(validateLocalSemanticReviewGate(state, current, Date.parse("2026-08-01T18:00:00Z")).reason, "expired-receipt");
  assert.equal(validateLocalSemanticReviewGate({ ...state, receiptDecision: "inconclusive" }, current, Date.parse("2026-08-01T16:30:00Z")).reason, "infrastructure-inconclusive");
});

test("hashes diffs above Node's historical 1 MiB spawn buffer", () => {
  const diff = Buffer.alloc(2 * 1024 * 1024, 7);
  let options;
  const digest = readGitDiffDigest("merge-base", (_command, _args, received) => {
    options = received;
    return { status: 0, stdout: diff, stderr: Buffer.alloc(0) };
  });

  assert.equal(options.maxBuffer, 256 * 1024 * 1024);
  assert.equal(digest, createHash("sha256").update(diff).digest("hex"));
});

test("reports an exhausted diff buffer distinctly from a git exit", () => {
  assert.throws(
    () => readGitDiffDigest("merge-base", () => ({ status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: { code: "ENOBUFS" } })),
    /exceeded the 256 MiB safety limit/,
  );
});


test("profession-bound publication requires its exact saved obligation digest", () => {
  const identity = { ...current, artifactType: "code-change", reviewerVersion: "change-reviewer.v3-professions", specialistSelectionDigest: "e".repeat(64) };
  const receipt = { ...state, ...identity, schemaVersion: "semantic-change-review-local-gate.v2" };
  const now = Date.parse("2026-08-01T16:30:00Z");
  assert.equal(validateLocalSemanticReviewGate(receipt, identity, now).valid, true);
  assert.deepEqual(validateLocalSemanticReviewGate({ ...receipt, specialistSelectionDigest: undefined }, identity, now), { valid: false, reason: "missing-specialist-selection" });
  assert.equal(validateLocalSemanticReviewGate(receipt, { ...identity, specialistSelectionDigest: "f".repeat(64) }, now).valid, false);
});
