#!/usr/bin/env node
// Tests for the SBOM dependency-shape budgets (plan 2026-09-08 §7).

import { test } from "node:test";
import assert from "node:assert/strict";

import { BUDGETED_TOTALS, evaluateBudgets, evaluateSpecifierDrift, nextBudgets } from "./check-sbom-drift.mjs";
import { findSpecifierDrift } from "./generate-platform-sbom.mjs";

const totals = { resolvedComponents: 100, duplicatedNames: 10, excessInstances: 12, multiMajorNames: 5, uniqueNames: 90 };

test("a total above its budget is over; below is under; equal is neither", () => {
  const { over, under } = evaluateBudgets(totals, {
    resolvedComponents: 99,
    duplicatedNames: 11,
    excessInstances: 12,
    multiMajorNames: 5,
  });
  assert.deepEqual(over, [{ key: "resolvedComponents", current: 100, budget: 99 }]);
  assert.deepEqual(under, [{ key: "duplicatedNames", current: 10, budget: 11 }]);
});

test("a baseline without budgets never fails", () => {
  assert.deepEqual(evaluateBudgets(totals, undefined), { over: [], under: [] });
});

test("only the four shape counts are budgeted", () => {
  assert.deepEqual(BUDGETED_TOTALS, ["resolvedComponents", "duplicatedNames", "excessInstances", "multiMajorNames"]);
  const { over } = evaluateBudgets({ ...totals, uniqueNames: 1e6 }, { uniqueNames: 1 });
  assert.deepEqual(over, []);
});

test("--update-baseline ratchets budgets down and never up", () => {
  const next = nextBudgets(totals, { resolvedComponents: 150, duplicatedNames: 8, excessInstances: 12, multiMajorNames: 9 });
  assert.deepEqual(next, { resolvedComponents: 100, duplicatedNames: 8, excessInstances: 12, multiMajorNames: 5 });
});

test("a missing budget starts at the current total", () => {
  assert.deepEqual(nextBudgets(totals, undefined), {
    resolvedComponents: 100,
    duplicatedNames: 10,
    excessInstances: 12,
    multiMajorNames: 5,
  });
});

test("--raise-budget moves budgets to the current totals", () => {
  const next = nextBudgets(totals, { resolvedComponents: 90, duplicatedNames: 8, excessInstances: 20, multiMajorNames: 5 }, { raise: true });
  assert.deepEqual(next, { resolvedComponents: 100, duplicatedNames: 10, excessInstances: 12, multiMajorNames: 5 });
});

// Specifier drift (plan 2026-09-08 S11).

const imp = (deps = [], dev = []) => ({ dependencies: deps, devDependencies: dev, optionalDependencies: [] });

test("findSpecifierDrift reports a name declared with different registry specifiers", () => {
  const drift = findSpecifierDrift({
    "packages/db": imp([{ name: "net-snmp", specifier: "^3.26.3", version: "3.26.3" }]),
    "services/edge-node": imp([{ name: "net-snmp", specifier: "^3.14.0", version: "3.26.3" }]),
    "apps/web": imp([], [{ name: "zod", specifier: "^4.4.3", version: "4.4.3" }]),
    "services/adp": imp([{ name: "zod", specifier: "^4.4.3", version: "4.4.3" }]),
  });
  assert.deepEqual(drift, [
    { name: "net-snmp", specifiers: { "^3.14.0": ["services/edge-node"], "^3.26.3": ["packages/db"] } },
  ]);
});

test("findSpecifierDrift ignores workspace, link, file and catalog specifiers", () => {
  const drift = findSpecifierDrift({
    a: imp([{ name: "@dpf/db", specifier: "workspace:*", version: null }]),
    b: imp([{ name: "@dpf/db", specifier: "file:../db", version: null }]),
    c: imp([{ name: "@dpf/db", specifier: "link:../db", version: null }]),
    d: imp([{ name: "@dpf/db", specifier: "catalog:", version: null }]),
  });
  assert.deepEqual(drift, []);
});

test("evaluateSpecifierDrift fails unaccepted and stale names", () => {
  const drift = [{ name: "typescript", specifiers: {} }, { name: "dotenv", specifiers: {} }];
  const r = evaluateSpecifierDrift(drift, { typescript: "exact pin", "net-snmp": "old" });
  assert.deepEqual(r.unaccepted.map((x) => x.name), ["dotenv"]);
  assert.deepEqual(r.stale, ["net-snmp"]);
  assert.deepEqual(evaluateSpecifierDrift(undefined, undefined), { unaccepted: [], stale: [] });
});
