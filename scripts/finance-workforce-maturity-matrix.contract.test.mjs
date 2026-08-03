// scripts/finance-workforce-maturity-matrix.contract.test.mjs - BI-COP-004
// Keeps the finance/workforce docs-vs-code maturity matrix present and citable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/architecture/finance-workforce-maturity-matrix.md";

test("finance-workforce maturity matrix exists and names BI-COP-004", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /BI-COP-004/);
  assert.match(doc, /Finance and Workforce Documentation Maturity Matrix/i);
});

test("matrix defines the five maturity labels", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const label of [
    "usable-now",
    "experimental",
    "bridge-only",
    "planned",
    "out-of-scope",
  ]) {
    assert.match(doc, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("matrix covers finance ledger reality and workforce AI vs human split", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /LedgerAccount|ledger accounts/i);
  assert.match(doc, /QuickBooks/i);
  assert.match(doc, /bridge-only/i);
  assert.match(doc, /AI coworker|AI workforce/i);
  assert.match(doc, /human HR|HCM/i);
  assert.match(doc, /full accounting/i);
});
