import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkflowConformance } from "./merge-readiness-policy.mjs";

test("guard rejects a workflow that loses merge-group coverage", () => {
  const manifest = {
    workflows: { ci: "ci.yml", ux: "ux.yml" },
    aggregateJobId: "merge-readiness",
    aggregateJobName: "Merge Readiness",
    uxJobId: "ux-route-sweep",
    uxJobName: "UX Route Budget Sweep",
    uxRuntimeJobId: "sweep",
    uxRuntimeJobName: "UX Route Sweep Runtime",
  };
  const ci = `on:\n  pull_request:\njobs:\n  build:\n  ux-route-sweep:\n    name: UX Route Budget Sweep\n  merge-readiness:\n    name: Merge Readiness\n    needs:\n      - build\n      - ux-route-sweep\n`;
  const ux = `on:\n  workflow_call:\njobs:\n  sweep:\n    name: UX Route Sweep Runtime\n`;
  assert.deepEqual(validateWorkflowConformance({ manifest, ciSource: ci, uxSource: ux }), [
    "ci.yml must handle merge_group",
  ]);
});

test("guard requires the UX implementation to remain reusable", () => {
  const manifest = {
    workflows: { ci: "ci.yml", ux: "ux.yml" },
    aggregateJobId: "merge-readiness",
    aggregateJobName: "Merge Readiness",
    uxJobId: "ux-route-sweep",
    uxJobName: "UX Route Budget Sweep",
    uxRuntimeJobId: "sweep",
    uxRuntimeJobName: "UX Route Sweep Runtime",
  };
  const ci = `on:\n  merge_group:\njobs:\n  ux-route-sweep:\n    name: UX Route Budget Sweep\n  merge-readiness:\n    name: Merge Readiness\n    needs:\n      - ux-route-sweep\n`;
  const ux = `on:\n  workflow_dispatch:\njobs:\n  sweep:\n    name: UX Route Sweep Runtime\n`;
  assert.deepEqual(validateWorkflowConformance({ manifest, ciSource: ci, uxSource: ux }), [
    "ux.yml must handle workflow_call",
  ]);
});
