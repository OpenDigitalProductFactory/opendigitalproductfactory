import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalibrationReport,
  fitRate,
  minFreeBytesFromReceipt,
  percentile,
} from "./local-ci-host-stage-calibration.mjs";

const GiB = 1024 ** 3;
const sample = (freeGiB) => ({ host: { freeMemoryBytes: freeGiB * GiB } });

test("reads the minimum free memory across a stage's host samples", () => {
  const r = minFreeBytesFromReceipt({
    observations: [sample(20), sample(6), sample(14)],
  });
  assert.equal(r.minFreeBytes, 6 * GiB);
  assert.equal(r.samples, 3);
});

test("ignores non-finite and negative samples rather than treating them as zero free", () => {
  // A garbage sample reading as 0 free would make every run look catastrophic
  // and drive the reserve to nonsense.
  const r = minFreeBytesFromReceipt({
    observations: [sample(20), { host: { freeMemoryBytes: null } },
      { host: { freeMemoryBytes: -1 } }, sample(12), sample(15)],
  });
  assert.equal(r.minFreeBytes, 12 * GiB);
  assert.equal(r.samples, 3);
});

test("a run with fewer than three samples is not calibration evidence", () => {
  // The stage died early or the sampler never got going. Calibrating a fleet
  // constant off one reading is what produced the number this tool replaces.
  assert.equal(minFreeBytesFromReceipt({ observations: [sample(9), sample(8)] }), null);
  assert.equal(minFreeBytesFromReceipt({ observations: [] }), null);
  assert.equal(minFreeBytesFromReceipt({}), null);
  assert.equal(minFreeBytesFromReceipt(null), null);
});

test("observations with no host block are skipped, not counted as free memory", () => {
  assert.equal(minFreeBytesFromReceipt({
    observations: [{ attempt: 1 }, { classification: "passed" }, sample(11)],
  }), null);
});

test("fitRate replays a candidate reserve against what the host actually did", () => {
  const mins = [4, 8, 16, 20, 30].map((g) => g * GiB);
  // floor 4 + 2x6 = 16 GiB needed for a second stage: 16, 20 and 30 clear it.
  assert.equal(fitRate(mins, { floorBytes: 4 * GiB, reserveBytes: 6 * GiB, stages: 2 }), 3 / 5);
  // A smaller reserve fits more runs — the seductive move this tool exists to
  // put a number against rather than leave to intuition.
  assert.equal(fitRate(mins, { floorBytes: 4 * GiB, reserveBytes: 2 * GiB, stages: 2 }), 4 / 5);
});

test("fitRate is zero, not NaN or a crash, on empty or absurd input", () => {
  assert.equal(fitRate([], { floorBytes: 4 * GiB, reserveBytes: 6 * GiB, stages: 2 }), 0);
  assert.equal(fitRate([10 * GiB], { floorBytes: 4 * GiB, reserveBytes: 0, stages: 2 }), 0);
  assert.equal(fitRate([10 * GiB], { floorBytes: 4 * GiB, reserveBytes: -1, stages: 2 }), 0);
});

test("percentile is order-independent and handles a single value", () => {
  assert.equal(percentile([5, 1, 3], 0), 1);
  assert.equal(percentile([5, 1, 3], 1), 5);
  assert.equal(percentile([7], 0.5), 7);
  assert.ok(Number.isNaN(percentile([], 0.5)));
});

test("the report separates stages, so affected and exhaustive runs are not averaged together", () => {
  // Averaging them would hide the whole point: an affected run leaves more
  // headroom than an exhaustive one, and that is what changes the fit rate.
  const report = buildCalibrationReport([
    { stage: "exhaustive-vitest", minFreeBytes: 4 * GiB },
    { stage: "exhaustive-vitest", minFreeBytes: 6 * GiB },
    { stage: "affected-vitest", minFreeBytes: 22 * GiB },
    { stage: "affected-vitest", minFreeBytes: 26 * GiB },
  ], { floorBytes: 4 * GiB, currentReserveBytes: 6 * GiB });

  assert.equal(report.receipts, 4);
  assert.equal(report.byStage["exhaustive-vitest"].runs, 2);
  assert.equal(report.byStage["affected-vitest"].runs, 2);
  assert.ok(
    report.byStage["affected-vitest"].p50 > report.byStage["exhaustive-vitest"].p50,
    "affected runs must show more headroom than exhaustive ones",
  );
  assert.equal(report.twoStageFitRateAtCurrentReserve, 0.5);
});

test("an empty corpus reports zero receipts rather than inventing a reserve", () => {
  const report = buildCalibrationReport([]);
  assert.equal(report.receipts, 0);
  assert.equal(report.twoStageFitRateAtCurrentReserve, 0);
  assert.ok(Number.isNaN(report.minFreeBytes.p50));
});
