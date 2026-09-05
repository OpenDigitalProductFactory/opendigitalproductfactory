#!/usr/bin/env node
// Host-stage admission calibration, derived from evidence the gate already
// records (BI-E58B57EC).
//
// WHY THIS EXISTS
// `local-ci-slot-resources.json` carries two per-slot memory numbers. The
// builder's was calibrated against an observed high-water. The host stage's was
// a flat 8 GiB with no calibration block until 2026-08-30, when it was set to
// 6 GiB from a single hand measurement of one stage on one afternoon. A number
// typed by a person from one sample is exactly the kind of unevidenced constant
// that produced the latency this epic exists to fix.
//
// The evidence was already on disk and unread. Every vitest stage receipt
// carries ~50 host samples, each with `freeMemoryBytes`. This reads them.
//
// WHAT IT MEASURES, AND WHY THAT STATISTIC
// Admission asks "does another stage fit?", which is a question about FREE
// memory on the host, not about what this stage's own processes used. So the
// decision-relevant number is the MINIMUM free memory observed while a stage was
// running: if that stayed above `floor + N x reserve`, an Nth stage would have
// fitted at the tightest moment of the run.
//
// Measured across 90 receipts on 2026-09-02: p10 4.39 GiB, p50 15.47 GiB, worst
// 0.28 GiB free. The host genuinely exhausts itself during some gate runs, which
// is why the reserve must NOT simply be shrunk to raise the two-slot fit rate —
// doing so admits a second stage precisely onto the runs that later starve.
//
//   node scripts/local-ci-host-stage-calibration.mjs           # human report
//   node scripts/local-ci-host-stage-calibration.mjs --json    # machine output

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";

import { isEntryModule } from "./lib/entry-module.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import slotResources from "../apps/web/lib/nonprod/local-ci-slot-resources.json" with {
  type: "json",
};

const GiB = 1024 ** 3;
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, "..");

/** Minimum free memory observed while a stage ran, per receipt. */
export function minFreeBytesFromReceipt(receipt) {
  const samples = (receipt?.observations ?? [])
    .map((o) => o?.host?.freeMemoryBytes)
    .filter((v) => Number.isFinite(v) && v >= 0);
  // Fewer than three samples is not a run worth calibrating from — the stage
  // died early, or the sampler never got going.
  if (samples.length < 3) return null;
  return { minFreeBytes: Math.min(...samples), samples: samples.length };
}

export function percentile(values, p) {
  if (!values.length) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))];
}

/**
 * How many stages would have fitted, at each run's tightest moment, for a given
 * reserve. This is the only honest way to compare candidate reserves: replay
 * them against what the host actually did.
 */
export function fitRate(minFrees, { floorBytes, reserveBytes, stages }) {
  if (!minFrees.length || reserveBytes <= 0) return 0;
  const need = floorBytes + stages * reserveBytes;
  return minFrees.filter((v) => v >= need).length / minFrees.length;
}

export function collectReceipts(worktreesDir) {
  const out = [];
  if (!existsSync(worktreesDir)) return out;
  for (const wt of readdirSync(worktreesDir)) {
    const file = join(worktreesDir, wt, "dpf-local-ci-metadata.json.vitest.json");
    if (!existsSync(file)) continue;
    let parsed;
    try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    const measured = minFreeBytesFromReceipt(parsed);
    if (!measured) continue;
    out.push({
      worktree: wt,
      stage: parsed.stage ?? "unknown",
      observedAt: statSync(file).mtime.toISOString(),
      ...measured,
    });
  }
  return out;
}

/**
 * Receipts live under the SHARED git common dir, one per linked worktree. In a
 * linked worktree `.git` is a file pointing at the common dir, not a directory,
 * so this must ask git rather than assume a path.
 */
function worktreeReceiptsDir() {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: REPO_ROOT, encoding: "utf8", shell: false, windowsHide: true,
  });
  const common = result.status === 0 ? result.stdout.trim() : "";
  if (!common) return join(REPO_ROOT, ".git", "worktrees");
  return join(common.startsWith(".") ? join(REPO_ROOT, common) : common, "worktrees");
}

export function buildCalibrationReport(receipts, {
  floorBytes = 4 * GiB,
  currentReserveBytes = slotResources.hostStagePolicy.admissionReserveBytes,
} = {}) {
  const minFrees = receipts.map((r) => r.minFreeBytes);
  const byStage = {};
  for (const r of receipts) {
    (byStage[r.stage] ??= []).push(r.minFreeBytes);
  }
  return {
    receipts: receipts.length,
    floorBytes,
    currentReserveBytes,
    minFreeBytes: {
      p10: percentile(minFrees, 0.1),
      p50: percentile(minFrees, 0.5),
      p90: percentile(minFrees, 0.9),
      worst: minFrees.length ? Math.min(...minFrees) : Number.NaN,
    },
    twoStageFitRateAtCurrentReserve: fitRate(minFrees, {
      floorBytes, reserveBytes: currentReserveBytes, stages: 2,
    }),
    byStage: Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, {
      runs: v.length, p10: percentile(v, 0.1), p50: percentile(v, 0.5),
    }])),
  };
}

function g(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / GiB).toFixed(2)} GiB` : "n/a";
}

function main() {
  const receipts = collectReceipts(worktreeReceiptsDir());
  const report = buildCalibrationReport(receipts);
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (!report.receipts) {
    process.stdout.write(
      "[host-stage-calibration] no vitest stage receipts with host samples found — " +
      "run the gate at least once on this host, then re-run.\n",
    );
    return;
  }
  process.stdout.write(
    `[host-stage-calibration] ${report.receipts} receipts\n` +
    `  minimum free memory while a stage ran:\n` +
    `    p10 ${g(report.minFreeBytes.p10)}   p50 ${g(report.minFreeBytes.p50)}   ` +
    `p90 ${g(report.minFreeBytes.p90)}   worst ${g(report.minFreeBytes.worst)}\n` +
    `  current reserve ${g(report.currentReserveBytes)}, floor ${g(report.floorBytes)}\n` +
    `  a 2nd stage would have fitted in ` +
    `${(report.twoStageFitRateAtCurrentReserve * 100).toFixed(0)}% of runs\n`,
  );
  for (const [stage, s] of Object.entries(report.byStage)) {
    process.stdout.write(
      `  ${stage.padEnd(18)} ${String(s.runs).padStart(3)} runs   ` +
      `p10 ${g(s.p10)}   p50 ${g(s.p50)}\n`,
    );
  }
  process.stdout.write(
    "  NOTE: a low fit rate is not on its own a reason to shrink the reserve. " +
    "Shrinking it admits a second stage onto exactly the runs whose free memory " +
    "later collapses. Reduce what a stage consumes first.\n",
  );
}

if (isEntryModule(import.meta.url)) {
  main();
}
