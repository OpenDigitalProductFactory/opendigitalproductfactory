// scripts/edge-adapter-convergence.contract.test.mjs - BI-COP-005
// Keeps edge-adapter-to-native convergence doctrine present and citable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/architecture/edge-adapter-to-native-convergence.md";

test("edge-adapter convergence doctrine exists and names BI-COP-005", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /BI-COP-005/);
  assert.match(doc, /Edge-Adapter-to-Native Convergence/i);
  assert.match(doc, /bridges/i);
});

test("doctrine defines integrate, native absorb, coexist, and defer modes", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const mode of [
    "Integrate (edge adapter)",
    "Native absorb",
    "Coexist (dual)",
    "Defer",
  ]) {
    assert.match(doc, new RegExp(mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("graduation criteria and anti-patterns are load-bearing", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /Graduation criteria/i);
  assert.match(doc, /Authority map/i);
  assert.match(doc, /Complexity shield/i);
  assert.match(doc, /Adapter forever by default/i);
  assert.match(doc, /Native fork per customer/i);
  assert.match(doc, /BI-COP-006/);
});
