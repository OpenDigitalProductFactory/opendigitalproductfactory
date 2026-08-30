// BI-24D5D7C2 — a deadline on one control-plane probe must not read as a broken
// endpoint, and must not be tight enough to abort a build that is fine.

import assert from "node:assert/strict";
import { test } from "node:test";

import { isTimeoutRejection } from "./local-ci-bounded-build.mjs";

test("recognises an inner mcpCall deadline as a timeout", () => {
  // The live repro: elapsedMs 2519 against a 2500ms mcpCall deadline, reported
  // as "request-failed" because the message was not the bare word "timeout".
  assert.equal(
    isTimeoutRejection(new Error("mcpCall: get_quiescence_status timed out after 2500ms")),
    true,
  );
});

test("recognises the bare local race rejection", () => {
  assert.equal(isTimeoutRejection(new Error("timeout")), true);
});

test("recognises an AbortSignal.timeout rejection by name", () => {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  assert.equal(isTimeoutRejection(error), true);
});

test("does NOT call a genuine connection fault a timeout", () => {
  // The distinction is the whole point: a real fault must stay reported as one.
  assert.equal(isTimeoutRejection(new Error("ECONNREFUSED 127.0.0.1:3000")), false);
  assert.equal(isTimeoutRejection(new Error("invalid JSON response")), false);
});

test("survives a non-Error rejection", () => {
  assert.equal(isTimeoutRejection("timed out"), true);
  assert.equal(isTimeoutRejection(undefined), false);
});
