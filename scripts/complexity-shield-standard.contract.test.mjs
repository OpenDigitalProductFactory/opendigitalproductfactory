// scripts/complexity-shield-standard.contract.test.mjs - BI-COP-006
// Keeps the small-company complexity-shield acceptance standard wired and citable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/architecture/complexity-shield-acceptance-standard.md";

test("complexity-shield acceptance standard exists and names BI-COP-006", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /BI-COP-006/);
  assert.match(doc, /Complexity Shield/i);
  assert.match(doc, /Operator job/i);
  assert.match(doc, /Happy path/i);
  assert.match(doc, /Hidden/i);
  assert.match(doc, /Automated/i);
  assert.match(doc, /Omitted/i);
  assert.match(doc, /Coworker|AI/i);
});

test("standard requires the five acceptance axes", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const axis of [
    "Operator job, not suite module",
    "Simplified operator-facing workflow",
    "What AI / coworkers absorb",
    "What enterprise complexity is hidden, automated, or omitted",
    "Proof without enterprise burden",
  ]) {
    assert.match(doc, new RegExp(axis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("standard points at market vision so parity work cannot overclaim", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /dpf-market-vision\.md/);
});
