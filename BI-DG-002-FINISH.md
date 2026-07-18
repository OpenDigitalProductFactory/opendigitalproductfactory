# BI-DG-002 — finish checklist (for a fresh, toolchain-enabled session)

**Delete this file before opening the PR** (it is a handoff artifact, not part of the deliverable).

## State at handoff
- Branch `feat/data-mgmt-gov-bi-dg-002`, based on `origin/main` (rebase onto current tip; was `b093ee384` at handoff).
- **10 pure spine modules + per-module tests already built + pushed** under `apps/web/lib/govern/data/`:
  `taxonomy.ts`, `assets.ts`, `processing-activities.ts`, `lifecycle-classes.ts`,
  `derived-data-contracts.ts`, `executable-policies.ts`, `policy-decision.ts` (PDP),
  `policy-enforcement.ts` (PEP matrix), `coverage.ts` (machinery), `legacy-coverage-baseline.ts` (type + EMPTY seed).
- Gated locally only by module-size + gitleaks. **NOT yet CI-verified** (prior session had no runtime) and **no PR yet**.
- BI-DG-002 live status = `in-progress`. BI-DG-001 shipped as PR #3192 (green, mergeable) with evidence recorded.

## Step 0 — rebase + verify the pure core
1. `git fetch origin && git rebase origin/main` on this branch.
2. Run the whole spine's tests + affected-package typecheck (now that the toolchain works):
   ```
   pnpm --filter web exec vitest run lib/govern/data
   pnpm --filter web typecheck
   ```
   Fix any type/test errors in the 10 modules (these were authored without a local checker).

## Step 1 — real 495-model coverage gate + generate/seal the legacy baseline
The machinery is done; wire it to live Prisma facts and seed the baseline **from the same parser** so denominators can't disagree.
- Parser: `parsePrismaSchema(sourceText: string): PrismaSchemaFacts` in
  `apps/web/lib/integrate/code-graph/extractors/prisma-schema-adapter.ts`.
  `PrismaSchemaFacts.models: PrismaModelFact[]`; `PrismaModelFact.fields: PrismaFieldFact[]`; `PrismaFieldFact.name`.
  Its shape already satisfies `SchemaModelFacts` in `coverage.ts` (`{ name, fields: {name}[] }`).
- **Generate the baseline** (one-time, committed): read `packages/db/prisma/schema.prisma`, `parsePrismaSchema` it,
  and for every model NOT in `DATA_ASSET_REGISTRY.byPrismaModel`, emit a `LegacyCoverageBaselineEntry`
  per field (owner, risk, `remediationBI` = the domain's coverage-wave BI e.g. `BI-DG-015`, a deadline).
  Write them into `legacy-coverage-baseline.ts` `LEGACY_COVERAGE_BASELINE.entries` and set `SEALED_BASELINE_COUNT`
  to the sealed length. Do NOT blanket-classify to make coverage green — every entry is a named, owned gap.
- **Wire the real-schema coverage test** (new `coverage.live.test.ts` or extend `coverage.test.ts`):
  read schema.prisma, `parsePrismaSchema`, `computeCoverage(models, DATA_ASSET_REGISTRY, LEGACY_COVERAGE_BASELINE)`,
  then `assertFullCoverage(report)` and `assertBaselineDidNotGrow(LEGACY_COVERAGE_BASELINE, SEALED_BASELINE_COUNT)`.
  It must pass green once the baseline is sealed, and FAIL if a new/changed model is neither registered nor baselined.
- Also generate the independent denominators the spec calls for beyond Prisma (projection producers, PEP entry
  points, destructive handlers, MDM domains) if in scope for this BI, or leave a note deferring the extra
  denominators to a follow-up — but Prisma coverage must be complete now.

## Step 2 — EA-mirror projection (no second ERD)
- File: `apps/web/lib/ea/data-model-mirror-apply.ts`. Model elements are built with a `properties` JSON bag
  (see `elementCreateData` / `desired.properties`). For each model that has a `DATA_ASSET_REGISTRY` entry,
  add logical asset/classification props (assetId, sensitivity, categories, domain, lifecycleClass, criticality,
  projectionClass, classification.state/source) onto the existing model element's `properties`. Do NOT create a
  new ERD/graph. Update `data-model-mirror-apply.test.ts` to assert the projected properties appear.

## Step 3 — per-BI completion gate (plan Task 2 + AGENTS.md §5)
- `pnpm --filter web exec vitest run lib/govern/data lib/ea/data-model-mirror-apply.test.ts` — all green.
- `pnpm --filter web typecheck` — zero errors.
- Claim `local-integration-ci` lease; run `pnpm --filter web build` there; no migration in this BI (record "no migration").
- `record_execution_evidence` against **BI-DG-002** (test_pass/build_pass + the coverage-gate result); release the lease.
- Secret scan + `pnpm pr:health`. Confirm module-size (`node scripts/check-module-size.mjs`) still green.

## Step 4 — open the PR
- Delete this file. DCO-signed commits (`git commit -s`). Overlap-sweep open PRs. Include a
  `Process-Spine-Decision:` trailer (spec/plan already on main via #3190). Open a regular (non-draft) PR,
  update BI-DG-002 status, and let CI gate.

## Notes / traps
- Commit trailer already used on this branch: `Process-Spine-Decision: implements approved data-governance spec/plan (PR #3190) …`.
- Module-size ratchet: any baselined file that grows needs a surgical single-line bump in `scripts/module-size-baseline.txt` (the gate counts +1 vs `wc -l`).
- Keep each `govern/data` module < 500 lines (spec decomposition rule); split with a decomposition note if needed.
- Next coverage wave after this BI is `BI-DG-015` (resolves the largest baseline domain); `BI-DG-003` (Data-Impact Gate) consumes this spine.
