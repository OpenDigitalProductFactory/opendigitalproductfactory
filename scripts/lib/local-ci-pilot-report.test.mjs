import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateLocalCiPilot,
  LOCAL_CI_PILOT_REPORT_VERSION,
} from "./local-ci-pilot-report.mjs";

const baseline = {
  sampleCount: 40,
  medianQueueWaitMs: 500,
  p95QueueWaitMs: 2_000,
  medianCycleMs: 1_100,
  medianServiceDurationMs: 600,
  throughputPerHour: 3.2,
  infrastructureFailureRatePercent: 1,
};

const safePilot = {
  sampleCount: 42,
  medianQueueWaitMs: 220,
  p95QueueWaitMs: 1_200,
  medianCycleMs: 820,
  medianServiceDurationMs: 660,
  throughputPerHour: 5.1,
  infrastructureFailureRatePercent: 1.5,
  isolationDefectCount: 0,
  evidenceMismatchCount: 0,
  unattributedFailureCount: 0,
  pressureCeilingBreachCount: 0,
  dockerHealthFailureCount: 0,
  controlPlaneStarvationCount: 0,
};

test("retains capacity two only when representative evidence clears every threshold", () => {
  const report = evaluateLocalCiPilot({ baseline, pilot: safePilot });

  assert.equal(report.reportVersion, LOCAL_CI_PILOT_REPORT_VERSION);
  assert.equal(report.recommendation, "retain");
  assert.equal(report.comparison.p95QueueWaitImprovementPercent, 40);
  assert.equal(report.comparison.medianServiceDurationRegressionPercent, 10);
  assert.deepEqual(report.blockers, []);
});

test("an isolation or evidence defect immediately recommends rollback", () => {
  for (const defect of [
    { isolationDefectCount: 1 },
    { evidenceMismatchCount: 1 },
    { unattributedFailureCount: 1 },
  ]) {
    const report = evaluateLocalCiPilot({
      baseline,
      pilot: { ...safePilot, ...defect },
    });
    assert.equal(report.recommendation, "rollback");
    assert.match(report.blockers.join(" "), /(isolation|evidence|attribution)/);
  }
});

test("unsafe host health or threshold regressions recommend rollback", () => {
  const scenarios = [
    [{ pressureCeilingBreachCount: 1 }, "host-pressure-ceiling-breached"],
    [{ dockerHealthFailureCount: 1 }, "docker-health-degraded"],
    [{ controlPlaneStarvationCount: 1 }, "control-plane-starvation-observed"],
    [{ medianServiceDurationMs: 700 }, "service-duration-regressed"],
    [{ infrastructureFailureRatePercent: 6 }, "infrastructure-failure-rate-high"],
  ];

  for (const [change, expectedBlocker] of scenarios) {
    const report = evaluateLocalCiPilot({
      baseline,
      pilot: { ...safePilot, ...change },
    });
    assert.equal(report.recommendation, "rollback");
    assert.ok(report.blockers.includes(expectedBlocker));
  }
});

test("insufficient, incomparable, or immaterial speed evidence recommends tune", () => {
  const scenarios = [
    { ...safePilot, sampleCount: 8 },
    { ...safePilot, sampleCount: 80 },
    { ...safePilot, p95QueueWaitMs: 1_800 },
  ];

  for (const pilot of scenarios) {
    const report = evaluateLocalCiPilot({ baseline, pilot });
    assert.equal(report.recommendation, "tune");
    assert.ok(report.advisories.length > 0);
  }
});

test("malformed numeric evidence fails closed to rollback", () => {
  for (const pilot of [
    { ...safePilot, medianServiceDurationMs: Number.NaN },
    { ...safePilot, sampleCount: 4.5 },
    { ...safePilot, infrastructureFailureRatePercent: 101 },
    { ...safePilot, isolationDefectCount: 0.5 },
  ]) {
    const report = evaluateLocalCiPilot({ baseline, pilot });
    assert.equal(report.recommendation, "rollback");
    assert.ok(report.blockers.includes("pilot-evidence-invalid"));
  }
});

test("evidence cannot relax platform-owned decision thresholds", () => {
  const report = evaluateLocalCiPilot({
    baseline,
    pilot: {
      ...safePilot,
      medianServiceDurationMs: 900,
      infrastructureFailureRatePercent: 50,
    },
    thresholds: {
      minimumSamplesPerWindow: 0,
      minimumP95QueueWaitImprovementPercent: 0,
      maximumMedianServiceDurationRegressionPercent: 100,
      maximumInfrastructureFailureRatePercent: 100,
      minimumComparableSampleRatio: 0,
      maximumComparableSampleRatio: 100,
    },
  });

  assert.equal(report.recommendation, "rollback");
  assert.ok(report.blockers.includes("service-duration-regressed"));
  assert.ok(report.blockers.includes("infrastructure-failure-rate-high"));
});

test("trusted policy may tighten but never relax platform rollback limits", () => {
  const stricter = evaluateLocalCiPilot({
    baseline,
    pilot: safePilot,
    policy: {
      rollback: {
        maxServiceDurationRegressionPercent: 5,
        maxInfrastructureFailureRatePercent: 1,
        evidenceMismatchTolerance: 0,
      },
    },
  });
  assert.equal(stricter.recommendation, "rollback");
  assert.ok(stricter.blockers.includes("service-duration-regressed"));
  assert.ok(stricter.blockers.includes("infrastructure-failure-rate-high"));

  const attemptedRelaxation = evaluateLocalCiPilot({
    baseline,
    pilot: {
      ...safePilot,
      medianServiceDurationMs: 700,
      infrastructureFailureRatePercent: 6,
    },
    policy: {
      rollback: {
        maxServiceDurationRegressionPercent: 100,
        maxInfrastructureFailureRatePercent: 100,
        evidenceMismatchTolerance: 0,
      },
    },
  });
  assert.equal(attemptedRelaxation.recommendation, "rollback");
  assert.equal(
    attemptedRelaxation.thresholds.maximumMedianServiceDurationRegressionPercent,
    15,
  );
  assert.equal(
    attemptedRelaxation.thresholds.maximumInfrastructureFailureRatePercent,
    5,
  );
});

test("CLI emits machine-readable evidence and distinct retain/tune/rollback exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dpf-local-ci-report-"));
  try {
    for (const [pilot, expectedRecommendation, expectedStatus] of [
      [safePilot, "retain", 0],
      [{ ...safePilot, p95QueueWaitMs: 1_800 }, "tune", 1],
      [{ ...safePilot, isolationDefectCount: 1 }, "rollback", 2],
    ]) {
      const path = join(directory, `${expectedRecommendation}.json`);
      await writeFile(path, JSON.stringify({ baseline, pilot }));
      const result = spawnSync(
        process.execPath,
        ["scripts/local-ci-pilot-report.mjs", "--input", path],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      assert.equal(result.status, expectedStatus, result.stderr);
      assert.equal(JSON.parse(result.stdout).recommendation, expectedRecommendation);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
