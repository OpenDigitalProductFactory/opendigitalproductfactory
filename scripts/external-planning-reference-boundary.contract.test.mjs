// scripts/external-planning-reference-boundary.contract.test.mjs - BI-A72CE946
// Keeps the external planning-reference boundary doctrine present and citable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/architecture/external-planning-reference-boundary.md";

test("external planning-reference boundary exists and names BI-A72CE946", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /BI-A72CE946/);
  assert.match(doc, /External Planning-Reference Boundary/i);
  assert.match(doc, /Layer B/i);
  assert.match(doc, /planning evidence/i);
});

test("doctrine defines three layers and forbids dumping licensed packs into public docs", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const needle of [
    "Canonical DPF doctrine",
    "Planning reference packs",
    "Product claims",
    "Forbidden in committed public docs",
    "Bulk paste of licensed standards",
    "DPF_References",
  ]) {
    assert.match(doc, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("citation shape requires locator, digest, decision residue, and sensitivity tag", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /Locator/i);
  assert.match(doc, /Digest/i);
  assert.match(doc, /Decision residue/i);
  assert.match(doc, /sensitivity tag/i);
  assert.match(doc, /private-competitive|licensed-standard/);
});
