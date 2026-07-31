// scripts/check-context-economy.test.mjs
//
// The load-bearing assertions here are the two halves of the founder doctrine this guard
// encodes: growth WITH a recorded reason must PASS (complexity that buys long-term
// cognitive-load reduction is legitimate), and growth WITHOUT one must FAIL. A guard that
// only did the second half would be the shrink-only ratchet that blocks the investment;
// a guard that only did the first would be a warning nobody reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateContextEconomy,
  measureContextEconomy,
  parseStandingSources,
  parseTierBudgets,
} from "./check-context-economy.mjs";

const ARBITRATOR = `
const BUDGETS: Record<ModelTier, ContextBudget> = {
  frontier: { modelTier: "frontier", totalBudget: 6000, l0Budget: 625, l1Budget: 1500, l2Budget: 3875 },
  basic:    { modelTier: "basic",    totalBudget: 800,  l0Budget: 625, l1Budget: 175,  l2Budget: 0 },
};`;

const ASSEMBLY = `
  { tier: "L1", source: "domain", compressible: false },
  { tier: "L1", source: "page-data", compressible: true },
  { tier: "L2", source: "semantic-memory", compressible: true },
  const selectedDomain = result.selected.find((s) => s.source === "domain");
`;

// ── measurement ──

test("parses each model tier's standing token allowance", () => {
  assert.deepEqual(parseTierBudgets(ARBITRATOR), { frontier: 6000, basic: 800 });
});

test("counts DISTINCT standing sources — a label mentioned twice is still one claimant", () => {
  assert.deepEqual(parseStandingSources(ASSEMBLY), ["domain", "page-data", "semantic-memory"]);
});

test("measures budgets and source count into flat baseline keys", () => {
  const { measured, sources } = measureContextEconomy({
    arbitratorSource: ARBITRATOR,
    assemblySource: ASSEMBLY,
  });
  assert.equal(measured["budget.frontier.totalBudget"], 6000);
  assert.equal(measured["assembly.standingSources"], 3);
  assert.deepEqual(sources, ["domain", "page-data", "semantic-memory"]);
});

// ── the doctrine: growth is allowed, silence is not ──

test("growth WITH a substantive recorded reason passes, and the reason is surfaced", () => {
  const result = evaluateContextEconomy({
    measured: { "budget.strong.totalBudget": 4000 },
    baseline: {
      "budget.strong.totalBudget": {
        value: 4000,
        reason:
          "Raised to fund the profession corpus inline, which removes the operator's manual " +
          "lookup step on every advisory turn.",
      },
    },
    baseBaseline: { "budget.strong.totalBudget": { value: 3000 } },
  });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.ok(result.justified.some((j) => /3000 -> 4000/.test(j)));
});

test("growth WITHOUT a reason fails and asks what load it removes", () => {
  const result = evaluateContextEconomy({
    measured: { "budget.strong.totalBudget": 4000 },
    baseline: { "budget.strong.totalBudget": { value: 4000 } },
    baseBaseline: { "budget.strong.totalBudget": { value: 3000 } },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /no substantive reason/.test(e)), result.errors.join("; "));
  assert.ok(result.errors.some((e) => /long-term cognitive load/.test(e)));
});

test("a token reason is rejected as the attestation theater it is", () => {
  const result = evaluateContextEconomy({
    measured: { "budget.strong.totalBudget": 4000 },
    baseline: { "budget.strong.totalBudget": { value: 4000, reason: "increased" } },
    baseBaseline: { "budget.strong.totalBudget": { value: 3000 } },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /attestation theater/.test(e)));
});

test("the tree may not quietly exceed the committed baseline", () => {
  const result = evaluateContextEconomy({
    measured: { "budget.strong.totalBudget": 9000 },
    baseline: { "budget.strong.totalBudget": { value: 3000 } },
    baseBaseline: { "budget.strong.totalBudget": { value: 3000 } },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /without re-baselining/.test(e)));
  assert.ok(result.errors.some((e) => /Growth is allowed/.test(e)), "must not read as a prohibition");
});

test("a new standing source is caught — it is a permanent tax on every dispatch", () => {
  const result = evaluateContextEconomy({
    measured: { "assembly.standingSources": 8 },
    baseline: { "assembly.standingSources": { value: 7 } },
    baseBaseline: { "assembly.standingSources": { value: 7 } },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /assembly\.standingSources grew 7 -> 8/.test(e)));
});

// ── shrink, and fail-open cases ──

test("shrink always passes and is nudged to be locked in", () => {
  const result = evaluateContextEconomy({
    measured: { "budget.strong.totalBudget": 2000 },
    baseline: { "budget.strong.totalBudget": { value: 3000 } },
    baseBaseline: { "budget.strong.totalBudget": { value: 3000 } },
  });
  assert.equal(result.ok, true);
  assert.ok(result.notes.some((n) => /keep the gain/.test(n)));
});

test("an unmeasured key is reported rather than silently ignored", () => {
  const result = evaluateContextEconomy({
    measured: { "budget.new-tier.totalBudget": 500 },
    baseline: {},
    baseBaseline: {},
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /missing from the baseline/.test(e)));
});

test("a missing base comparison never fails closed — rule 1 still holds, rule 2 is skipped", () => {
  // Shallow clone / new file / detached CI: we cannot tell whether the baseline was
  // raised, so we must not invent a violation.
  const raisedNoReason = evaluateContextEconomy({
    measured: { "budget.strong.totalBudget": 4000 },
    baseline: { "budget.strong.totalBudget": { value: 4000 } },
    baseBaseline: null,
  });
  assert.equal(raisedNoReason.ok, true);

  const overBaseline = evaluateContextEconomy({
    measured: { "budget.strong.totalBudget": 5000 },
    baseline: { "budget.strong.totalBudget": { value: 4000 } },
    baseBaseline: null,
  });
  assert.equal(overBaseline.ok, false);
});

// ── the committed baseline matches the real tree ──

test("the committed baseline is in sync with the live source", () => {
  const root = new URL("../", import.meta.url);
  const { measured } = measureContextEconomy({
    arbitratorSource: readFileSync(new URL("apps/web/lib/tak/context-arbitrator.ts", root), "utf8"),
    assemblySource: readFileSync(new URL("apps/web/lib/actions/agent-coworker.ts", root), "utf8"),
  });
  const baseline = JSON.parse(
    readFileSync(new URL("scripts/context-economy-baseline.json", root), "utf8"),
  ).entries;

  const result = evaluateContextEconomy({ measured, baseline, baseBaseline: baseline });
  assert.equal(result.ok, true, result.errors.join("; "));
  // And the guard is actually measuring something, not vacuously passing on an empty set.
  assert.ok(Object.keys(measured).length >= 5);
});
