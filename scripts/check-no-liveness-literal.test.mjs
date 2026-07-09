// Self-test for the liveness-literal ratchet (BI-B6157FB7).
import { test } from "node:test";
import assert from "node:assert/strict";

import { findLiteralLines } from "./check-no-liveness-literal.mjs";

test("flags an inline [\"working\", \"active\"] array", () => {
  const body = `where: { status: { in: ["working", "active"] } },`;
  assert.equal(findLiteralLines(body).length, 1);
});

test("flags the reversed order and single quotes", () => {
  assert.equal(findLiteralLines(`x = ["active", "working"]`).length, 1);
  assert.equal(findLiteralLines(`x = ['working', 'active']`).length, 1);
});

test("does NOT flag a spread of TASK_LIVE_STATES", () => {
  const body = `where: { status: { in: [...TASK_LIVE_STATES] } },`;
  assert.equal(findLiteralLines(body).length, 0);
});

test("does NOT flag SQL single-quote IN or a lone status", () => {
  assert.equal(findLiteralLines(`WHERE tr.status IN ('working','active')`).length, 0);
  assert.equal(findLiteralLines(`data: { status: "active" }`).length, 0);
});

test("does NOT flag a commented example", () => {
  assert.equal(findLiteralLines(`// legacy ["working", "active"] filter`).length, 0);
});
