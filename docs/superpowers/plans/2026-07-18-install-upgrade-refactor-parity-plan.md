# Install and Self-Upgrade Refactor Parity Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-18-install-upgrade-refactor-parity-design.md`  
**Branch:** `fix/install-upgrade-refactor-parity`  
**Delivery:** one ready PR against `main`; each task ends green and in a DCO-signed commit

## Task 1: Lifecycle inventory and retired-runtime guard

**Files:** create `scripts/lifecycle-surface-policy.mjs`, `scripts/lifecycle-surface-policy.test.mjs`; update `package.json`.

- [ ] Write table-driven tests enumerating exact active lifecycle files, forbidden operational Neo4j/Qdrant patterns, exact legacy exceptions with reason/source floor/removal milestone, promoter COPY derivation, and required host-state wiring.
- [ ] Run `node --test scripts/lifecycle-surface-policy.test.mjs`; expect named failures for every currently audited active reference.
- [ ] Implement scanning, exact line/pattern exceptions, duplicate/stale-exception detection, and actionable output. Do not weaken expected violations.
- [ ] Temporarily mark audited violations as `expectedRemediation` entries so the task can finish green; require each entry to match exactly once and make Tasks 2–3 delete them.
- [ ] Run the test; expect all policy mechanics green with a printed remediation count.
- [ ] Commit: `test: enforce lifecycle refactor parity` with `git commit -s`.

## Task 2: Cross-platform lifecycle behavior fixtures

**Files:** create `tests/install/lifecycle-parity.test.mjs`, `tests/install/fixtures/fake-docker.mjs`, `tests/install/fixtures/assert-safe-sandbox.mjs`; update `tests/release/installer-release-contract.test.mjs`.

- [ ] Add fixture self-tests for argv capture and resolved-path containment. The fake Docker permits simulated non-destructive `dpf` install/start/config commands when every bind/data path is inside the temporary harness, but refuses destructive `down --volumes`, removal, or cleanup for project `dpf`; all destructive commands must use a unique `dpf-test-<nonce>` project and fixture-contained paths. It always refuses real root/home/canonical paths or paths outside the fixture.
- [ ] On Windows run the PowerShell entrypoints through `powershell.exe -Version 5.1` semantics; on Linux/macOS run Bash entrypoints with `bash`. Fixtures stub network/process dependencies but execute real branching/state logic.
- [ ] Keep Task 2 limited to green harness self-tests: command capture, allowed simulated production start, refused production destructive cleanup, allowed isolated destructive cleanup, and path-containment failures.
- [ ] Run `node --test --test-name-pattern="fixture safety" tests/install/lifecycle-parity.test.mjs`; expect all fixture self-tests green.
- [ ] Commit: `test: add safe install lifecycle harness`.

## Task 3: Repair lifecycle parity and current documentation

**Files:** update `AGENTS.md`, `install-dpf.ps1`, `install-dpf.sh`, `dpf-reinstall.ps1`, `dpf-reinstall.sh`, `uninstall-dpf.ps1`, `uninstall-dpf.sh`, `scripts/fresh-install.ps1`, `scripts/setup.sh`, `scripts/installer/lib/doctor.sh`, `scripts/verify-install-windows.ps1`, `scripts/verify-install-edge.sh`, `.github/workflows/release-gates.yml`, `package.json`, `packages/db/package.json`; update `apps/web/app/api/diagnostics/preflight/route.ts`; create `apps/web/app/api/diagnostics/preflight/route.test.ts`; update `docs/user-guide/getting-started/developer-setup.md`, `docs/user-guide/getting-started/dev-container.md`, `docs/user-guide/operations/infrastructure-discovery.md`, and `docs/user-guide/ai-workforce/decision-perspective.md`.

- [ ] Extend `tests/install/lifecycle-parity.test.mjs` with the real product behavior assertions: production install, contributor setup, reinstall, uninstall, and diagnostics; run it and expect named failures before editing product scripts.
- [ ] Add `route.test.ts` to prove no retired health probe, collection lookup, restart action, credential, service, or volume advice is emitted; run `pnpm --filter web exec vitest run apps/web/app/api/diagnostics/preflight/route.test.ts` and confirm it fails before implementation.
- [ ] Remove the Qdrant diagnostic import/check and all enumerated stale operational claims/commands/environment variables.
- [ ] Route installer completion through the existing `scripts/installer/validate-install-state` contract and assert the resolved host state path is the one Compose exposes to portal/promoter.
- [ ] Preserve narrowly allowlisted decommission/migration code and label it with the supported-source floor/removal milestone.
- [ ] Delete every `expectedRemediation` entry from Task 1; do not convert it to a legacy exception.
- [ ] Run `node --test scripts/lifecycle-surface-policy.test.mjs tests/install/lifecycle-parity.test.mjs tests/release/installer-release-contract.test.mjs scripts/installer/validate-install-state.test.mjs`; expect zero remediations and all tests green.
- [ ] Run `bash -n install-dpf.sh uninstall-dpf.sh dpf-reinstall.sh scripts/setup.sh scripts/verify-install-edge.sh scripts/installer/lib/*.sh` and `shellcheck --shell=bash --severity=error install-dpf.sh uninstall-dpf.sh dpf-start.sh dpf-stop.sh dpf-reinstall.sh dpf-release.sh scripts/setup.sh scripts/verify-install-edge.sh scripts/installer/lib/*.sh`; expect exit 0.
- [ ] Run `powershell.exe -NoProfile -Command "$e=$null; Get-ChildItem install-dpf.ps1,dpf-reinstall.ps1,uninstall-dpf.ps1,scripts/fresh-install.ps1,scripts/verify-install-windows.ps1 | ForEach-Object { [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$null,[ref]$e); if($e){$e; exit 1} }"`; expect exit 0, then run the Windows cases in `node --test tests/install/lifecycle-parity.test.mjs`; expect green.
- [ ] Commit: `fix: align install lifecycle with current architecture`.

## Task 4: Candidate promoter contract, OCI identity, and protocol floor

**Files:** create `promoter-contract.schema.json`, `promoter-contract.json`, `scripts/promoter-contract.test.mjs`; update `Dockerfile.promoter`, `scripts/promoter-build-context.test.mjs`, `apps/web/lib/self-upgrade/config.ts` and tests, `apps/web/lib/self-upgrade/promoter.ts` and tests.

- [ ] Write failing tests for schema v1, caller protocol min/max, candidate source SHA, contract digest, required mounts/env/entrypoint, Dockerfile COPY completeness, and OCI labels.
- [ ] Write failing resolver tests for target-SHA tag lookup, one tag-to-digest resolution, source-SHA mismatch, missing/unknown schema, old/new unsupported schema, caller-range mismatch, contract/label digest mismatch, and tag replacement after resolution.
- [ ] Add checked-in schema/manifest, build args/OCI labels, protocol version/floor constants, a Docker inspect/pull resolver, and a typed resolved artifact containing only the immutable digest used thereafter.
- [ ] Add explicit `legacy-bootstrap` classification and readiness owner (`bridge`, `portal`, or `unavailable`) to configuration/evidence types without adding a DB migration.
- [ ] Run `node --test scripts/promoter-contract.test.mjs scripts/promoter-build-context.test.mjs` and `pnpm --filter web exec vitest run apps/web/lib/self-upgrade/config.test.ts apps/web/lib/self-upgrade/promoter.test.ts`; expect green.
- [ ] Run `docker build -f Dockerfile.promoter -t dpf-promoter-contract:test .`, then `docker image inspect dpf-promoter-contract:test --format '{{json .Config.Labels}}'` and `docker run --rm --entrypoint sh dpf-promoter-contract:test -c 'test -r /app/promoter-contract.json'`; expect source/schema/digest labels and readable embedded manifest. The contract test recomputes the manifest digest and compares it with the inspected label.
- [ ] Commit: `feat: bind upgrades to candidate promoter artifacts`.

## Task 5: Pre-drain readiness and merge-preserving evidence

**Files:** update `scripts/promote.sh`; create `scripts/promoter-readiness.test.mjs`; update `apps/web/lib/self-upgrade/promoter.ts`, `promoter.test.ts`, `run-store.ts`, `run-store.test.ts`, `apps/web/lib/queue/functions/self-upgrade.ts`, and `self-upgrade.test.ts`.

- [ ] Add shell integration cases that independently fail entrypoint/files, Docker access, source mount, state mount/JSON, capability projection, Compose identity, and secret/recovery parents; assert deterministic ephemeral cleanup and no portal/database/installation mutation.
- [ ] Add Vitest cases for redaction, size/message/history caps, `completionEvidence.readiness` read/merge/write preservation, retry replacement, `stage: preflight`, and readiness-owner semantics.
- [ ] Add orchestration-order tests: isolated target preparation → digest resolution → readiness → evidence → quiescence → recovery → same-digest promotion. Every readiness failure must assert `startQuiescence`, recovery, and promotion were not called.
- [ ] Add post-quiescence failure regression proving governed rollback/recovery evidence remains preserved.
- [ ] Implement `--readiness`, `runPromoterReadiness`, report validation/redaction, merge-preserving storage, and fail-before-quiescence orchestration.
- [ ] Run `node --test scripts/promoter-readiness.test.mjs` and `pnpm --filter web exec vitest run apps/web/lib/self-upgrade/promoter.test.ts apps/web/lib/self-upgrade/run-store.test.ts apps/web/lib/queue/functions/self-upgrade.test.ts`; expect all dependency-failure, evidence, rollback, and ordering cases green.
- [ ] Commit: `feat: fail self-upgrade before drain when promoter is unready`.

## Task 6: Operator-visible legacy/readiness disclosure

**Files:** update `apps/web/components/ops/SelfUpgradeClient.tsx`, `apps/web/components/ops/SelfUpgradeClient.test.tsx`, `apps/web/components/ops/SelfUpgradePanel.tsx`, `apps/web/app/(shell)/ops/self-upgrade/page.tsx`, `apps/web/app/(shell)/ops/self-upgrade/page.test.tsx`, and `apps/web/lib/actions/promotions.ts` plus `apps/web/lib/actions/promotions.self-upgrade.test.ts`.

- [ ] Add failing component tests for portal-owned readiness success, actionable preflight failure, bridge-owned introduction evidence, and production `legacy-bootstrap`/readiness-unavailable disclosure.
- [ ] Render readiness owner, contract version/digest abbreviation, pre-drain result, and redacted remediation. Never label a pre-floor run readiness-validated.
- [ ] Run `pnpm --filter web exec vitest run apps/web/components/ops/SelfUpgradeClient.test.tsx 'apps/web/app/(shell)/ops/self-upgrade/page.test.tsx' apps/web/lib/actions/promotions.self-upgrade.test.ts` and verify `/ops/self-upgrade` against the served candidate in the governed local-CI environment.
- [ ] Capture UX evidence for both ready and legacy-bootstrap states.
- [ ] Commit: `feat: disclose self-upgrade readiness ownership`.

## Task 7: Safe compatibility acceptance harness

**Files:** create `scripts/self-upgrade-sensitive-paths.mjs`, `scripts/self-upgrade-sensitive-paths.test.mjs`, `scripts/test-n-minus-one-upgrade.mjs`, `scripts/test-n-minus-one-upgrade.test.mjs`, `.github/workflows/self-upgrade-acceptance.yml`; update lifecycle policy cross-checks.

- [ ] Classifier tests enumerate promoter, self-upgrade, Compose/state, installers, capabilities, manifest/schema, workflow, and harness paths; cross-check policy ownership so renames fail closed.
- [ ] Unit-test GitHub API behavior using `GITHUB_TOKEN`: exact PR base SHA, membership on `main`, explicit required check names/conclusions, pagination, authentication/error handling, and fail-not-skip behavior.
- [ ] Unit-test harness safety: mktemp-only source/state/backups, unique non-`dpf` Compose project, resolved-path containment, no canonical volumes, signal/EXIT cleanup, and refusal of root/home/unresolved targets.
- [ ] Implement baseline checkout/build labelled with verified base SHA, candidate promoter build labelled with candidate SHA/contract digest, digest inspection, isolated baseline boot, API upgrade trigger, and bounded polling.
- [ ] Assert candidate digest performed readiness/promotion, health/version equals candidate, install state migrated, recovery evidence exists, and portal remains healthy. Inject readiness failure and assert the API upgrade request is never sent.
- [ ] Support introduction bridge mode only when base is pre-floor; post-floor mode requires portal-owned readiness.
- [ ] Workflow: path-sensitive PR job plus nightly schedule, least-privilege `contents: read`, `checks: read`, `packages: read`, 30-day evidence/log retention, explicit timeouts, and always-run safe cleanup.
- [ ] Run `node --test scripts/self-upgrade-sensitive-paths.test.mjs scripts/test-n-minus-one-upgrade.test.mjs`; expect green.
- [ ] In isolated CI, build the candidate promoter with source-SHA and contract-digest labels, run its real readiness entrypoint with production-shaped source/state/socket mounts, and retain immutable artifact evidence. Run again with malformed canonical state; require exit 78, `quiescenceBegan=false`, and no root `dpf` resources. Do not claim portal-to-portal N-1 evidence because the repository has no supported harness control/evidence API.
- [ ] Commit: `ci: require promoter compatibility acceptance`.

## Task 8: Full verification, review, and PR

- [ ] `git diff --check`; `pnpm security:secrets`.
- [ ] Run `node --test scripts/lifecycle-surface-policy.test.mjs scripts/promoter-contract.test.mjs scripts/promoter-build-context.test.mjs scripts/promoter-readiness.test.mjs scripts/self-upgrade-sensitive-paths.test.mjs scripts/test-n-minus-one-upgrade.test.mjs tests/install/lifecycle-parity.test.mjs tests/release/installer-release-contract.test.mjs scripts/installer/validate-install-state.test.mjs`.
- [ ] Run `pnpm --filter web exec vitest run apps/web/app/api/diagnostics/preflight/route.test.ts apps/web/lib/self-upgrade/config.test.ts apps/web/lib/self-upgrade/promoter.test.ts apps/web/lib/self-upgrade/run-store.test.ts apps/web/lib/queue/functions/self-upgrade.test.ts apps/web/components/ops/SelfUpgradeClient.test.tsx 'apps/web/app/(shell)/ops/self-upgrade/page.test.tsx' apps/web/lib/actions/promotions.self-upgrade.test.ts`.
- [ ] Re-run the exact Bash, ShellCheck, PowerShell parser, and lifecycle commands from Task 3; expect exit 0.
- [ ] Run `pnpm --filter web typecheck`.
- [ ] Lease `local-integration-ci`; run `NODE_ENV=production pnpm --filter web build`, `node --test scripts/promoter-readiness.test.mjs`, and `node scripts/test-n-minus-one-upgrade.mjs --base-sha "$DPF_N_MINUS_ONE_BASE_SHA" --candidate-sha "$DPF_CANDIDATE_SHA" --repository "OpenDigitalProductFactory/opendigitalproductfactory" --project "dpf-n1-local-$DPF_CANDIDATE_SHA" --evidence-dir "$DPF_N1_EVIDENCE_DIR"`. Required environment: write-scoped lease credentials supplied by the sandbox, `GITHUB_TOKEN`, verified `DPF_N_MINUS_ONE_BASE_SHA`, current `DPF_CANDIDATE_SHA`, and a fixture-contained `DPF_N1_EVIDENCE_DIR`. Expect build success, readiness success, candidate health/state/recovery evidence, and safe cleanup. Verify `/ops/self-upgrade` ready and legacy-bootstrap fixtures in the served portal and capture screenshots/log evidence. An unavailable lease is unrun, never green.
- [ ] Request independent code review, fix all blockers, and rerun affected gates.
- [ ] Push every signed commit, open a non-draft ready PR, monitor all required and merge-group checks, and resolve failures.

## Stop conditions

- Never clean project `dpf`, a root/home/canonical path, or unresolved data.
- Never claim candidate readiness when a pre-floor portal could not enforce it.
- Never launch a mutable tag after readiness; launch the inspected immutable digest.
- Retained compatibility code requires exact supported-source floor and removal milestone.
