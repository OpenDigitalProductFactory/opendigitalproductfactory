# October 3 dependency batch

Backlog: BI-0AE77798. Workroom: WC-A6BECCB3.

## Objective and acceptance

- Compatible updates from PRs #5991–#5996 are delivered through a DCO-signed replacement PR and the merge queue.
- Coupled package versions remain compatible; builds, affected tests, dependency inventories and security scans pass.
- Original PRs are closed only after their changes are delivered, or a specific incompatible upgrade is left explicitly tracked.

## Design and evidence

Reuse [dependency intake](../specs/2026-07-21-dependency-sovereignty-and-supply-chain-intake-hardening-design.md), especially Tier 0 and lockfile regeneration, and [dependency health](../../architecture/dependency-reduction-routine.md).

The operator selected consolidation over six separate repairs. This is one dependency graph and one revert. Inventory regeneration and compatibility repair are sequencing within that delivery, not independent features.

At source commit `96a9df71b3ec2c39d7df439c79a6f4ae76f50d85`, GitHub job `111180686148` fails on stale SBOM and one added duplicate. Job `111180685367` reports the unpatched mobile-only braces advisory `GHSA-vfj7-8cjw-p6xm`. At `d58971d3c91722a006927a42b888e8d7db3fb94e`, production job `111180951036` fails on missing Temporal imports. PR-body policy job `111180632143` identifies invisible characters in generated release notes. All six PRs lack local-CI receipts.

FullCalendar 7 requires source/API migration, not just matching package versions: [upstream migration](https://fullcalendar.io/docs/upgrading-from-v6-js). Vitest coverage must match its runner: [migration guide](https://main.vitest.dev/guide/migration/). Do not include either major upgrade without its required migration and functional proof; leave an incompatible upgrade explicitly tracked.

## Ordered work

1. Inspect each proposed manifest/lock change and its consumers. Apply compatible changes against `origin/main`; keep coupled families coherent. Paths: `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/web/package.json`, `packages/dpf-bootstrap/package.json`, and `scripts/probes/marketing-media/{package.json,pnpm-lock.yaml}`.
2. Regenerate the platform lock through `scripts/regen-lockfile.mjs` with an explicit changed-package allowlist. Review resolution scope and prove a stable second resolve. Avoid unintended duplicates. Reuse the exact reviewed probe lockfile when its manifest change is unchanged.
3. Investigate braces reachability through `apps/mobile/pnpm-lock.yaml`. Prefer a patched upstream release if available. A time-bounded acceptance in `sbom/vuln-baseline.json` is allowed only with concrete trusted-input-only exposure evidence under the existing vulnerability-baseline procedure. Do not hide a reachable vulnerability. Refresh `sbom/baseline.json` with the existing generator; justify any deliberate budget increase in its recorded diff.
4. Verify TOML bootstrap consumers, changed dependency consumers, source policy, SBOM drift/singletons, and the online high-severity scan. Run affected package typechecks/tests from the provisioned worktree, then the exhaustive governed local-CI gate and cloud CI. Production builds and served UI verification belong to the shared governed runtime. No new route, schema, migration, or operator behavior is intended; update contributor documentation only if the final repair changes it.
5. Publish the DCO-signed branch, open a ready PR, run `pnpm pr:health`, address review findings, and merge through `gh pr merge --squash --auto`. Verify the actual merge before closing superseded originals. Leave any undelivered major upgrade linked to its specific migration work.

## Verification contract

The scope-derived Workroom change-impact contract is resolved: no named testImpact or guardObligation entries; required derived artifacts are `sbom/baseline.json` and `apps/web/lib/docs/doc-index.generated.json`. This does not exempt exhaustive verification. Run `pnpm gate:context`, the dependency checks above, `pnpm run pregate:preflight`, `pnpm run pregate`, and `pnpm pr:health`.

## Risk and rollback

Library behavior or peer resolution may change even on a minor version. Do not merge a failing dependency graph. Roll back with a PR reverting the batch manifests, lockfiles and matching inventory together. This work never advances the live installation or changes gate enforcement.

## Backlog coverage

Atomic deliverable `dependency-batch` maps to BI-0AE77798, with no external deliverable dependency. Requirement reference: `Objective and acceptance`. Contract reference: `docs/architecture/dependency-reduction-routine.md`. Flow reference: `Ordered work`. Verification reference: `Verification contract`. The operator requested one compatible batch; all repair steps produce and validate that graph. Record governed coverage against this immutable plan before source implementation.
