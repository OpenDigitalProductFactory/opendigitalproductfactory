#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { auditOverrides } from "./check-override-comments.mjs";

const wrap = (body) => `packages:\n  - "apps/*"\noverrides:\n${body}\nallowBuilds:\n  sharp: true\n`;

test("a GHSA-tagged floor passes", () => {
  const text = wrap(
    [
      "  # foo < 1.2.3: GHSA-abcd-abcd-abcd remote code execution (high).",
      "  foo: '^1.2.3'",
    ].join("\n"),
  );
  assert.deepEqual(auditOverrides(text).untagged, []);
});

test("a Dependabot-#-tagged floor passes", () => {
  const text = wrap(["  # bar patched per Dependabot #42.", "  bar: '^2.0.0'"].join("\n"));
  assert.deepEqual(auditOverrides(text).untagged, []);
});

test("a CVE-tagged floor passes", () => {
  const text = wrap(["  # baz: CVE-2026-12345 prototype pollution.", "  baz: '^3.0.0'"].join("\n"));
  assert.deepEqual(auditOverrides(text).untagged, []);
});

test("an untagged, non-exempt floor FAILS", () => {
  const text = wrap("  sketchy-pkg: '^9.9.9'");
  assert.deepEqual(auditOverrides(text).untagged, ["sketchy-pkg"]);
});

test("a prose-only advisory without a machine id FAILS", () => {
  const text = wrap(["  # some-pkg has a GHSA advisory, trust me.", "  some-pkg: '^1.0.0'"].join("\n"));
  assert.deepEqual(auditOverrides(text).untagged, ["some-pkg"]);
});

test("a dedup pin is exempt", () => {
  const text = wrap("  lodash: '4.18.0'");
  assert.deepEqual(auditOverrides(text).untagged, []);
});

test("a jest-family pin is pattern-exempt", () => {
  const text = wrap(["  jest: '^30.0.0'", "  '@jest/core': '^30.0.0'"].join("\n"));
  assert.deepEqual(auditOverrides(text).untagged, []);
});

test("a grandfathered debt floor is exempt", () => {
  const text = wrap("  postcss: '^8.5.18'");
  assert.deepEqual(auditOverrides(text).untagged, []);
});

test("a shared-comment sibling is covered", () => {
  const text = wrap(
    [
      "  # brace-expansion: GHSA-3jxr-9vmj-r5cp DoS (Dependabot #102/#103).",
      "  'minimatch@3.1.5>brace-expansion': '1.1.16'",
      "  'minimatch@9.0.9>brace-expansion': '2.1.2'",
    ].join("\n"),
  );
  assert.deepEqual(auditOverrides(text).untagged, []);
});

test("the live pnpm-workspace.yaml passes the guard", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const live = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const { untagged, scanned } = auditOverrides(live);
  assert.ok(scanned > 0, "should scan at least one override");
  assert.deepEqual(untagged, [], `live workspace has untagged floors: ${untagged.join(", ")}`);
});
