# Watchdog phase-duration calibration — design pass

- **BI:** BI-A1FC3EBB — "taskrun-watchdog learned phase-duration anomaly detection vs fixed timeouts"
- **Epic:** EP-FULL-OBS
- **Date:** 2026-06-26
- **Status:** design pass complete; deterministic primitives shipped with this doc; learned/statistical anomaly deferred (conditional — see §5)

## 0. TL;DR

The BI asks to replace fixed timeouts with a *learned* phase-duration anomaly
detector. Applying the same bridge-pattern test the curator (BI-93FE150F) just
got: **the watchdog's primary boundary is already crisp.** It stalls a TaskRun on
*heartbeat silence* — a dead process stops heartbeating — and it *already*
resolves per-phase thresholds. A learned model over phase durations would be
over-engineering the one signal that is inherently sharp.

The genuine, narrow gap is calibration: the per-phase **total-timeout** is a
hand-seeded constant nobody checks against the actual duration distribution. This
pass ships the deterministic primitives to make that calibration observable
(`summarizePhaseDurationBaseline`, `assessThresholdCalibration`) and **re-scopes**
the BI from "learn anomalies" to "calibrate deterministically; ascend only if the
boundary proves fuzzy."

## 1. What the BI assumed vs. what the code is

| BI premise | Reality in `main` |
|---|---|
| "fixed timeouts" (implying one global timeout) | Per-phase thresholds already (`BuildStudioStallThreshold`: ideate 90/900, plan 120/1800, build 180/3600, …) |
| Stall = phase-duration anomaly | Stall = **heartbeat silence** first; total-duration is only a wall-clock backstop |
| Needs a learned classifier | The deadness signal is crisp; only the backstop constant is uncalibrated |

Evidence:
- `apps/web/lib/observability/watchdog-detect.ts:40` — `decideStall()`: priority is `total_timeout` (wall-clock) → `never_started` → `heartbeat_timeout` (silence). Heartbeat silence is the core signal.
- `apps/web/lib/queue/functions/taskrun-watchdog.ts:~250,289` — resolves a **per-phase** threshold (`thresholdByScope`) then calls `decideStall`. On a positive it marks `status="stalled"` + writes a `StallEvent` + notifies; recovery is operator-driven (it does **not** auto-reap).
- `packages/db/src/seed-stall-thresholds.ts` — the per-phase constants, seeded once, operator-editable.
- `packages/db/prisma/schema.prisma` `BuildPhaseRun.durationMs` — completed-phase durations are collected but **never read** to check those constants.

## 2. The bridge-pattern test

- **Heartbeat-silence boundary — CRISP.** "Has the run emitted a heartbeat within
  the window?" is a binary deadness fact. A learned model here adds a model
  dependency + non-determinism to reproduce a correct, robust rule. **Keep
  deterministic. Do not ascend.**
- **Total-timeout calibration — NAIVE, not fuzzy.** The constant is just
  *unchecked* against reality, not inherently ambiguous. The fix is to *measure*
  the distribution (deterministic percentiles), not to *learn* it. A learned
  step earns its keep only if deterministic p95 calibration later proves
  insufficient — and even then statistical (z-score) before ML.

## 3. The real gap: silent mis-calibration

A phase whose real p95 exceeds its seeded total-timeout false-stalls legitimate
slow runs; one whose p95 is a small fraction of the timeout leaves the wall-clock
backstop lax. Today nobody can see which: `BuildPhaseRun.durationMs` is collected
and discarded for this purpose. Closing this needs no model and no new
telemetry — just read the durations already in hand.

## 4. Deterministic primitives — shipped with this pass

`apps/web/lib/observability/phase-duration-baseline.ts`:

- `summarizePhaseDurationBaseline(samples)` → per-phase `{count, p50Ms, p95Ms, maxMs}` (nearest-rank percentiles; drops bad samples).
- `assessThresholdCalibration({stats, seededTotalTimeoutMs})` → `ok | too-tight | too-loose | insufficient-data`, with explicit, named, *learnable* constants: `MIN_SAMPLES_FOR_CALIBRATION = 20`, `TOO_LOOSE_RATIO = 0.25`.

Pure (no DB, no clock); fully unit-tested. **Advisory only** — nothing here
changes `decideStall` or reaping. This PR ships the functions + tests; wiring is
a separate reviewed step (§5).

## 5. Roadmap (deferred — each step gated on the prior's evidence)

1. **v1 — record-only.** A periodic step (reuse the watchdog cron or the metrics
   aggregator) queries recent `BuildPhaseRun` rows, computes the baseline, and
   records the calibration verdict per phase (a log line / small report row). No
   `decideStall` change. *Small, safe, reversible.*
2. **v2 — operator-facing (needs review).** Surface "phase X total-timeout looks
   too-tight (p95 Ys > Zs)" in the Build Studio stall-threshold admin so an
   operator can retune the seeded constant. Suggestion only — never auto-edit.
3. **v3 — statistical/learned (conditional).** ONLY if v1/v2 evidence shows fixed
   per-phase constants genuinely can't separate slow-but-progressing from dead.
   Prefer a deterministic rolling p95 baseline before any ML. **Re-descent
   criterion:** once the baseline stabilises, fold the tuned value back into the
   seeded threshold and retire the adaptive step.

## 6. Recommendation

- **Re-scope BI-A1FC3EBB** from "learned phase-duration anomaly detection" to
  "keep the crisp heartbeat boundary deterministic; calibrate the per-phase
  total-timeout against the observed distribution; ascend to statistical/learned
  only if that proves fuzzy." Update the BI body so it no longer implies a global
  fixed timeout or a mandatory learned step.
- Proceed to §5 v1 (record-only calibration) as the next watchdog increment.
- This is the second ascent BI (after the curator) found to be over-scoped toward
  "learned" when the boundary is crisp — worth promoting "test the boundary for
  fuzziness before ascending" toward a kernel principle.
