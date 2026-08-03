// scripts/complexity-shield-role-patterns.contract.test.mjs — BI-ECO-007
// Keeps role/size complexity-shield patterns present and citable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOC = "docs/architecture/complexity-shield-role-patterns.md";

test("role/size complexity-shield patterns exist and name BI-ECO-007", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /BI-ECO-007/);
  assert.match(doc, /Complexity Shield Patterns/i);
  assert.match(doc, /BI-COP-006/);
});

test("size bands micro, small, and scaling are defined", () => {
  const doc = readFileSync(DOC, "utf8");
  assert.match(doc, /\*\*Micro\*\*/);
  assert.match(doc, /\*\*Small\*\*/);
  assert.match(doc, /\*\*Scaling\*\*/);
});

test("catalog covers required roles including AI coworker", () => {
  const doc = readFileSync(DOC, "utf8");
  for (const role of [
    "Owner / founder",
    "Manager",
    "Employee / individual contributor",
    "Accountant / bookkeeper",
    "Admin (business admin",
    "IT / MSP",
    "Sales / support",
    "Field / frontline",
    "AI coworker interaction",
  ]) {
    assert.match(doc, new RegExp(role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
