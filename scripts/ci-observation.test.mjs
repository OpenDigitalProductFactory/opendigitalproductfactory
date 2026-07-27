import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  collectObservation,
  discoverOwnedSourceFiles,
  parseCliArgs,
} from "./ci-observation.mjs";

const TREE_SHA = "1fc9e749b0040dc793d2ee93f1a83dd8bc081043";

function withTempDir(callback) {
  const directory = mkdtempSync(join(tmpdir(), "dpf-ci-observation-"));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("discoverOwnedSourceFiles includes production TS and excludes tests and declarations", () => {
  withTempDir((repoRoot) => {
    const root = join(repoRoot, "apps", "web", "lib");
    mkdirSync(join(root, "__tests__"), { recursive: true });
    writeFileSync(join(root, "owned.ts"), "export const owned = true;\n");
    writeFileSync(join(root, "view.tsx"), "export const view = null;\n");
    writeFileSync(join(root, "owned.test.ts"), "test('x', () => {});\n");
    writeFileSync(join(root, "types.d.ts"), "export type X = string;\n");
    writeFileSync(join(root, "__tests__", "nested.ts"), "export const fixture = true;\n");

    assert.deepEqual(discoverOwnedSourceFiles({
      repoRoot,
      roots: ["apps/web/lib"],
    }), [
      "apps/web/lib/owned.ts",
      "apps/web/lib/view.tsx",
    ]);
  });
});

test("parseCliArgs preserves repeatable package inputs", () => {
  assert.deepEqual(parseCliArgs([
    "--repository", "OpenDigitalProductFactory/opendigitalproductfactory",
    "--tree-sha", TREE_SHA,
    "--event", "schedule",
    "--run-id", "10",
    "--run-attempt", "2",
    "--created-at", "2026-07-27T00:08:24.000Z",
    "--coverage", "web=artifacts/web/coverage-summary.json",
    "--coverage", "@dpf/db=artifacts/db/coverage-summary.json",
    "--owned-root", "web=apps/web/lib",
    "--owned-root", "web=apps/web/app",
    "--vitest", "web=artifacts/web/vitest.json",
    "--output", "artifacts/ci-observation.json",
  ]), {
    repository: "OpenDigitalProductFactory/opendigitalproductfactory",
    treeSha: TREE_SHA,
    eventName: "schedule",
    runId: "10",
    runAttempt: 2,
    createdAt: "2026-07-27T00:08:24.000Z",
    coverage: [
      { packageName: "web", path: "artifacts/web/coverage-summary.json" },
      { packageName: "@dpf/db", path: "artifacts/db/coverage-summary.json" },
    ],
    ownedRoots: new Map([["web", ["apps/web/lib", "apps/web/app"]]]),
    vitest: [{ packageName: "web", path: "artifacts/web/vitest.json" }],
    previousObservationPath: null,
    shadowSelectionPath: null,
    cacheSamplesPath: null,
    timingSamplesPath: null,
    outputPath: "artifacts/ci-observation.json",
  });
});

test("collectObservation joins coverage, Vitest timing, and prior flake history", () => {
  withTempDir((repoRoot) => {
    const sourceRoot = join(repoRoot, "apps", "web", "lib");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "covered.ts"), "export const covered = true;\n");
    writeFileSync(join(sourceRoot, "unloaded.ts"), "export const unloaded = true;\n");

    const coveragePath = join(repoRoot, "coverage-summary.json");
    writeFileSync(coveragePath, JSON.stringify({
      total: {
        lines: { total: 2, covered: 1, pct: 50 },
        statements: { total: 2, covered: 1, pct: 50 },
        functions: { total: 2, covered: 1, pct: 50 },
        branches: { total: 2, covered: 1, pct: 50 },
      },
      [join(sourceRoot, "covered.ts")]: {
        lines: { total: 1, covered: 1, pct: 100 },
        statements: { total: 1, covered: 1, pct: 100 },
        functions: { total: 1, covered: 1, pct: 100 },
        branches: { total: 1, covered: 1, pct: 100 },
      },
      [join(sourceRoot, "unloaded.ts")]: {
        lines: { total: 1, covered: 0, pct: 0 },
        statements: { total: 1, covered: 0, pct: 0 },
        functions: { total: 1, covered: 0, pct: 0 },
        branches: { total: 1, covered: 0, pct: 0 },
      },
    }));

    const vitestPath = join(repoRoot, "vitest.json");
    writeFileSync(vitestPath, JSON.stringify({
      testResults: [{
        name: join(sourceRoot, "covered.test.ts"),
        status: "passed",
        startTime: 100,
        endTime: 120,
        assertionResults: [{
          ancestorTitles: ["covered"],
          title: "works",
          status: "passed",
          duration: 5,
        }],
      }],
    }));

    const previousPath = join(repoRoot, "previous.json");
    writeFileSync(previousPath, JSON.stringify({
      testHistory: [
        {
          testId: "web::apps/web/lib/covered.test.ts::covered > works",
          file: "apps/web/lib/covered.test.ts",
          title: "covered > works",
          outcome: "failed",
          durationMs: 6,
          runId: "1",
          treeSha: TREE_SHA,
        },
        {
          testId: "web::apps/web/lib/covered.test.ts::covered > works",
          file: "apps/web/lib/covered.test.ts",
          title: "covered > works",
          outcome: "passed",
          durationMs: 5,
          runId: "2",
          treeSha: TREE_SHA,
        },
      ],
    }));
    const shadowPath = join(repoRoot, "shadow.json");
    writeFileSync(shadowPath, JSON.stringify({
      allTestFiles: [
        "apps/web/lib/covered.test.ts",
        "apps/web/lib/unloaded.test.ts",
      ],
      selectedTestFiles: ["apps/web/lib/covered.test.ts"],
      failedTestFiles: ["apps/web/lib/covered.test.ts"],
      unknownChangedFiles: [],
      escalatedToFull: false,
    }));

    const observation = collectObservation({
      repoRoot,
      repository: "OpenDigitalProductFactory/opendigitalproductfactory",
      treeSha: TREE_SHA,
      eventName: "schedule",
      runId: "3",
      runAttempt: 1,
      createdAt: "2026-07-27T00:08:24.000Z",
      coverage: [{ packageName: "web", path: coveragePath }],
      ownedRoots: new Map([["web", ["apps/web/lib"]]]),
      vitest: [{ packageName: "web", path: vitestPath }],
      previousObservationPath: previousPath,
      shadowSelectionPath: shadowPath,
      cacheSamplesPath: null,
      timingSamplesPath: null,
    });

    assert.equal(observation.coverage[0].completeOwnedFileInventory, true);
    assert.deepEqual(observation.coverage[0].unloadedOwnedFiles, [
      "apps/web/lib/unloaded.ts",
    ]);
    assert.equal(observation.testHistory.length, 3);
    assert.equal(observation.flakeHistory.suspectedFlakes.length, 1);
    assert.equal(observation.timings[0].phase, "test:web");
    assert.equal(observation.timings[0].totalMs, 20);
    assert.equal(observation.shadowSelection.selectedPercentage, 50);
    assert.equal(observation.shadowSelection.failureRecall, 100);
  });
});
