// Tests for the local-formatter ratchet (plan 2026-09-08 §10.5 S6).
// Run: node --test scripts/check-no-local-formatters.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { ALLOWLIST, CANONICAL, findDefinitionLines, findStaleAllowlist, scanRepo } from "./check-no-local-formatters.mjs";

test("flags function and const definitions at any indentation", () => {
  const names = (body) => findDefinitionLines(body).map((h) => h.name);
  assert.deepEqual(names("function formatDateTime(iso: string): string {"), ["formatDateTime"]);
  assert.deepEqual(names("export function formatBytes(n: number) {"), ["formatBytes"]);
  assert.deepEqual(names("  const formatMoney = (amount: number) =>"), ["formatMoney"]);
  assert.deepEqual(names("const fmtDate: (d: Date) => string = (d) => d.toISOString();"), ["fmtDate"]);
  assert.deepEqual(names("function formatDuration<T>(ms: T) {"), ["formatDuration"]);
});

test("ignores calls, imports, comments and names outside the family", () => {
  assert.equal(findDefinitionLines("const s = formatDateTime(row.at);").length, 0);
  assert.equal(findDefinitionLines('import { formatDateTime } from "@/lib/datetime";').length, 0);
  assert.equal(findDefinitionLines("// function formatMoney(amount: number) {").length, 0);
  assert.equal(findDefinitionLines(" * const formatDate = (d) => d;").length, 0);
  assert.equal(findDefinitionLines("function formatDurationMs(ms: number) {").length, 0);
  assert.equal(findDefinitionLines("function formatCrmStatusLabel(value: string) {").length, 0);
  assert.equal(findDefinitionLines("const formatter = new Intl.NumberFormat();").length, 0);
});

test("allowlist is closed: every entry carries a reason and none is a canonical home", () => {
  for (const [key, reason] of ALLOWLIST) {
    assert.match(key, /^apps\/web\/.+#(?:format|fmt)\w+$/, key);
    assert.equal(typeof reason, "string");
    assert.ok(reason.trim().length >= 15, `reason too short for ${key}`);
    assert.ok(!CANONICAL.has(key.split("#")[0]), `canonical home allowlisted: ${key}`);
  }
});

test("repo: no formatter outside the shared homes and the allowlist, and no stale entry", () => {
  assert.deepEqual(scanRepo(), []);
  assert.deepEqual(findStaleAllowlist(), []);
});
