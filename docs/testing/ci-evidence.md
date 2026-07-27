# CI evidence efficiency — observation phase

**Status:** observation (non-blocking)  
**Spec:** [`docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md`](../superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md)  
**Plan:** [`docs/superpowers/plans/2026-07-26-ci-evidence-efficiency.md`](../superpowers/plans/2026-07-26-ci-evidence-efficiency.md)  
**Backlog:** BI-2F60FDCE (baselines), parent BI-E5A0C9A7

## What this phase does

Publishes **measurement only** so later PR-skipping and evidence reuse can be evidence-based:

| Signal | Purpose |
|--------|---------|
| Timing (p50/p90 by phase) | Critical-path and runner economics |
| V8 coverage (statements, branches, functions, lines) | Quantify owned production coverage, including **unloaded** files |
| Selection recall (shadow) | Prove affected-test selection never misses a full-suite failure before activation |
| Flake history | Suspect flaky tests without converting red → silent green |
| Cache economics | Hit rate, bytes, restore/save cost, net time saved |

It does **not**:

- skip tests on pull requests;
- change required checks (`Merge Readiness`, DCO, UX sweep, merge_group);
- invent coverage percentage gates (thresholds stay off until calibrated).

## Local library and CLI

```bash
# Unit tests for pure observation aggregators + config contracts
node --test \
  scripts/lib/ci-observation.test.mjs \
  scripts/lib/ci-coverage-config.test.mjs \
  scripts/ci-coverage-config.test.mjs \
  scripts/ci-observation.test.mjs \
  scripts/ci-shadow-selection.test.mjs

# Build an observation document (identity required)
node scripts/ci-observation.mjs \
  --tree-sha "$(git rev-parse HEAD)" \
  --event local \
  --run-id "manual-1" \
  --coverage web=apps/web/coverage/coverage-summary.json \
  --owned-root web=apps/web/lib \
  --output artifacts/ci-observation.json
```

Optional inputs:

- `--coverage <pkg>=path` — Vitest `coverage-summary.json` (repeatable)
- `--owned-root <pkg>=dir` — production source roots for unload inventory (repeatable)
- `--vitest <pkg>=path` — Vitest JSON reporter output (repeatable)
- `--shadow-selection path` — shadow selection JSON from `scripts/ci-shadow-selection.mjs`
- `--cache-samples path` — cache economics sample array
- `--previous path` — prior observation for flake history continuity

## Coverage commands (observation)

```bash
pnpm --filter web run test:coverage
pnpm --filter @dpf/db run test:coverage
```

Configs set `coverage.provider = "v8"`, `coverage.all = true`, and `reportOnFailure: true` so owned files with zero tests still appear (0% lines) and feed `unloadedOwnedFiles` in the observation schema. Web includes `proxy.ts` and `instrumentation.ts` as first-class production surfaces.

Coverage runs require `@vitest/coverage-v8` on the runner. The package is not yet a direct workspace dependency (lockfile peer graph needs a clean `pnpm regen:lockfile` intake); calibration treats coverage steps as best-effort (`continue-on-error`) so schema/timing/cache observation still publishes without it.

## Scheduled calibration

Workflow: `.github/workflows/ci-calibration.yml` (`CI Calibration`)

- Runs on a schedule (Mon/Thu 06:00 UTC) and `workflow_dispatch`
- Never runs on `pull_request` and is never a required merge check
- Executes observation unit tests, web + database coverage, shadow related-test comparison
- Measures exact-key cache economics for `pnpm-store` and `turbopack-build` (`actions/cache/restore@v5` + `actions/cache/save@v5`, no prefix `restore-keys` on Turbopack)
- Publishes a versioned observation artifact bound to the immutable tree SHA (`ci-observation`, 30-day retention)

## Activation gate (later waves)

Before any PR suite-skipping activates (BI-4527C1DA and dependents):

1. At least **two representative weeks** of calibration observation artifacts.
2. Selection shadow mode reports **100% observed failure recall** when failures exist (or only full-suite escalations).
3. Flake reporting does not hide red outcomes.

Until then, exhaustive PR and merge-group execution remains the default.

## Baseline snapshot

Checked-in seed report (structure only; metrics fill from calibration runs):

- [`docs/testing/ci-observation-baseline.json`](./ci-observation-baseline.json)

Update that file from calibration outputs when publishing a measured baseline (not invented percentages).
