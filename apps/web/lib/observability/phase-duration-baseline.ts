// Phase-duration baseline + threshold-calibration check for the taskrun
// watchdog (BI-A1FC3EBB, EP-FULL-OBS).
//
// The watchdog's PRIMARY stall signal is heartbeat silence (`decideStall` in
// watchdog-detect.ts) — a crisp deadness signal that needs no learning: a dead
// process stops heartbeating. Per the platform bridge-pattern doctrine (ascend
// to AI only where a boundary is genuinely fuzzy, then re-descend to code) we
// keep that deterministic. The one genuinely naive part is the per-phase TOTAL
// timeout: a hand-seeded `BuildStudioStallThreshold` constant that nobody checks
// against the actual phase-duration distribution. A phase whose real p95 exceeds
// its seeded total-timeout false-stalls legitimate slow runs; one far under it
// leaves the wall-clock backstop lax.
//
// This module makes that calibration observable from data already collected but
// never read for this purpose — `BuildPhaseRun.durationMs`. Pure + deterministic
// (no DB, no clock) so it is fully unit-testable; the watchdog/report wires the
// query. A learned/statistical anomaly step is deferred and conditional (the
// distribution must be visible first). See the design pass:
// docs/superpowers/plans/2026-06-26-watchdog-phase-duration-baseline-design.md

export interface PhaseDurationSample {
  phase: string;
  /** Completed-phase duration in ms (BuildPhaseRun.durationMs). */
  durationMs: number;
}

export interface PhaseDurationStats {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/**
 * Per-phase duration baseline from completed `BuildPhaseRun` rows. Percentiles
 * use nearest-rank on the sorted samples (deterministic, no interpolation).
 * Non-finite/negative durations are dropped; phases with no valid samples are
 * omitted entirely.
 */
export function summarizePhaseDurationBaseline(
  samples: PhaseDurationSample[],
): Record<string, PhaseDurationStats> {
  const byPhase = new Map<string, number[]>();
  for (const s of samples) {
    if (!Number.isFinite(s.durationMs) || s.durationMs < 0) continue;
    const arr = byPhase.get(s.phase) ?? [];
    arr.push(s.durationMs);
    byPhase.set(s.phase, arr);
  }

  const out: Record<string, PhaseDurationStats> = {};
  for (const [phase, durations] of byPhase) {
    durations.sort((a, b) => a - b);
    out[phase] = {
      count: durations.length,
      p50Ms: percentileNearestRank(durations, 50),
      p95Ms: percentileNearestRank(durations, 95),
      maxMs: durations[durations.length - 1]!,
    };
  }
  return out;
}

/** Nearest-rank percentile on an already-ascending, non-empty array. */
function percentileNearestRank(sortedAsc: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sortedAsc.length); // 1-based
  const idx = Math.min(sortedAsc.length, Math.max(1, rank)) - 1;
  return sortedAsc[idx]!;
}

export type CalibrationVerdict = "ok" | "too-tight" | "too-loose" | "insufficient-data";

export interface CalibrationAssessment {
  verdict: CalibrationVerdict;
  /** observed p95 / seeded total-timeout; null when insufficient data. */
  ratio: number | null;
  reason: string;
}

/** Minimum completed phase runs before a calibration verdict is trustworthy. */
export const MIN_SAMPLES_FOR_CALIBRATION = 20;
/** Below this p95/timeout ratio the wall-clock backstop is considered lax. */
export const TOO_LOOSE_RATIO = 0.25;

/**
 * Compare a phase's seeded total-timeout against its observed p95 duration:
 *   - p95 above the timeout  → too-tight (legitimate runs risk false stalls)
 *   - p95 far below it        → too-loose (the wall-clock backstop is lax)
 *
 * Deterministic; the sample floor and ratio are explicit + the learnable
 * surface. ADVISORY ONLY — this never changes reaping; it tells an operator
 * whether the seeded constant still matches reality.
 */
export function assessThresholdCalibration(args: {
  stats: PhaseDurationStats | undefined;
  seededTotalTimeoutMs: number;
}): CalibrationAssessment {
  const { stats, seededTotalTimeoutMs } = args;

  if (!stats || stats.count < MIN_SAMPLES_FOR_CALIBRATION) {
    return {
      verdict: "insufficient-data",
      ratio: null,
      reason: `need >= ${MIN_SAMPLES_FOR_CALIBRATION} completed runs to judge calibration`,
    };
  }
  if (!(seededTotalTimeoutMs > 0)) {
    return { verdict: "insufficient-data", ratio: null, reason: "no positive total-timeout to compare against" };
  }

  const ratio = stats.p95Ms / seededTotalTimeoutMs;

  if (stats.p95Ms > seededTotalTimeoutMs) {
    return {
      verdict: "too-tight",
      ratio,
      reason: `p95 (${ms(stats.p95Ms)}) exceeds the ${ms(seededTotalTimeoutMs)} total-timeout — legitimate runs risk false stalls`,
    };
  }
  if (ratio < TOO_LOOSE_RATIO) {
    return {
      verdict: "too-loose",
      ratio,
      reason: `p95 (${ms(stats.p95Ms)}) is well under the ${ms(seededTotalTimeoutMs)} total-timeout — the backstop is lax`,
    };
  }
  return {
    verdict: "ok",
    ratio,
    reason: `p95 (${ms(stats.p95Ms)}) sits within the ${ms(seededTotalTimeoutMs)} total-timeout`,
  };
}

function ms(v: number): string {
  return v >= 1000 ? `${Math.round(v / 1000)}s` : `${Math.round(v)}ms`;
}
