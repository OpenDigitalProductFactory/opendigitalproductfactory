// scripts/installer-state-contract.contract.test.mjs - BI-DIG-EB45310E
// Keeps contributor installer-state vs .env precedence doctrine in the
// canonical deployment contracts (single home for the rule).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/superpowers/specs/2026-05-09-deployment-contracts.md";

test("deployment contracts define Contract 12 installer-state precedence", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /### 12\. Contributor installer state and configuration precedence/);
  assert.match(doc, /BI-DIG-EB45310E/);
  assert.match(doc, /install-state\.json/);
});

test("Contract 12 names the three layers and read precedence", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /Installer state \(canonical\)/i);
  assert.match(doc, /Derived projection/i);
  assert.match(doc, /Process environment \(ephemeral override\)/i);
  assert.match(doc, /Read precedence/i);
  assert.match(doc, /two-tree model/i);
});

test("Contract 12 forbids treating \.env as a second source of truth", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /never a second source of truth/i);
  assert.match(doc, /Canonical store/i);
  assert.match(doc, /Drift reconciliation/i);
});
