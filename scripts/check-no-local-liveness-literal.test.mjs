/**
 * BI-B6157FB7 — tests for the liveness-literal duplication ratchet.
 * Run: node --test scripts/check-no-local-liveness-literal.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  CANONICAL,
  findLivenessLiterals,
  findStaleAllowlist,
  scanRepo,
} from "./check-no-local-liveness-literal.mjs";

test("flags an inline array literal (either order, either quote)", () => {
  assert.equal(findLivenessLiterals('status: { in: ["working", "active"] }').length, 1);
  assert.equal(findLivenessLiterals("const s = ['active','working'];").length, 1);
  assert.equal(findLivenessLiterals('where: { status: { in: ["working","active"] } }').length, 1);
});

test("flags a raw-SQL IN list (case-insensitive on IN)", () => {
  assert.equal(findLivenessLiterals("WHERE tr.status IN ('working', 'active')").length, 1);
  assert.equal(findLivenessLiterals("where status in ('active','working')").length, 1);
});

test("does NOT flag the canonical import or constant usage", () => {
  assert.equal(
    findLivenessLiterals('import { TASK_LIVE_STATES } from "@/lib/tak/task-states";').length,
    0,
  );
  assert.equal(findLivenessLiterals("status: { in: [...TASK_LIVE_STATES] }").length, 0);
  assert.equal(
    findLivenessLiterals("WHERE tr.status IN (${Prisma.join([...TASK_LIVE_STATES])})").length,
    0,
  );
});

test("does NOT flag an unrelated two-string array", () => {
  assert.equal(findLivenessLiterals('const x = ["working", "done"];').length, 0);
  assert.equal(findLivenessLiterals('const y = ["submitted", "active"];').length, 0);
});

test("does NOT flag comment lines mentioning the literal", () => {
  assert.equal(findLivenessLiterals(' * the filter is status IN (\'working\',\'active\')').length, 0);
  assert.equal(findLivenessLiterals('// { in: ["working", "active"] }').length, 0);
});

test("the live repo passes the guard — no new literals outside the allowlist", () => {
  assert.deepEqual(scanRepo(), []);
});

test("the allowlist is empty — every liveness site was migrated", () => {
  assert.equal(ALLOWLIST.size, 0);
});

test("the allowlist is not stale", () => {
  assert.deepEqual(findStaleAllowlist(), []);
});

test("the canonical homes are not themselves allowlisted", () => {
  for (const c of CANONICAL) assert.equal(ALLOWLIST.has(c), false);
});
