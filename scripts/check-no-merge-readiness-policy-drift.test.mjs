import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkflowConformance } from "./merge-readiness-policy.mjs";

test("guard rejects a workflow that loses merge-group coverage", () => {
  const manifest = {
    workflows: { ci: "ci.yml", ux: "ux.yml" },
    aggregateJobId: "merge-readiness",
    aggregateJobName: "Merge Readiness",
    uxJobId: "sweep",
    uxJobName: "UX Route Budget Sweep",
  };
  const ci = `on:\n  pull_request:\njobs:\n  build:\n  merge-readiness:\n    name: Merge Readiness\n    needs:\n      - build\n`;
  const ux = `on:\n  merge_group:\njobs:\n  sweep:\n    name: UX Route Budget Sweep\n`;
  assert.deepEqual(validateWorkflowConformance({ manifest, ciSource: ci, uxSource: ux }), [
    "ci.yml must handle merge_group",
  ]);
});
