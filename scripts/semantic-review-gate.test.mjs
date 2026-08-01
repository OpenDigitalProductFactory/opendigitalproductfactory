import assert from "node:assert/strict";
import test from "node:test";

import { validateLocalSemanticReviewGate } from "./lib/semantic-review-gate.mjs";

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
