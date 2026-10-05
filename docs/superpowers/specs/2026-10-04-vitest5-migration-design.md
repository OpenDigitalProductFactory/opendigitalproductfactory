---
status: active
---

# Vitest 5 runner and coverage migration

Backlog: BI-BB992B4D. Workroom: WC-2C7B34FA. One coordinated test-toolchain upgrade delivers Dependabot PR #5994.

## Existing contract and research

Reuse [dependency intake](2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md). At PR head `d8d0f63399e750073a81c5efab6c56e563fa459a`, `pnpm-workspace.yaml` proposes coverage `^5.0.1` while retaining runner `^4.1.11`. An executed strict equality assertion fails. Published coverage 5.0.1 requires runner exactly 5.0.1; updating only the provider cannot establish coverage compatibility.

At main `502a71f3ada1cefbbdf6f945be237ed4e410f273`, the catalog controls every runner consumer. Existing web/db configs use forks, explicit coverage file globs, and observation-only coverage with no numeric thresholds. The executed TypeScript AST scan of 4,702 tracked test/spec files found no nested `vi.mock`, `vi.unmock`, or `vi.hoisted` calls. Both configs have no inline projects. CI uses Node 24; Vite resolves to 8.2.1, both supported by v5.

[Upstream migration](https://main.vitest.dev/guide/migration/) identifies changed mock clearing, assertion awaiting, project inheritance, coverage pattern matching and removed APIs. Preserve established assertions and owned-file coverage visibility; repair actual incompatibilities without deleting tests or suppressing failures. Explicitly retain the v4 mock-history default where existing configuration depends on it. Existing tests without configs must still pass under v5 defaults.

## Acceptance

The live item states:

- All runner/coverage family dependencies resolve compatibly under the approved lockfile generator with a stable second resolve.
- Existing test semantics remain intact; exercise real coverage generation, thresholds and representative mocks before the full suite.
- Typechecks, exhaustive governed test/build gates and cloud CI pass without hiding failures.
- Merge through a DCO-signed PR and close https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/5994 only after delivery.

## Ordered implementation

1. Update both catalog entries together to 5.0.1. Regenerate `pnpm-lock.yaml` with the approved fresh-store generator and a reviewed package allowlist derived from published package metadata; prove a stable second resolve. Refresh the SBOM shape only for explained dependency changes.
2. Check `apps/web/vitest.config.ts` and `packages/db/vitest.config.ts` against v5 behavior. Preserve configured coverage includes, excludes, reports, and failure reporting. Resolve colocated config tests and graph-linked test advice; absent/stale advice means exhaustive verification. No guard obligations were returned by the claimed impact contract.
3. Exercise real v8 coverage with the application config on representative pure functions and mocks. Inspect JSON output for included source and excluded tests. Use a temporary isolated fixture to prove an unmet numeric threshold fails, then full exercised coverage passes; this does not add a threshold to observation-only application coverage. Run package and web tests, both typechecks, governed merged-code CI and production build. Compare discovered/passed/skipped totals and investigate differences.
4. Record independent semantic review on the immutable tested commit, publish a ready PR with DCO and required documentation trailers, verify all cloud checks, and merge through the protected queue. Close #5994 only after the upgrade is reachable from main.

## Delivery boundary and backlog coverage

Atomic deliverable `vitest5-toolchain` maps to BI-BB992B4D with no dependencies. Runner, provider, config compatibility and verification are one revert: none is useful independently. Requirement reference: `Acceptance`. Contract reference: `Existing contract and research`. Flow reference: `Ordered implementation`. Verification reference: `Verification and rollback`. Coverage receipt `cmuu21vb100bj01r7m94va8nk` binds atomic deliverable `vitest5-toolchain` to BI-BB992B4D, with no dependencies, at commit `c0570df7a80a119e798a5f0d5bd6934240bbabe3`, blob `0172773e1d268d1125b85420a1667afcaa479df5`. This work excludes FullCalendar 7, which belongs to BI-89604587.

## Verification and rollback

Run catalog version coherence, stable lock regeneration, SBOM/singleton and supply-chain guards, actual coverage generation and threshold smoke, affected config/mock tests, both typechecks, exhaustive local CI, production build, PR health and protected merge queue. Existing skips stay explicit. Infrastructure refusal is unrun, never passed. The current application coverage contract is observation-only; this upgrade must not invent lower thresholds or drop owned source files. If a regression cannot be repaired, retain the old runner/provider pair and leave the PR open with evidence. After merge, revert the coordinated manifests, lock and config through a DCO-signed PR if required. No runtime deployment is part of this migration.

## Executed compatibility probes

The requested `^5.0.1` catalog range resolves the coherent runner/provider family to 5.0.3. Reviewed dependency changes are limited to the toolchain and its transitives, with a stable second fresh-store resolve. Total components fall from 891 to 879; an additional `magic-string` major is required by Vitest versus Tailwind's incompatible 0.30.x range, recorded in the inventory baseline.

The actual v8 provider produced 100% statement, branch, function and line coverage for `format-retention-minimum.ts` using the application config. JSON contained the source file and excluded its test. A deliberately partial run produced 45.45% line coverage and exited 1 against a 100% threshold; the complete nine-test run met the same threshold and exited 0. Four representative web/config/component files passed 16 tests; the database discovery-config guard passed two tests. These focused probes do not replace the required exhaustive gate. Existing configuration has not been relaxed.
