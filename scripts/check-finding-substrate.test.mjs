/**
 * BI-REFACTOR-CC46703A — tests for the no-seventh-finding-table guard.
 * Run: node --test scripts/check-finding-substrate.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  SUFFIX_COLLISION_EXCLUSIONS,
  extractModelNames,
  findFindingShapedViolations,
  findStaleAllowlist,
  findStaleExclusions,
  readSchema,
} from "./check-finding-substrate.mjs";

test("extractModelNames finds every model declaration", () => {
  const schema = "model Foo {\n}\n\nmodel BarFinding {\n  id String\n}\n";
  assert.deepEqual(extractModelNames(schema), ["Foo", "BarFinding"]);
});

test("the live schema passes — no finding-shaped model outside the allowlist", () => {
  assert.deepEqual(findFindingShapedViolations(readSchema()), []);
});

test("the allowlist is not stale — every entry still exists in schema.prisma", () => {
  assert.deepEqual(findStaleAllowlist(readSchema()), []);
});

test("the suffix-collision exclusions are not stale", () => {
  assert.deepEqual(findStaleExclusions(readSchema()), []);
});

test("a NEW finding-shaped model not in the allowlist FAILS", () => {
  const schema = "model FooFinding {\n  id String\n}\n";
  assert.deepEqual(findFindingShapedViolations(schema), ["FooFinding"]);
});

test("Issue and Report suffixes are also caught", () => {
  assert.deepEqual(
    findFindingShapedViolations("model DriftIssue {\n}\nmodel ScanReport {\n}\n"),
    ["DriftIssue", "ScanReport"],
  );
});

test("a model already in the allowlist PASSES", () => {
  assert.deepEqual(findFindingShapedViolations("model AuditFinding {\n}\n"), []);
});

test("a suffix-collision exclusion (TaxIssue) PASSES", () => {
  assert.deepEqual(findFindingShapedViolations("model TaxIssue {\n}\n"), []);
});

test("models NOT matching the finding suffix are ignored", () => {
  assert.deepEqual(
    findFindingShapedViolations("model User {\n}\nmodel BomComponent {\n}\n"),
    [],
  );
});

test("the seven known finding-shaped models are all allowlisted", () => {
  for (const name of [
    "PortfolioQualityIssue",
    "AuditFinding",
    "WikiLintFinding",
    "EaConformanceIssue",
    "LicenseReadinessIssue",
    "PlatformIssueReport",
    "AssuranceFinding",
  ]) {
    assert.ok(ALLOWLIST.has(name), `${name} should be allowlisted`);
  }
  assert.equal(ALLOWLIST.size, 7);
});

test("allowlist and exclusions do not overlap", () => {
  for (const name of SUFFIX_COLLISION_EXCLUSIONS) {
    assert.ok(!ALLOWLIST.has(name), `${name} must not be in both sets`);
  }
});
