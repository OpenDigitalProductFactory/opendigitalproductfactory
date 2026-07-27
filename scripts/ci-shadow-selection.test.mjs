import assert from "node:assert/strict";
import { test } from "node:test";

import { buildShadowSelection } from "./ci-shadow-selection.mjs";

const fullReports = [{
  testResults: [
    { name: "/repo/apps/web/lib/a.test.ts", status: "passed" },
    { name: "/repo/apps/web/lib/b.test.ts", status: "failed" },
    { name: "/repo/apps/web/lib/c.test.ts", status: "passed" },
  ],
}];

test("buildShadowSelection compares related files with exhaustive failures", () => {
  const result = buildShadowSelection({
    repoRoot: "/repo",
    fullReports,
    selectedReport: {
      testResults: [
        { name: "/repo/apps/web/lib/a.test.ts", status: "passed" },
        { name: "/repo/apps/web/lib/b.test.ts", status: "failed" },
      ],
    },
    changedFiles: ["apps/web/lib/a.ts"],
    unknownChangedFiles: [],
    escalatedToFull: false,
  });

  assert.deepEqual(result.allTestFiles, [
    "apps/web/lib/a.test.ts",
    "apps/web/lib/b.test.ts",
    "apps/web/lib/c.test.ts",
  ]);
  assert.deepEqual(result.selectedTestFiles, [
    "apps/web/lib/a.test.ts",
    "apps/web/lib/b.test.ts",
  ]);
  assert.deepEqual(result.failedTestFiles, ["apps/web/lib/b.test.ts"]);
  assert.deepEqual(result.changedFiles, ["apps/web/lib/a.ts"]);
  assert.equal(result.escalatedToFull, false);
});

test("buildShadowSelection expands unknown changes to the full inventory", () => {
  const result = buildShadowSelection({
    repoRoot: "/repo",
    fullReports,
    selectedReport: null,
    changedFiles: ["pnpm-lock.yaml"],
    unknownChangedFiles: ["pnpm-lock.yaml"],
    escalatedToFull: true,
  });

  assert.deepEqual(result.selectedTestFiles, result.allTestFiles);
  assert.deepEqual(result.unknownChangedFiles, ["pnpm-lock.yaml"]);
  assert.equal(result.escalatedToFull, true);
});
