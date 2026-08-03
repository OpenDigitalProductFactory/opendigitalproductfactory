// scripts/ux-archetype-audit-rubric.contract.test.mjs - BI-24A77446
// Keeps the reusable archetype UX audit rubric present and load-bearing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/architecture/ux-archetype-audit-rubric.md";

test("UX archetype audit rubric exists and names BI-24A77446", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /BI-24A77446/);
  assert.match(doc, /Route sampling/i);
  assert.match(doc, /Purpose Contract/i);
  assert.match(doc, /Attention continuity/i);
  assert.match(doc, /Mobile public-flow/i);
});

test("rubric requires the four first-viewport questions", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /What is this/i);
  assert.match(doc, /What should I do next/i);
  assert.match(doc, /What happens if I do nothing/i);
  assert.match(doc, /Is this reversible/i);
});

test("rubric samples public, owner, help, forms, mobile, and technical reachability", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const needle of [
    "Public",
    "Owner",
    "Help",
    "Forms",
    "Mobile",
    "Technical reachability",
    "/platform",
    "/ops",
    "/build",
  ]) {
    assert.match(doc, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
