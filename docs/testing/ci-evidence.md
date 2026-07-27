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
- `--previous-observation path` — prior observation for flake history continuity
- `--timing-samples path` — phase timing samples

## Coverage commands (observation)

```bash
pnpm --filter web run test:coverage
pnpm --filter @dpf/db run test:coverage
```

Configs set `coverage.provider = "v8"`, explicit `coverage.include` patterns,
and `reportOnFailure: true` so owned files with zero tests still appear and
feed `unloadedOwnedFiles` in the observation schema. Vitest 4 removed the
older `coverage.all` option. Web includes `proxy.ts` and
`instrumentation.ts` as first-class production surfaces.

Coverage runs use the direct `@vitest/coverage-v8` development dependency in
both measured workspaces. The workflow lets a failed coverage or build step
continue only long enough to upload its diagnostic evidence; the final
completeness step still fails the calibration run when any required input is
unsuccessful.

## Standards grounding

- [Vitest coverage configuration](https://vitest.dev/config/coverage.html)
  defines `coverage.include` as the Vitest 4 mechanism for including
  unimported source files; `coverage.all` was removed.
- [Vitest reporters](https://vitest.dev/guide/reporters) define the JSON
  reporter used for per-file and per-test timing/outcome evidence.
- [Vitest CLI](https://v4.vitest.dev/guide/cli) defines `vitest related` as
  static-import-based test discovery. Dynamic or otherwise unmapped changes
  therefore fail safe to exhaustive execution in shadow evidence.
- [GitHub Actions cache](https://github.com/actions/cache) defines the granular
  `restore@v5` and `save@v5` actions used to measure transfer cost separately
  from downstream install/build duration.

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
