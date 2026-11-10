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
    "apps/web": imp([], [{ name: "zod", specifier: "catalog:", version: "4.4.3" }]),
    "services/adp": imp([{ name: "zod", specifier: "catalog:", version: "4.4.3" }]),
  });
  assert.deepEqual(drift, [
    { name: "net-snmp", specifiers: { "^3.14.0": ["services/edge-node"], "^3.26.3": ["packages/db"] } },
  ]);
});

test("findSpecifierDrift ignores workspace, link and file specifiers", () => {
  const drift = findSpecifierDrift({
    a: imp([{ name: "@dpf/db", specifier: "workspace:*", version: null }]),
    b: imp([{ name: "@dpf/db", specifier: "file:../db", version: null }]),
    c: imp([{ name: "@dpf/db", specifier: "link:../db", version: null }]),
  });
  assert.deepEqual(drift, []);
});

test("findSpecifierDrift accepts a shared name only when every workspace declares the same catalog: reference", () => {
  const drift = findSpecifierDrift({
    "apps/web": imp([{ name: "zod", specifier: "catalog:", version: "4.6.5" }], [{ name: "vitest", specifier: "catalog:", version: "4.1.11" }]),
    "services/adp": imp([{ name: "zod", specifier: "catalog:", version: "4.6.5" }], [{ name: "vitest", specifier: "catalog:", version: "4.1.11" }]),
  });
  assert.deepEqual(drift, []);
});

test("findSpecifierDrift fails a shared name declared with the same plain range instead of catalog:", () => {
  // The ratchet: agreeing ranges typed twice drift on the next one-sided bump.
  const drift = findSpecifierDrift({
    "apps/web": imp([{ name: "undici", specifier: "^8.10.0", version: "8.11.2" }]),
    "packages/db": imp([{ name: "undici", specifier: "^8.10.0", version: "8.11.2" }]),
  });
  assert.deepEqual(drift, [{ name: "undici", specifiers: { "^8.10.0": ["apps/web", "packages/db"] } }]);
});

test("findSpecifierDrift fails a workspace that opts out of the catalog, and a split across catalogs", () => {
  const drift = findSpecifierDrift({
    "apps/web": imp([], [{ name: "typescript", specifier: "catalog:", version: "6.0.3" }, { name: "vite", specifier: "catalog:", version: "8.2.1" }]),
    "packages/repo-guard-runtime": imp([], [{ name: "typescript", specifier: "6.0.3", version: "6.0.3" }]),
    "packages/db": imp([], [{ name: "vite", specifier: "catalog:legacy", version: "7.0.0" }]),
  });
  assert.deepEqual(drift, [
    { name: "typescript", specifiers: { "6.0.3": ["packages/repo-guard-runtime"], "catalog:": ["apps/web"] } },
    { name: "vite", specifiers: { "catalog:": ["apps/web"], "catalog:legacy": ["packages/db"] } },
  ]);
});

test("findSpecifierDrift leaves a dependency that only one workspace declares alone", () => {
  const drift = findSpecifierDrift({
    "apps/web": imp([{ name: "next", specifier: "^16.2.0", version: "16.2.9" }], [{ name: "next", specifier: "^16.2.0", version: "16.2.9" }]),
    "services/adp": imp([{ name: "prom-client", specifier: "^15.1.3", version: "15.1.3" }]),
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
