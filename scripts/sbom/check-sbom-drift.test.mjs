#!/usr/bin/env node
// Tests for the SBOM dependency-shape budgets (plan 2026-09-08 §7).

import { test } from "node:test";
import assert from "node:assert/strict";

import { BUDGETED_TOTALS, evaluateBudgets, nextBudgets } from "./check-sbom-drift.mjs";

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
