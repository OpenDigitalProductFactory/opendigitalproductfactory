/**
 * BI-170E99A9 — tests for the "system" user-sentinel CI guard.
 * Run: node --test scripts/check-no-system-user-sentinel.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  findViolationLines,
  scanRepo,
} from "./check-no-system-user-sentinel.mjs";

test("flags userId: \"system\" object property", () => {
  assert.equal(findViolationLines('const data = { userId: "system" };').length, 1);
});

test("flags userId = \"system\" assignment and default param", () => {
  assert.equal(findViolationLines('let userId = "system";').length, 1);
  assert.equal(findViolationLines("function f(userId = \"system\") {}").length, 1);
});

test("flags the ?? \"system\" nullish fallback (the #1926 form)", () => {
  assert.equal(
    findViolationLines('const actorUserId = b?.createdById ?? "system";').length,
    1,
  );
});

test("flags single-quoted and whitespace variants", () => {
  assert.equal(findViolationLines("userId:'system'").length, 1);
  assert.equal(findViolationLines('userId:   "system"').length, 1);
  assert.equal(findViolationLines("x ??'system'").length, 1);
});

test("does NOT flag savedByUserId — a non-referential String column", () => {
  // \buserId is lowercase + word-boundary, so it cannot match `...ByUserId`.
  assert.equal(findViolationLines('save({ savedByUserId: "system" });').length, 0);
});

test("does NOT flag comment / JSDoc lines documenting the anti-pattern", () => {
  assert.equal(
    findViolationLines(' * a literal `userId: "system"` has no matching User row').length,
    0,
  );
  assert.equal(findViolationLines('// const userId = "system" would break the FK').length, 0);
  assert.equal(findViolationLines('  /* userId: "system" */').length, 0);
});

test("does NOT flag unrelated \"system\" uses", () => {
  assert.equal(findViolationLines('const role = "system";').length, 0);
  assert.equal(findViolationLines('{ kind: "system", id: "routed-inference" }').length, 0);
  assert.equal(findViolationLines('actorType: "system",').length, 0);
  assert.equal(findViolationLines('provenanceKind: "system" as const').length, 0);
  assert.equal(findViolationLines('email?.split("@")[0] ?? "user"').length, 0);
});

test("the live repo passes the guard — allowlist is complete and accurate", () => {
  // Run against the checked-out tree (cwd = repo root in CI and locally).
  // Asserts main is clean AND that the allowlist neither under- nor
  // over-covers: a stale allowlist entry whose file no longer trips the
  // patterns would still pass here, but a NEW unlisted hit fails loudly.
  const violations = scanRepo();
  assert.deepEqual(
    violations,
    [],
    `unexpected sentinel violations:\n${violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n")}`,
  );
});

test("allowlist paths are repo-relative with forward slashes", () => {
  for (const p of ALLOWLIST) {
    assert.ok(!p.includes("\\"), `allowlist path must use '/': ${p}`);
    assert.ok(p.startsWith("apps/web/lib/"), `allowlist path out of scan scope: ${p}`);
  }
});
