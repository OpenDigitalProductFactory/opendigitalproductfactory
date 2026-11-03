# Repository security remediation

Parent: BI-2422A366. Dependency delivery: BI-1D8EC7F7.
Design: ../specs/2026-11-02-repository-security-intake-repair.md, OBJ-2 / AC-4.
Workroom: WC-3BB460F8. Status: planned; implementation coverage receipt pending.

## Delivery mapping

| Key | Backlog | Requirement | Independently shippable | Verification |
| --- | --- | --- | --- | --- |
| intake | BI-2422A366 | AC-1, AC-2, AC-3 | yes | Canonical first and repeated scans, source identities and issue snapshots |
| dependencies | BI-1D8EC7F7 | AC-1, AC-2, AC-3; parent AC-4 | yes | Scoped locks, consumer checks, typechecks, governed integration, upstream alert closure |

The dependency delivery depends on intake verification for publication, while
source preparation may proceed during the approved intake deployment. Manual
filing of either delivery item never establishes automatic alert coverage.

## Ordered implementation

1. Verify the deployed intake revision, run the commissioned scan and repeat it.
   Preserve all six per-alert source identities and unchanged occurrence counts.
2. Add provenance-tagged scoped floors in root and mobile pnpm-workspace.yaml:
   glob below 14.0.2 to 14.0.2 (GHSA-3g3m-2fjr-6pw4, alerts254/256), minimatch
   below11.0.1 to11.0.1 (GHSA-g3hv-75wg-m249, alerts255/257).
3. Run scripts/regen-lockfile.mjs in each workspace using fresh metadata.
   Allow only glob, minimatch and their justified direct dependency changes;
   inspect and resolve any drift. Preserve release-age and build-script policy.
4. Use managed workspace installs. Reproduce the old brace-expansion failure,
   then verify root rimraf sync/async deletion preserves nonmatches; glob arrays,
   brace matching and negation; Expo config and fingerprint consumers; mobile
   Jest and coverage discovery. Inspect consumers for removed makeRe usage.
5. Run affected typechecks and mobile tests, provenance/SBOM guards, then the
   canonical integration gate and independent exact-change review. Update only
   derived artifacts required by the scoped dependency change. Never widen
   vulnerability exceptions or component budgets just to pass a gate.
6. Publish a DCO-signed PR through the protected queue, verify upstream closure
   for254–257, and attach delivery to the automatically captured alert records.
7. Under the parent, separately reconcile232/238 with the authoritative rejected
   CVE records and still-open GitHub advisories. Record the discrepancy and
   justified disposition; do not claim they were fixed by these version floors.

## Failure boundaries

Stop publication for a credential/read failure, unproven automatic intake,
unexplained lock drift, consumer regression or failed verification. Keep source
failure visible; never replace a failing actual-workspace result with an isolated
fixture result. No runtime/database writes, credential changes, emergency upgrade,
or direct-main publication are part of this plan. No schema migration is needed.

## Acceptance quoted from BI-1D8EC7F7

- AC-1: Both lockfiles contain no glob/minimatch versions affected by these four alerts, and no unrelated version drift.
- AC-2: Actual root rimraf, mobile Expo and test/coverage consumers pass compatibility checks and affected typechecks/tests; brace patterns no longer throw.
- AC-3: Reviewed source passes the governed gate and merge queue; upstream four alerts close and link to their automatic backlog records.
