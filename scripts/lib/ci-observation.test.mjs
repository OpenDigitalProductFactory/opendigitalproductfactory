import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CI_OBSERVATION_SCHEMA_VERSION,
  buildCiObservation,
  calculateCacheEconomics,
  calculateSelectionRecall,
  classifyFlakeHistory,
  parseVitestJsonReport,
  summarizeCoverage,
  summarizeTimings,
} from "./ci-observation.mjs";

const TREE_SHA = "1fc9e749b0040dc793d2ee93f1a83dd8bc081043";

test("buildCiObservation binds evidence to an immutable tree and stable schema", () => {
  const observation = buildCiObservation({
    repository: "OpenDigitalProductFactory/opendigitalproductfactory",
    treeSha: TREE_SHA,
    eventName: "schedule",
    runId: "30226340321",
    runAttempt: 1,
    createdAt: "2026-07-27T00:08:24.000Z",
    coverage: [],
    testRuns: [],
    cacheSamples: [],
    shadowSelection: null,
  });

  assert.equal(observation.schemaVersion, CI_OBSERVATION_SCHEMA_VERSION);
  assert.equal(observation.identity.treeSha, TREE_SHA);
  assert.equal(observation.identity.runId, "30226340321");
  assert.equal(observation.identity.runAttempt, 1);
  assert.deepEqual(Object.keys(observation).sort(), [
    "cacheEconomics",
    "coverage",
    "createdAt",
    "flakeHistory",
    "identity",
    "schemaVersion",
    "shadowSelection",
    "testHistory",
    "timings",
  ]);
});

test("buildCiObservation rejects evidence without an immutable Git tree", () => {
  assert.throws(
    () =>
      buildCiObservation({
        repository: "OpenDigitalProductFactory/opendigitalproductfactory",
        treeSha: "main",
        eventName: "schedule",
        runId: "1",
        runAttempt: 1,
        createdAt: "2026-07-27T00:08:24.000Z",
      }),
    /40-character Git SHA/,
  );
});

test("summarizeCoverage publishes all four metrics and unloaded owned files", () => {
  const summary = summarizeCoverage({
    packageName: "web",
    ownedFiles: [
      "apps/web/lib/covered.ts",
      "apps/web/lib/unloaded.ts",
    ],
    coverageSummary: {
      total: {
        lines: { total: 20, covered: 15, skipped: 0, pct: 75 },
        statements: { total: 24, covered: 18, skipped: 0, pct: 75 },
        functions: { total: 8, covered: 6, skipped: 0, pct: 75 },
        branches: { total: 10, covered: 7, skipped: 0, pct: 70 },
      },
      "apps/web/lib/covered.ts": {
        lines: { total: 20, covered: 15, skipped: 0, pct: 75 },
        statements: { total: 24, covered: 18, skipped: 0, pct: 75 },
        functions: { total: 8, covered: 6, skipped: 0, pct: 75 },
        branches: { total: 10, covered: 7, skipped: 0, pct: 70 },
      },
      "apps/web/lib/unloaded.ts": {
        lines: { total: 4, covered: 0, skipped: 0, pct: 0 },
        statements: { total: 4, covered: 0, skipped: 0, pct: 0 },
        functions: { total: 1, covered: 0, skipped: 0, pct: 0 },
        branches: { total: 2, covered: 0, skipped: 0, pct: 0 },
      },
    },
  });

  assert.deepEqual(summary.metrics, {
    statements: { total: 24, covered: 18, pct: 75 },
    branches: { total: 10, covered: 7, pct: 70 },
    functions: { total: 8, covered: 6, pct: 75 },
    lines: { total: 20, covered: 15, pct: 75 },
  });
  assert.equal(summary.ownedFileCount, 2);
  assert.equal(summary.reportedOwnedFileCount, 2);
  assert.deepEqual(summary.unloadedOwnedFiles, ["apps/web/lib/unloaded.ts"]);
  assert.deepEqual(summary.missingOwnedFiles, []);
});

test("summarizeCoverage exposes owned files missing from a misleading report", () => {
  const summary = summarizeCoverage({
    packageName: "@dpf/db",
    ownedFiles: ["packages/db/src/covered.ts", "packages/db/src/missing.ts"],
    coverageSummary: {
      total: {
        lines: { total: 1, covered: 1, skipped: 0, pct: 100 },
        statements: { total: 1, covered: 1, skipped: 0, pct: 100 },
        functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
        branches: { total: 1, covered: 1, skipped: 0, pct: 100 },
      },
      "packages/db/src/covered.ts": {
        lines: { total: 1, covered: 1, skipped: 0, pct: 100 },
        statements: { total: 1, covered: 1, skipped: 0, pct: 100 },
        functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
        branches: { total: 1, covered: 1, skipped: 0, pct: 100 },
      },
    },
  });

  assert.deepEqual(summary.missingOwnedFiles, ["packages/db/src/missing.ts"]);
  assert.equal(summary.completeOwnedFileInventory, false);
});

test("calculateSelectionRecall records selected percentage and missed failures", () => {
  const result = calculateSelectionRecall({
    allTestFiles: ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts"],
    selectedTestFiles: ["a.test.ts", "c.test.ts"],
    failedTestFiles: ["c.test.ts", "d.test.ts"],
    unknownChangedFiles: ["apps/web/lib/dynamic-loader.ts"],
    escalatedToFull: false,
  });

  assert.equal(result.selectedPercentage, 50);
  assert.equal(result.observedFailureCount, 2);
  assert.equal(result.selectedFailureCount, 1);
  assert.equal(result.failureRecall, 50);
  assert.deepEqual(result.missedFailures, ["d.test.ts"]);
  assert.equal(result.safeForActivation, false);
});

test("calculateSelectionRecall does not claim recall when no failure was observed", () => {
  const result = calculateSelectionRecall({
    allTestFiles: ["a.test.ts"],
    selectedTestFiles: ["a.test.ts"],
    failedTestFiles: [],
    unknownChangedFiles: [],
    escalatedToFull: false,
  });

  assert.equal(result.failureRecall, null);
  assert.equal(result.safeForActivation, false);
  assert.equal(result.reason, "no-full-suite-failure-observed");
});

test("calculateSelectionRecall treats fail-safe full expansion as safe evidence", () => {
  const result = calculateSelectionRecall({
    allTestFiles: ["a.test.ts", "b.test.ts"],
    selectedTestFiles: ["a.test.ts", "b.test.ts"],
    failedTestFiles: ["b.test.ts"],
    unknownChangedFiles: ["apps/web/lib/unknown.ts"],
    escalatedToFull: true,
  });

  assert.equal(result.failureRecall, 100);
  assert.deepEqual(result.missedFailures, []);
  assert.equal(result.safeForActivation, true);
  assert.equal(result.reason, "full-suite-escalation");
});

test("classifyFlakeHistory needs repeated history and preserves every red outcome", () => {
  const result = classifyFlakeHistory([
    { testId: "web::lib/a.test.ts::is stable", runId: "1", treeSha: TREE_SHA, outcome: "failed", durationMs: 8 },
    { testId: "web::lib/a.test.ts::is stable", runId: "2", treeSha: TREE_SHA, outcome: "passed", durationMs: 7 },
    { testId: "web::lib/a.test.ts::is stable", runId: "3", treeSha: TREE_SHA, outcome: "passed", durationMs: 6 },
    { testId: "web::lib/b.test.ts::one retry", runId: "1", treeSha: TREE_SHA, outcome: "failed", durationMs: 4 },
    { testId: "web::lib/b.test.ts::one retry", runId: "2", treeSha: TREE_SHA, outcome: "passed", durationMs: 4 },
  ]);

  assert.deepEqual(result.suspectedFlakes.map((entry) => entry.testId), [
    "web::lib/a.test.ts::is stable",
  ]);
  assert.equal(result.suspectedFlakes[0].failedRuns, 1);
  assert.equal(result.suspectedFlakes[0].passedRuns, 2);
  assert.deepEqual(result.insufficientHistory, ["web::lib/b.test.ts::one retry"]);
});

test("buildCiObservation carries bounded prior outcomes into flake classification", () => {
  const observation = buildCiObservation({
    repository: "OpenDigitalProductFactory/opendigitalproductfactory",
    treeSha: TREE_SHA,
    eventName: "schedule",
    runId: "3",
    runAttempt: 1,
    createdAt: "2026-07-27T00:08:24.000Z",
    coverage: [],
    testRuns: [{
      packageName: "web",
      files: [],
      tests: [{
        testId: "web::lib/a.test.ts::works",
        file: "lib/a.test.ts",
        title: "works",
        outcome: "passed",
        durationMs: 5,
        runId: "3",
        treeSha: TREE_SHA,
      }],
    }],
    historicalTestObservations: [
      {
        testId: "web::lib/a.test.ts::works",
        file: "lib/a.test.ts",
        title: "works",
        outcome: "failed",
        durationMs: 6,
        runId: "1",
        treeSha: TREE_SHA,
      },
      {
        testId: "web::lib/a.test.ts::works",
        file: "lib/a.test.ts",
        title: "works",
        outcome: "passed",
        durationMs: 5,
        runId: "2",
        treeSha: TREE_SHA,
      },
    ],
    cacheSamples: [],
    shadowSelection: null,
  });

  assert.equal(observation.testHistory.length, 3);
  assert.equal(observation.flakeHistory.suspectedFlakes.length, 1);
  assert.equal(observation.flakeHistory.suspectedFlakes[0].failedRuns, 1);
});

test("calculateCacheEconomics reports hit rate, transfer cost, and net value", () => {
  const result = calculateCacheEconomics([
    {
      cacheName: "pnpm-store",
      hit: true,
      bytes: 500,
      restoreMs: 100,
      saveMs: 0,
      downstreamMs: 400,
      coldBaselineMs: 900,
    },
    {
      cacheName: "pnpm-store",
      hit: false,
      bytes: 520,
      restoreMs: 20,
      saveMs: 140,
      downstreamMs: 950,
      coldBaselineMs: 900,
    },
  ]);

  assert.deepEqual(result, [{
    cacheName: "pnpm-store",
    samples: 2,
    hits: 1,
    misses: 1,
    hitRate: 50,
    bytes: 1020,
    restoreMs: 120,
    saveMs: 140,
    downstreamMs: 1350,
    estimatedTimeSavedMs: 500,
    netValueMs: 240,
  }]);
});

test("parseVitestJsonReport retains file failures and per-test timings", () => {
  const report = parseVitestJsonReport({
    numTotalTestSuites: 1,
    numPassedTestSuites: 0,
    numFailedTestSuites: 1,
    testResults: [{
      name: "D:/DPF/apps/web/lib/example.test.ts",
      status: "failed",
      startTime: 100,
      endTime: 135,
      assertionResults: [
        {
          ancestorTitles: ["example"],
          title: "works",
          status: "failed",
          duration: 12,
        },
      ],
    }],
  }, {
    packageName: "web",
    repoRoot: "D:/DPF",
    runId: "42",
    treeSha: TREE_SHA,
  });

  assert.deepEqual(report.failedTestFiles, ["apps/web/lib/example.test.ts"]);
  assert.deepEqual(report.tests, [{
    testId: "web::apps/web/lib/example.test.ts::example > works",
    file: "apps/web/lib/example.test.ts",
    title: "example > works",
    outcome: "failed",
    durationMs: 12,
    runId: "42",
    treeSha: TREE_SHA,
  }]);
  assert.equal(report.files[0].durationMs, 35);
});

test("summarizeTimings publishes deterministic nearest-rank p50 and p90", () => {
  assert.deepEqual(summarizeTimings([
    { phase: "test", durationMs: 10 },
    { phase: "test", durationMs: 20 },
    { phase: "test", durationMs: 30 },
    { phase: "test", durationMs: 40 },
    { phase: "test", durationMs: 100 },
    { phase: "build", durationMs: 250 },
  ]), [
    { phase: "build", samples: 1, totalMs: 250, minMs: 250, p50Ms: 250, p90Ms: 250, maxMs: 250 },
    { phase: "test", samples: 5, totalMs: 200, minMs: 10, p50Ms: 30, p90Ms: 100, maxMs: 100 },
  ]);
});
