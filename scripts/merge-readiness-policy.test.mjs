import assert from "node:assert/strict";
import test from "node:test";

import {
  compareProtection,
  evaluateDependencyResults,
  parseWorkflowJobIds,
  validateWorkflowConformance,
} from "./merge-readiness-policy.mjs";

const manifest = {
  requiredContexts: ["Merge Readiness", "UX Route Budget Sweep", "DCO"],
  strict: false,
  workflows: { ci: "ci.yml", ux: "ux.yml" },
  aggregateJobId: "merge-readiness",
  aggregateJobName: "Merge Readiness",
  uxJobId: "sweep",
  uxJobName: "UX Route Budget Sweep",
};

test("dependency evaluator accepts only success and intentional skips", () => {
  assert.deepEqual(evaluateDependencyResults({
    build: { result: "success" },
    optional: { result: "skipped" },
  }), { ok: true, failures: [] });
  assert.deepEqual(evaluateDependencyResults({
    build: { result: "failure" },
    cancelled: { result: "cancelled" },
  }), {
    ok: false,
    failures: [
      { jobId: "build", result: "failure" },
      { jobId: "cancelled", result: "cancelled" },
    ],
  });
});

test("workflow conformance requires complete aggregate coverage and merge-group triggers", () => {
  const ci = `on:\n  merge_group:\njobs:\n  build:\n    name: Build\n  lint:\n    name: Lint\n  merge-readiness:\n    name: Merge Readiness\n    needs:\n      - build\n`;
  const ux = `on:\n  merge_group:\njobs:\n  sweep:\n    name: UX Route Budget Sweep\n`;
  assert.deepEqual(parseWorkflowJobIds(ci), ["build", "lint", "merge-readiness"]);
  assert.deepEqual(validateWorkflowConformance({ manifest, ciSource: ci, uxSource: ux }), [
    "aggregate is missing CI jobs: lint",
  ]);
});

test("protection comparison de-duplicates legacy contexts and app-bound checks", () => {
  assert.equal(compareProtection(manifest, {
    strict: false,
    contexts: ["DCO"],
    checks: [
      { context: "Merge Readiness", app_id: 1 },
      { context: "UX Route Budget Sweep", app_id: 2 },
    ],
  }).ok, true);
});
