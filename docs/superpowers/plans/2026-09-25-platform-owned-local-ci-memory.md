---
status: active
backlog: BI-903FB5F9
spec: docs/superpowers/specs/2026-09-25-platform-owned-local-ci-memory-design.md
workroom: WC-0D5C770A
---

# Plan: platform-owned local-CI memory, slice A (self-updating builder reserve and cache-drop guard)

This slice builds on BI-D3BF53A9 (#5708), which measures the builder peak on
every gate and checks in a hand-measured reserve. It ships on branch
`feat/platform-owned-vm-reclaim`. Slices B, C and D follow as separate PRs.

## Deliverables

1. **persist-calibration.**
   - `apps/web/lib/nonprod/local-ci-builder-memory-calibration.ts` owns the
     `local_ci.builder_memory_calibration` PlatformConfig row.
   - `recordLocalIntegrationResult` folds each leased gate's measured peak into
     it, under the circuit breaker's optimistic-concurrency loop.
   - It records `builderMemoryCalibration` on the evidence. The fold is
     best-effort.
2. **measured-admission.**
   - `measuredBuilderReserve` computes the reserve (the rules are in the design).
   - `resolveNonprodPoolPolicy` passes it to `resolveLocalCiPoolPolicy` as
     `builderReserveBytes` and returns `builderReserve`.
3. **cache-drop-guard.**
   - `scripts/check-no-manual-vm-cache-drop.mjs` and its self-test, inventoried
     in `scripts/lib/ci-policy-guards.mjs`.
   - `docs/testing/pre-pr-gate.md` explains the self-updating reserve.

## Traceability

Requirements are the design's OBJ lines; verification is its AC rows.

| Deliverable | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|
| persist-calibration | OBJ-2 | contract-builder-memory-calibration-row | flow-gate-result-to-calibration | AC-2 |
| measured-admission | OBJ-1, OBJ-2 | contract-pool-policy-builder-reserve | flow-claim-to-admission-decision | AC-3, AC-4, AC-5 |
| cache-drop-guard | OBJ-3 | contract-repo-guard-loop | flow-guard-loop-to-refusal | AC-7 |

- contract-builder-memory-calibration-row: PlatformConfig key
  `local_ci.builder_memory_calibration`, with value
  `{ schemaVersion: 1, ceilingBytes, samples[{ peakBytes, oomKills, observedAt }] }`.
- contract-pool-policy-builder-reserve: `ResolvedLocalCiPoolPolicy.builderReserve`
  `{ bytes, source, reason, sampleCount }`, plus the `builderReserveBytes` input
  of `resolveLocalCiPoolPolicy`.
- contract-repo-guard-loop: `scripts/check-no-*.mjs`, exit 0 when clean and
  non-zero on a violation.
- flow-gate-result-to-calibration: `record_local_integration_result` →
  `recordLocalIntegrationResult` → `recordLocalCiBuilderMemorySample` →
  PlatformConfig.
- flow-claim-to-admission-decision: `claim_nonprod_environment_lease` →
  `resolveNonprodPoolPolicy` → `measuredBuilderReserve` →
  `resolveLocalCiPoolPolicy`.
- flow-guard-loop-to-refusal: `node scripts/check-guards.mjs` → guard → refusal
  naming the file and line.

## Verification

- **AC-2, AC-3, AC-4:** `vitest run lib/nonprod/local-ci-builder-memory-calibration.test.ts lib/nonprod/local-integration.test.ts`
- **AC-5:** `vitest run lib/nonprod/environment-lease-pool-policy.test.ts`. This
  replays the recorded 2026-09-24 closure: 19.89 GiB VM with a 4 GiB floor.
- **AC-7:** `node --test scripts/check-no-manual-vm-cache-drop.test.mjs`, then
  `node scripts/check-no-manual-vm-cache-drop.mjs`.
- **Live:** after the install upgrades past this change, the calibration row
  grows by one sample per leased gate. After 5 runs, admission reports
  `builderReserve.source: "measured"`.

## Verification results (recorded)

- **2026-09-26 02:17Z:** local-CI gate PASS at `52fc76b`.
- Locally:
  - `lib/nonprod` vitest: 162 passed.
  - Node suites for the pool policy, pool-closed line, pregate status and the guard: 79 passed.
  - Repo guard loop: 46 guards passed.
  - Pre-gate preflight: clean.
- **Design review:** design-spec receipt `initiative-1291b38c-adff-4a51-a8fb-8ccaea9629da`; spec-approval passed, minting `baseline-7dbd8fe2-f384-4947-8eac-3e76db2717a9`.
- **Architecture review:** it was dispatched before the baseline existed, so its request key was bound to a superseded packet (BI-D3E1F6D9). It is re-requested at the next head.

## Rollback

Revert the PR, or delete the `local_ci.builder_memory_calibration` row. Either
way, admission uses the checked-in calibration exactly as #5708 left it.
