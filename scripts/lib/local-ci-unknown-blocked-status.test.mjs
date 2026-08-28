import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fallbackUnknownBlockedEvidence,
  shouldFallbackUnknownBlockedStatus,
} from "./local-ci-unknown-blocked-status.mjs";

test("blocked_child_signal_death rejected as invalid_status falls back (BI-BC57E1AC)", () => {
  assert.equal(
    shouldFallbackUnknownBlockedStatus({
      outcomeStatus: "blocked_child_signal_death",
      evidenceSuccess: false,
      evidenceError: "invalid_status",
    }),
    true,
  );
});

test("the existing blocked_sandbox_drift fallback still matches", () => {
  assert.equal(
    shouldFallbackUnknownBlockedStatus({
      outcomeStatus: "blocked_sandbox_drift",
      evidenceSuccess: false,
      evidenceError: "invalid_status",
    }),
    true,
  );
});

test("a successful write never falls back", () => {
  assert.equal(
    shouldFallbackUnknownBlockedStatus({
      outcomeStatus: "blocked_child_signal_death",
      evidenceSuccess: true,
      evidenceError: "invalid_status",
    }),
    false,
  );
});

test("a transport error is not an unknown-status fallback", () => {
  assert.equal(
    shouldFallbackUnknownBlockedStatus({
      outcomeStatus: "blocked_child_signal_death",
      evidenceSuccess: false,
      evidenceError: "transport_unavailable",
    }),
    false,
  );
});

test("a product failed status is not rewritten", () => {
  assert.equal(
    shouldFallbackUnknownBlockedStatus({
      outcomeStatus: "failed",
      evidenceSuccess: false,
      evidenceError: "invalid_status",
    }),
    false,
  );
});

test("fallback payload is failed and keeps the original summary after a marker", () => {
  const out = fallbackUnknownBlockedEvidence(
    { status: "blocked_child_signal_death", summary: "child killed by SIGTERM", candidateBranch: "feat/x" },
    "blocked_child_signal_death",
  );
  assert.equal(out.status, "failed");
  assert.equal(out.candidateBranch, "feat/x");
  assert.match(out.summary, /blocked_child_signal_death/);
  assert.match(out.summary, /not product evidence/);
  assert.match(out.summary, /child killed by SIGTERM/);
});
