import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";

import { readGitDiffDigest, validateLocalSemanticReviewGate } from "./lib/semantic-review-gate.mjs";

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

test("accepts an exact, unexpired completed receipt without network access", () => {
  assert.deepEqual(validateLocalSemanticReviewGate(state, current, Date.parse("2026-08-01T16:30:00Z")), {
    valid: true,
    reason: "fresh-receipt",
  });
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
