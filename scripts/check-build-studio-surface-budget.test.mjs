import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUDGET_KEYS,
  computeBudgets,
  countLines,
  evaluateBudget,
  isSurfaceFile,
  runCheck,
  validateBaseline,
} from "./check-build-studio-surface-budget.mjs";

const VALID_BASELINE = {
  version: 1,
  owner: "platform-architecture",
  expiry: "2026-11-21",
  componentCount: 70,
  nonTestLoc: 16391,
};

const file = (path, lines) => ({ path, source: "x\n".repeat(lines) });

describe("isSurfaceFile", () => {
  it("counts production component sources", () => {
    assert.equal(isSurfaceFile("BuildStudio.tsx"), true);
    assert.equal(isSurfaceFile("fleet-derivation.ts"), true);
  });

  it("excludes tests, stories and declarations", () => {
    assert.equal(isSurfaceFile("BuildStudio.test.tsx"), false);
    assert.equal(isSurfaceFile("fleet-derivation.spec.ts"), false);
    assert.equal(isSurfaceFile("BuildStudio.stories.tsx"), false);
    assert.equal(isSurfaceFile("types.d.ts"), false);
  });

  it("excludes non-TypeScript files", () => {
    assert.equal(isSurfaceFile("README.md"), false);
    assert.equal(isSurfaceFile("icon.svg"), false);
  });
});

describe("countLines", () => {
  it("counts an empty file as zero", () => {
    assert.equal(countLines(""), 0);
  });

  it("does not count the trailing newline as an extra line", () => {
    assert.equal(countLines("a\nb\n"), 2);
    assert.equal(countLines("a\nb"), 2);
  });
});

describe("computeBudgets", () => {
  it("totals component count and non-test LOC", () => {
    const budgets = computeBudgets([file("a.tsx", 10), file("b.tsx", 5)]);
    assert.deepEqual(budgets, { componentCount: 2, nonTestLoc: 15 });
  });

  it("reports zero for an empty surface", () => {
    assert.deepEqual(computeBudgets([]), { componentCount: 0, nonTestLoc: 0 });
  });
});

describe("validateBaseline", () => {
  it("accepts a well-formed unexpired baseline", () => {
    assert.deepEqual(validateBaseline(VALID_BASELINE, { today: "2026-08-21" }), []);
  });

  it("fails an expired baseline so deferred cleanup cannot become never", () => {
    const failures = validateBaseline(VALID_BASELINE, { today: "2026-11-22" });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /expired on 2026-11-21/);
  });

  it("requires an owner", () => {
    const failures = validateBaseline({ ...VALID_BASELINE, owner: "  " }, { today: "2026-08-21" });
    assert.ok(failures.some((f) => /requires an owner/.test(f)));
  });

  it("requires numeric budgets for every key", () => {
    for (const key of BUDGET_KEYS) {
      const failures = validateBaseline(
        { ...VALID_BASELINE, [key]: "70" },
        { today: "2026-08-21" },
      );
      assert.ok(failures.some((f) => f.includes(key)), `${key} must be validated`);
    }
  });
});

describe("evaluateBudget", () => {
  it("reports growth when the surface expands", () => {
    assert.deepEqual(evaluateBudget(75, 70), { growth: 5, stale: 0 });
  });

  it("reports stale when the surface shrinks", () => {
    assert.deepEqual(evaluateBudget(66, 70), { growth: 0, stale: 4 });
  });

  it("reports neither when the surface holds", () => {
    assert.deepEqual(evaluateBudget(70, 70), { growth: 0, stale: 0 });
  });
});

describe("runCheck", () => {
  const baseline = { ...VALID_BASELINE, componentCount: 2, nonTestLoc: 15 };

  it("passes when the surface matches the baseline", () => {
    const result = runCheck({
      files: [file("a.tsx", 10), file("b.tsx", 5)],
      baseline,
      today: "2026-08-21",
    });
    assert.equal(result.ok, true);
  });

  it("fails a new component even when total lines hold", () => {
    // The regression this guard exists for: PR #3693 shipped a "simplification"
    // that added modules without removing any.
    const result = runCheck({
      files: [file("a.tsx", 5), file("b.tsx", 5), file("c.tsx", 5)],
      baseline,
      today: "2026-08-21",
    });
    assert.equal(result.ok, false);
    assert.equal(result.evaluation.componentCount.growth, 1);
    assert.equal(result.evaluation.nonTestLoc.growth, 0);
  });

  it("fails net line growth even when component count holds", () => {
    const result = runCheck({
      files: [file("a.tsx", 20), file("b.tsx", 5)],
      baseline,
      today: "2026-08-21",
    });
    assert.equal(result.ok, false);
    assert.equal(result.evaluation.nonTestLoc.growth, 10);
  });

  it("passes a genuine removal and flags it for retightening", () => {
    const result = runCheck({ files: [file("a.tsx", 10)], baseline, today: "2026-08-21" });
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.componentCount.stale, 1);
    assert.equal(result.evaluation.nonTestLoc.stale, 5);
  });

  it("fails closed on an invalid baseline rather than passing unchecked", () => {
    const result = runCheck({
      files: [file("a.tsx", 10)],
      baseline: { version: 1, owner: "", expiry: "nope" },
      today: "2026-08-21",
    });
    assert.equal(result.ok, false);
    assert.ok(result.baselineFailures.length > 0);
  });
});
