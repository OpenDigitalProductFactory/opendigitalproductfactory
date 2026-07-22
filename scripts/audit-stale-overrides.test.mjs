#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseOverrides } from "./check-override-comments.mjs";
import { normalizeTag, buildAlertLookup, classifyFloors } from "./audit-stale-overrides.mjs";

const wrap = (body) => `packages:\n  - "apps/*"\noverrides:\n${body}\nallowBuilds:\n  sharp: true\n`;

test("normalizeTag parses the three advisory forms and rejects junk", () => {
  assert.deepEqual(normalizeTag("Dependabot #105"), { type: "dependabot", key: "#105", label: "Dependabot #105" });
  assert.equal(normalizeTag("GHSA-abcd-abcd-abcd").type, "ghsa");
  assert.equal(normalizeTag("GHSA-ABCD-ABCD-ABCD").key, "ghsa-abcd-abcd-abcd"); // lowercased
  assert.equal(normalizeTag("CVE-2026-33327").key, "cve-2026-33327");
  assert.equal(normalizeTag("just some prose"), null);
});

test("buildAlertLookup indexes an alert by number, GHSA, and CVE", () => {
  const lookup = buildAlertLookup([
    { number: 105, state: "fixed", security_advisory: { ghsa_id: "GHSA-abcd-abcd-abcd", cve_id: "CVE-2026-1" } },
  ]);
  assert.equal(lookup.get("#105"), "fixed");
  assert.equal(lookup.get("ghsa-abcd-abcd-abcd"), "fixed");
  assert.equal(lookup.get("cve-2026-1"), "fixed");
});

test("a floor whose advisory is fixed is a prune candidate", () => {
  const { entries } = parseOverrides(
    wrap(["  # foo: GHSA-abcd-abcd-abcd rce (high).", "  foo: '^1.2.3'"].join("\n")),
  );
  const lookup = buildAlertLookup([{ number: 1, state: "fixed", security_advisory: { ghsa_id: "GHSA-abcd-abcd-abcd" } }]);
  const res = classifyFloors(entries, lookup);
  assert.deepEqual(res.candidates.map((c) => c.key), ["foo"]);
  assert.equal(res.loadBearing.length, 0);
});

test("a floor whose advisory is still open is load-bearing", () => {
  const { entries } = parseOverrides(
    wrap(["  # bar: GHSA-abcd-abcd-abcd rce (high).", "  bar: '^2.0.0'"].join("\n")),
  );
  const lookup = buildAlertLookup([{ number: 1, state: "open", security_advisory: { ghsa_id: "GHSA-abcd-abcd-abcd" } }]);
  const res = classifyFloors(entries, lookup);
  assert.deepEqual(res.loadBearing.map((c) => c.key), ["bar"]);
  assert.equal(res.candidates.length, 0);
});

test("multiple tags with any one open keeps the floor load-bearing", () => {
  const { entries } = parseOverrides(
    wrap(["  # baz: GHSA-aaaa-aaaa-aaaa and GHSA-bbbb-bbbb-bbbb.", "  baz: '^3.0.0'"].join("\n")),
  );
  const lookup = buildAlertLookup([
    { number: 1, state: "fixed", security_advisory: { ghsa_id: "GHSA-aaaa-aaaa-aaaa" } },
    { number: 2, state: "open", security_advisory: { ghsa_id: "GHSA-bbbb-bbbb-bbbb" } },
  ]);
  const res = classifyFloors(entries, lookup);
  assert.deepEqual(res.loadBearing.map((c) => c.key), ["baz"]);
});

test("a tagged floor whose advisory is absent from alerts is indeterminate, not a candidate", () => {
  const { entries } = parseOverrides(
    wrap(["  # qux: GHSA-zzzz-zzzz-zzzz.", "  qux: '^1.0.0'"].join("\n")),
  );
  const res = classifyFloors(entries, buildAlertLookup([]));
  assert.deepEqual(res.unknown.map((c) => c.key), ["qux"]);
  assert.equal(res.candidates.length, 0, "must not propose pruning when we can't confirm resolution");
});

test("a security floor with no machine-readable tag is un-auditable", () => {
  // node-forge is grandfathered debt with no tag → cannot be cross-checked.
  const { entries } = parseOverrides(wrap("  node-forge: '1.4.0'"));
  const res = classifyFloors(entries, buildAlertLookup([]));
  assert.deepEqual(res.unauditable.map((c) => c.key), ["node-forge"]);
});

test("dedup / pattern pins are skipped entirely (never advisory-redundant)", () => {
  const { entries } = parseOverrides(wrap(["  lodash: '4.18.0'", "  jest: '^30.0.0'"].join("\n")));
  const res = classifyFloors(entries, buildAlertLookup([{ number: 1, state: "fixed" }]));
  assert.equal(res.candidates.length, 0);
  assert.equal(res.loadBearing.length, 0);
  assert.equal(res.unauditable.length, 0);
  assert.equal(res.unknown.length, 0);
});

test("offline (null lookup): tagged floors are neither candidate nor load-bearing; untagged still surfaces", () => {
  const { entries } = parseOverrides(
    wrap(["  # foo: GHSA-abcd-abcd-abcd.", "  foo: '^1.2.3'", "  node-forge: '1.4.0'"].join("\n")),
  );
  const res = classifyFloors(entries, null);
  assert.equal(res.candidates.length, 0);
  assert.equal(res.loadBearing.length, 0);
  assert.equal(res.unknown.length, 0);
  assert.deepEqual(res.unauditable.map((c) => c.key), ["node-forge"]);
});

test("the live pnpm-workspace.yaml parses and classifies without throwing", () => {
  // Offline classification over the real file — proves the parser + classifier
  // agree on the live overrides block (the guard already asserts tag coverage).
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const text = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const { entries, scanned } = parseOverrides(text);
  assert.ok(scanned > 0);
  const res = classifyFloors(entries, null);
  // node-forge is grandfathered debt (no tag) → must surface as un-auditable.
  assert.ok(res.unauditable.some((r) => r.key === "node-forge"), "node-forge should be un-auditable until its tag is backfilled");
});
