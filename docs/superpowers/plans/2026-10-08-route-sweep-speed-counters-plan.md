---
status: active
---

# Deterministic speed counters in the UX route sweep: implementation plan

| Field | Value |
| --- | --- |
| Backlog item | `BI-BDB43823` |
| Workroom | `WC-9DFBDA1C` |
| Spec | [2026-10-08-route-sweep-speed-counters-design.md](../specs/2026-10-08-route-sweep-speed-counters-design.md) |
| Shape | atomic |

This plan is atomic. A counter reader with no admission gates nothing, and an admission with no reader has nothing to admit. The ratchet axis is only safe once admission has run, so the steps ship together.

## Backlog acceptance criteria (quoted from BI-BDB43823)

- "At least one counter is gated in CI, with a recorded test showing it moves with wall-clock time." This is covered by AC-2, AC-3 and AC-4 (steps 2–5).
- "Any rejected counters are listed with the reason." This is covered by AC-3 (step 4).
- "Running the sweep twice on the same SHA gives identical counter values." This is covered by AC-2 (step 2) and by the two-pass run in step 4.

## Steps (test first)

1. **Counter reader**: `apps/web/lib/ux-budget/speed-counters.ts`.
   - `readSpeedCounters(entries)` is a pure function over serialised Performance entries (resource, layout-shift and longtask). It returns `{ scriptBytes, requestCount, layoutShifts, longTasks }`.
   - The page-side collector is `collectSpeedEntries()`. It runs inside `page.evaluate` in the sweep's existing settle and uses buffered `PerformanceObserver` entries. No navigation is added.
   - Red first: `speed-counters.test.ts`.
2. **Admission maths**: `apps/web/lib/ux-budget/speed-counter-admission.ts`.
   - `spearman(xs, ys)`.
   - `admitCounters(passA, passB)`: repeatability across all routes, plus rho ≥ 0.5 against the median `navigationAndSettleMs`, with a reason for each counter.
   - Red first: a mismatch disqualifies, a monotone relationship admits, a flat counter is rejected, ties are handled.
3. **Sweep wiring**: `apps/web/scripts/ux-route-sweep.ts` calls the collector after the existing settle and stores the counters on `RouteMeasurement`.
4. **Admission run**: `apps/web/scripts/ux-speed-counter-admission.ts` (`pnpm --filter web ux:speed-admission`).
   - It runs the sweep measurement twice against one served build and writes `apps/web/lib/ux-budget/speed-counter-admission.json` with rho, n, the repeatability result and the reason.
   - The checked-in file comes from a real run against the dev install, recorded in the PR.
5. **Ratchet axes**: in `apps/web/lib/ux-budget/ratchet.ts`, admitted counters become `RATCHET_AXES` entries, with regression when the value is above the baseline.
   - Counters that are not admitted are never evaluated.
   - A missing baseline value is reported, not failed.
   - `freezeBaseline` writes `min(current, baseline)` for counter axes.
   - Red first: extend `ratchet.test.ts`.

## Traceability

| Requirement | Verification | Contract | Flow | Backlog item |
|---|---|---|---|---|
| OBJ-1 | AC-1 | readSpeedCounters | sweep settles a route | BI-BDB43823 |
| OBJ-2 | AC-2 | admitCounters | two-pass admission run | BI-BDB43823 |
| OBJ-2 | AC-3 | speed-counter-admission.json | two-pass admission run | BI-BDB43823 |
| OBJ-3 | AC-4 | evaluateSweep | PR sweep gates a route | BI-BDB43823 |
| OBJ-3 | AC-5 | freezeBaseline | baseline refresh | BI-BDB43823 |

## Risks and rollback

- **A noisy counter blocks PRs.** Only admitted counters gate, and admission requires identical values across two passes. Rollback: set a counter to `rejected` in the admission file, which is a one-line change.
- **Sweep time.** The counters are read from buffered entries in the existing page, with no extra navigation.
