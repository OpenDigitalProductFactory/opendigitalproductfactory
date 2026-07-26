# CI Evidence Efficiency Implementation Plan

- **Status:** ready for implementation
- **Date:** 2026-07-26
- **Backlog item:** `BI-E5A0C9A7`
- **Architecture:** `docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md`
- **WWMD decision:** `DI-907601218462`
- **Work Capsule:** `WC-63ADA68A`
- **Backlog coverage receipt:** `cms2f1hjw0c0t01qo29b2w0q8`

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Reduce CI feedback time and GitHub runner consumption without reducing evidence quality:

- safely classifiable pull requests reach required feedback in no more than 5 minutes p90;
- exhaustive merge-group evidence reaches no more than 8 minutes p90;
- representative pull-request runner-minutes fall at least 40% from the measured 65.7-minute
  baseline;
- affected-test selection demonstrates 100% observed failure recall before it skips work;
- every exact integration tree still earns all applicable DPF build gates before reaching `main`;
- full web and database coverage reports statements, branches, functions, lines, and unloaded owned
  source files;
- unknown, stale, mismatched, or incomplete evidence always expands to exhaustive execution.

The work changes evidence scheduling and reuse, not the quality contract. `Merge Readiness`, `UX
Route Budget Sweep`, DCO, `merge_group`, the local pregate record, and the shared local-CI sandbox
remain authoritative.

## Current prerequisite

The deterministic prompt-template isolation defect is tracked separately as `BI-3D96B563`.
PR #3624 is the sole delivery path at `d013b50ef2`, with local-CI evidence
`cms2euxzo0bon01qownexluy0`. Do not create a competing branch or PR. Its merge unblocks reliable
full-suite observation but is not one of this plan's implementation deliverables.

## Existing substrate to extend

| Concern | Existing source of truth | Constraint |
| --- | --- | --- |
| CI fan-out and aggregate | `.github/workflows/ci.yml` | Keep stable `Merge Readiness`; preserve exhaustive `merge_group` |
| UX evidence | `.github/workflows/ux-route-sweep.yml`, `apps/web/scripts/ux-route-sweep.ts` | Keep full inventory; measurement is not functional UX acceptance |
| Change classification | `scripts/ci-change-scope.mjs` | Replace duplicated rules only through parity tests |
| Merge authority | `config/merge-readiness-policy.json`, `scripts/merge-readiness-policy.mjs` | Do not create a competing required-check list |
| Local pregate | `scripts/pregate.mjs`, `scripts/gate-worktree.mjs`, `scripts/lib/local-integration-ci.mjs` | Exact branch/SHA evidence and lease workflow remain binding |
| Sandbox freshness | `scripts/sandbox-freshness-preflight.mjs` | Drift is `blocked_sandbox_drift`, never a product red |
| Code graph | `apps/web/lib/integrate/code-graph-access.ts`, `apps/web/lib/integrate/code-graph/graph-queries.ts` | Advice is eligible only when graph freshness passes |
| Test runner | `apps/web/vitest.config.ts`, workspace package scripts | Coverage must explicitly include unloaded owned files |
| Turbopack cache safety | `scripts/check-ci-build-cache.test.mjs` | Never add a broad Turbopack restore key |
| GitHub evidence | CheckRun/CheckSuite plus workflow artifacts | Do not fabricate DPF `ToolExecutionReceipt` rows |

## Delivery topology

Implementation proceeds in dependency waves. Work within a wave may proceed independently after
its prerequisites are merged.

| Wave | Deliverable | Backlog item | Depends on |
| ---: | --- | --- | --- |
| 1 | Observation baselines | `BI-2F60FDCE` | none |
| 1 | Route-sweep determinism | `BI-EA221325` | none |
| 1 | Windows local-CI timeouts | `BI-72AEDE8B` | none |
| 2 | Delivery-loop resilience | `BI-C22152E7` | Windows local-CI timeouts |
| 2 | Evidence-planner shadow mode | `BI-A4EC0EA6` | Observation baselines |
| 3 | Source-only pregate | `BI-7FB50D1B` | Delivery-loop resilience |
| 3 | Duplicate-execution refactor | `BI-4DB73C5E` | Observation baselines, route-sweep determinism, Windows local-CI timeouts |
| 4 | Affected-PR activation | `BI-4527C1DA` | Observation baselines, evidence planner, duplicate refactor, route-sweep determinism |
| 5 | Exact-tree reuse | `BI-9585E580` | Observation baselines, evidence planner, affected-PR activation |

## Deliverable 1: Observation baselines (`BI-2F60FDCE`)

### Concrete result

Create the non-blocking measurement layer required to make later optimization evidence-based:

- per-workflow/job/setup/test/build/cache timing with event and immutable tree identity;
- authoritative V8 coverage for web and database packages, including unloaded owned files;
- shadow affected-test and route selection compared with exhaustive results;
- selection recall, selected percentage, avoided-time estimate, and unknown-expansion rate;
- flaky-test history that never converts a red result into a silent green;
- cache hit rate, bytes, restore/save time, and downstream time saved;
- a checked-in baseline report and a scheduled calibration workflow.

### Files

- modify `.github/workflows/ci.yml`
- create `.github/workflows/ci-calibration.yml`
- modify `apps/web/vitest.config.ts`
- modify `apps/web/package.json`
- modify `packages/db/package.json`
- create `scripts/lib/ci-observation.mjs`
- create `scripts/lib/ci-observation.test.mjs`
- create `scripts/ci-observation.mjs`
- create `docs/testing/ci-evidence.md`
- update `pnpm-lock.yaml` only if an explicit coverage dependency is not already available

### Red-green sequence

1. Add failing tests for timing normalization, exact tree/event identity, incomplete observation
   rejection, cache economics, flaky-history classification, and selection-recall calculation.
2. Add a failing coverage-configuration test proving an owned production file that no test imports
   still appears in the report.
3. Implement a versioned observation schema and deterministic aggregation.
4. Add explicit V8 includes/excludes for owned production code. Keep initial thresholds
   non-blocking; publish the measured baseline rather than inventing a percentage.
5. Instrument CI and scheduled calibration without changing which tests or gates run.
6. Run in observation mode for at least two representative weeks before activation is eligible.

### Functional verification and boundary

- Unit-test the observation library and coverage configuration.
- Run web and database full coverage successfully and inspect all four coverage dimensions.
- Prove one intentionally unloaded owned file is counted.
- Compare the reporter against at least one recent PR, merge-group, and scheduled/full run.
- Publish the baseline and measurement artifact without changing merge outcomes.

This PR is independently shippable because it only observes and reports. Rollback removes the
reporter/workflow hooks; no required check or suite selection changes.

## Deliverable 2: Route-sweep determinism (`BI-EA221325`)

### Concrete result

Make route-budget evidence complete and reproducible before optimizing it:

- one isolated page lifecycle per route inside the authenticated browser context;
- no competing `about:blank` reset;
- complete eligible-route accounting and failure-only diagnostics;
- two consecutive complete sweeps on the same source revision;
- honest activation of the checked-in ratchet only after determinism is proved;
- a bounded 1/2/4-worker experiment, selecting the fastest reliable worker count from evidence.

### Files

- modify `apps/web/scripts/ux-route-sweep.ts`
- modify `apps/web/scripts/ux-route-sweep.test.ts`
- modify `apps/web/lib/ux-budget/measure.ts`
- modify `apps/web/lib/ux-budget/ratchet.ts`
- modify `apps/web/lib/ux-budget/ratchet.test.ts`
- modify `apps/web/lib/ux-budget/route-budget-baseline.json`
- modify `.github/workflows/ux-route-sweep.yml`

### Red-green sequence

1. Add a failing lifecycle test showing that each route owns and closes its page on success and
   failure.
2. Add failing tests for duplicate/missing route results, worker crash propagation, deterministic
   output ordering, and complete eligible-route accounting.
3. Implement per-route page isolation and remove the obsolete reset path.
4. Prove two consecutive same-SHA single-worker runs are complete and stable.
5. Arm the baseline ratchet only from accepted evidence.
6. Add bounded workers and compare 1/2/4-worker completion, variance, failures, and duration.

### Functional verification and boundary

- Run targeted route-sweep and UX-budget tests.
- Run two consecutive complete sweeps on one SHA with zero harness skips.
- Run the bounded worker experiment and record the chosen concurrency.
- Confirm the same route inventory remains measured and functional UX journeys remain separate.

The slice is independently shippable after deterministic single-worker evidence; concurrency can
remain one if higher counts are less reliable. Rollback sets worker count to one and reverts the
ratchet activation without removing route coverage.

## Deliverable 3: Windows local-CI timeouts (`BI-72AEDE8B`)

### Concrete result

Remove Windows promote-contract timeout false reds while preserving real timeout detection:

- classify process startup, command execution, and teardown separately;
- stream heartbeat/progress evidence during long valid operations;
- terminate the complete child process tree on a genuine timeout;
- include the exact command, phase, elapsed time, and last progress in the result;
- keep PowerShell 5.1 compatibility and ASCII-only script content.

### Files

- modify `scripts/local-ci-runner.mjs`
- modify `scripts/local-ci-runner.test.mjs`
- modify `scripts/pregate.mjs`
- modify relevant `scripts/*.ps1` promote or gate wrapper
- update `docs/testing/pr-health.md` or local-CI contributor guidance

### Red-green sequence

1. Reproduce the current timeout with a deterministic test double.
2. Add failing tests for long-progressing work, silent hung work, child-tree teardown, quoting, and
   evidence classification.
3. Implement phase-aware timeout and heartbeat handling behind the existing runner contract.
4. Prove a real hung subprocess fails promptly while a valid long subprocess completes.

### Functional verification and boundary

- Run the runner tests on Windows.
- Execute the promote-contract path twice on the same candidate SHA.
- Confirm no orphan processes, leaked leases, or ambiguous timeout summary remain.

This is independently shippable as a harness repair. Rollback restores the previous runner timeout
while retaining any additive diagnostics that are contract-compatible.

## Deliverable 4: Delivery-loop resilience (`BI-C22152E7`)

### Concrete result

Make local-CI fail quickly, classify infrastructure separately, and leave concise actionable
evidence:

- preflight branch/SHA, lease, database, dependency graph, disk, Docker, and toolchain readiness;
- quiescence checks that wait for or reject conflicting install/self-upgrade activity;
- one mutex-guarded freshness/convergence path;
- concise failure summaries with failed phase, first actionable error, evidence ID, and rerun rule;
- guaranteed lease/process cleanup;
- a postmortem record for recurring infrastructure failure classes.

### Files

- modify `scripts/pregate.mjs`
- modify `scripts/gate-worktree.mjs`
- modify `scripts/local-integration-ci.mjs`
- modify `scripts/lib/local-integration-ci.mjs`
- modify `scripts/lib/local-integration-ci.test.mjs`
- modify `scripts/sandbox-freshness-preflight.mjs`
- modify `scripts/pr-health.mjs`
- modify `scripts/pr-health.test.mjs`
- update `docs/testing/pr-health.md`

### Red-green sequence

1. Add failing tests for active self-upgrade/install, sandbox drift, missing dependency graph, lost
   lease, interrupted cleanup, and product-red versus infrastructure-blocked classification.
2. Implement preflight and quiescence before candidate mutation.
3. Centralize cleanup and failure-summary generation.
4. Prove exit codes 3/4 remain reserved for drift/not-ready and exit 1 means a real gate failure.
5. Record stable recurring failure classes for observation without exposing secrets.

### Functional verification and boundary

- Run local-CI library and PR-health tests.
- Exercise one synthetic infrastructure block and one synthetic product failure.
- Run one full governed local-integration gate and verify lease cleanup and evidence summary.

This slice depends on the Windows timeout repair and is independently shippable as delivery
resilience. Rollback disables new preflight checks individually; it must not bypass lease or
sandbox-freshness safety.

## Deliverable 5: Evidence-planner shadow mode (`BI-A4EC0EA6`)

### Concrete result

Create one deterministic, versioned evidence planner used by GitHub and local-CI in shadow mode.
It combines:

- base/head tree diff and package ownership;
- Vitest static related-test relationships;
- code-graph `TESTED_BY` advice only when graph freshness and confidence pass;
- route-family ownership;
- migrations, lockfiles, CI/test configuration, auth, routing shell, shared setup, generated
  contracts, install/seed, security, and platform-core expansion rules;
- recent failed/flaky tests;
- explicit full-suite escalation reasons.

The output is a machine-readable plan with affected packages, tests, routes, global guards, UX
mode, planner version/digest, input freshness, and escalation reasons.

### Files

- create `config/ci-evidence-policy.json`
- create `scripts/lib/ci-evidence-plan.mjs`
- create `scripts/lib/ci-evidence-plan.test.mjs`
- create `scripts/ci-evidence-plan.mjs`
- modify `scripts/ci-change-scope.mjs`
- modify `scripts/ci-change-scope.test.mjs`
- modify `scripts/lib/local-integration-ci.mjs`
- modify `.github/workflows/ci.yml`
- modify `.github/workflows/ux-route-sweep.yml`
- update `docs/testing/ci-evidence.md`

### Red-green sequence

1. Add table-driven failing tests for every risk expansion rule.
2. Add failing tests showing missing/stale/dirty/incompatible graph input, unmapped files, and
   policy-version mismatch all select exhaustive evidence.
3. Add fixtures proving deterministic local/GitHub output for the same base/head trees.
4. Implement the typed plan and canonical serializer/digest.
5. Adapt existing change scope to consume the planner; do not duplicate the classification rules.
6. Emit shadow recommendations while the workflows continue exhaustive execution.

### Functional verification and boundary

- Run planner and existing scope-classifier tests.
- Compare local and GitHub plans for at least docs-only, web leaf, DB migration, lockfile, auth,
  routing-shell, test-config, and unknown-file fixtures.
- Confirm graph unavailability produces a full plan, not an error or empty selection.
- Confirm merge-group plans remain exhaustive.

This slice is independently shippable in shadow mode. Rollback removes planner consumption and
restores the existing classifier; exhaustive workflows remain unchanged.

## Deliverable 6: Source-only pregate (`BI-7FB50D1B`)

### Concrete result

Give source-only worktrees an honest, governed path to request canonical runtime evidence:

- detect `.dpf-worktree-readiness.json` deterministically;
- run cheap source-local checks only when their dependencies exist;
- route runtime-bound gates through the leased `local-integration-ci` sandbox;
- never install dependencies into the topic worktree as a workaround;
- report unrun gates as unrun/blocked, not failed or passed;
- preserve the exact branch/SHA pregate record required before push.

### Files

- modify `scripts/pregate.mjs`
- modify `scripts/gate-worktree.mjs`
- modify `scripts/lib/local-integration-ci.mjs`
- add or modify their focused tests
- modify `scripts/dpf-bootstrap-agent-toolchain.ps1`
- modify `scripts/dpf-bootstrap-agent-toolchain.sh`
- update `docs/operations/install.md`
- update `docs/testing/ci-evidence.md`

### Red-green sequence

1. Add failing fixtures for `compile-ready`, `source-only`, missing, malformed, and stale readiness
   records.
2. Add failing tests proving source-only mode never reports skipped runtime gates as green and
   never runs a worktree-local install.
3. Implement readiness routing through the resilient local-CI path.
4. Prove exact branch/SHA records are written only after the canonical runtime gates pass.

### Functional verification and boundary

- Run focused pregate/gate tests.
- Execute one source-only docs-only branch and one source-only runtime-code branch.
- Confirm the latter leases the sandbox and records canonical evidence without modifying worktree
  dependencies.

This slice is independently shippable after delivery-loop resilience. Rollback restores the
previous explicit source-only refusal; it must not claim unrun gates as passed.

## Deliverable 7: Duplicate-execution refactor (`BI-4DB73C5E`)

### Concrete result

Spend the required 20% refactoring allocation by removing measured duplication while preserving
or improving diagnosability:

- duration-balanced web test shards from observed timing, not file count;
- one exact-source/toolchain production bundle artifact consumed by UX evidence;
- one TypeScript proof when parity shows standalone `tsc` duplicates `next build`;
- a small number of aggregate policy jobs with named per-guard results;
- exactly one authoritative CodeQL configuration with language/check parity;
- cache retention based on measured economics;
- one evidence planner and one plan schema, deleting superseded scope logic.

### Files

- modify `.github/workflows/ci.yml`
- modify `.github/workflows/ux-route-sweep.yml`
- modify `.github/workflows/codeql.yml` or remove it after repository-policy convergence
- modify `.github/codeql/codeql-config.yml` only if the retained setup requires it
- modify `.github/actions/setup-pnpm/action.yml` only when cache measurements justify it
- modify `scripts/check-ci-build-cache.test.mjs`
- create `scripts/lib/ci-test-shards.mjs`
- create `scripts/lib/ci-test-shards.test.mjs`
- create `scripts/lib/ci-evidence-artifact.mjs`
- create `scripts/lib/ci-evidence-artifact.test.mjs`
- modify merge-readiness workflow-conformance tests
- update `docs/testing/pr-health.md`
- update `docs/testing/ci-evidence.md`

### Red-green sequence

1. Add failing shard tests for deterministic duration balancing, new/unseen tests, stale timing,
   and complete exactly-once assignment.
2. Add failing artifact tests for tree/toolchain/checksum mismatch, missing files, and expiry.
3. Add a parity observation proving which TypeScript failures are unique to standalone `tsc`.
4. Add workflow-conformance tests proving every consolidated guard still feeds `Merge Readiness`
   and exposes a named sub-result.
5. Confirm live repository/organization CodeQL policy, then remove only the duplicated setup.
6. Implement exact-key build artifact sharing and measured shard balancing.
7. Remove superseded boilerplate and duplicated scope logic in the same PRs that replace it.

### Functional verification and boundary

- Run shard, artifact, cache, merge-policy, and workflow-conformance tests.
- Demonstrate identical test-file coverage before/after shard balancing.
- Demonstrate bundle checksum and tree/toolchain verification before UX consumption.
- Inject one failing consolidated guard and prove `Merge Readiness` fails with its name visible.
- Prove retained CodeQL languages and check authority match the pre-change contract.
- Compare before/after wall time and runner-minutes on representative PR and merge-group runs.

This BI may use multiple sequential PRs only if each remains one concern and the live BI is split
before implementation. No duplication is removed before parity evidence. Rollback independently
restores the previous shard map, build path, policy jobs, Typecheck job, or CodeQL setup. Never
restore broad Turbopack cache keys.

## Deliverable 8: Affected-PR activation (`BI-4527C1DA`)

### Concrete result

Switch pull-request execution from exhaustive to fail-safe affected evidence only after the shadow
acceptance gate passes:

- observed failure recall is 100% for at least two representative weeks;
- every unknown classification expanded to exhaustive;
- recent failures/flakes are forced into the set;
- changed production files have an explicit test/coverage disposition;
- merge-group exhaustive evidence is healthy and required;
- one configuration kill switch returns PRs to exhaustive execution;
- scheduled calibration continuously compares selection against full runs and automatically
  recommends/executes rollback on a recall miss according to policy.

### Files

- modify `config/ci-evidence-policy.json`
- modify `.github/workflows/ci.yml`
- modify `.github/workflows/ux-route-sweep.yml`
- modify `.github/workflows/ci-calibration.yml`
- modify `scripts/lib/ci-evidence-plan.mjs`
- modify `scripts/lib/ci-evidence-plan.test.mjs`
- modify merge-readiness policy/conformance tests as needed
- update `docs/testing/ci-evidence.md`
- update `AGENTS.md` only for durable changed evidence doctrine

### Red-green sequence

1. Add failing lifecycle-matrix tests: PR may select; merge group must be exhaustive; push remains
   exhaustive until exact-tree reuse lands.
2. Add failing acceptance tests for insufficient window, any recall miss, unknown without
   expansion, missing flaky history, stale coverage, and unhealthy merge-group proof.
3. Add failing kill-switch and calibration-miss rollback tests.
4. Implement activation behind a default-exhaustive policy flag.
5. Attach the accepted observation report and explicitly enable affected PR selection.

### Functional verification and boundary

- Recompute the two-week observation acceptance from immutable artifacts.
- Exercise leaf change, cross-package change, route change, migration, lockfile, auth/core, and
  unknown fixtures.
- Prove merge-group workflows remain exhaustive and stable required contexts remain unchanged.
- Trigger the kill switch and confirm the next PR plan is exhaustive.
- Compare activated PR p50/p90, runner-minutes, recall, and expansion rate against baseline.

This risk-bearing slice is independently reversible by one policy change. Any observed missed
failure disables affected selection until its classifier/test gap is repaired and a new acceptance
window passes.

## Deliverable 9: Exact-tree reuse (`BI-9585E580`)

### Concrete result

Avoid repeating exhaustive evidence on `push` to `main` only when the pushed tree is exactly the
tree already tested by the merge queue:

- write a versioned, checksummed `ci-evidence.json` artifact from exhaustive GitHub execution;
- bind repository, immutable Git tree, merge-group identity, planner digest, policy version,
  toolchain, suites, gate results, coverage/route counts, artifact hashes, creation, and expiry;
- compare Git trees, not commit SHAs;
- require every gate in the versioned merge-policy manifest;
- run push-only duties while reusing matching evidence;
- fail safe to exhaustive execution on any missing, expired, incomplete, or mismatched field;
- optionally project accepted GitHub evidence into DPF evidence records without fabricating a
  `ToolExecution` audit root.

### Files

- create `scripts/lib/ci-evidence-receipt.mjs`
- create `scripts/lib/ci-evidence-receipt.test.mjs`
- create `scripts/ci-evidence-receipt.mjs`
- modify `.github/workflows/ci.yml`
- modify `.github/workflows/ux-route-sweep.yml`
- modify `config/merge-readiness-policy.json` only if artifact requirements belong in its version
- modify merge-policy and workflow-conformance tests
- update `docs/testing/ci-evidence.md`
- update `docs/testing/pr-health.md`

### Red-green sequence

1. Add failing contract tests for a valid exact-tree artifact.
2. Add failing cases for different tree, same commit/different tree assumption, missing gate,
   non-terminal/failed gate, changed planner/policy/toolchain, bad checksum, expiry, and malformed
   artifact.
3. Add a failing workflow test proving `push` falls back to exhaustive work when lookup or
   verification fails.
4. Implement artifact creation and verification using GitHub-native evidence identity.
5. Enable reuse only after merge-group artifact production is proven on multiple real queue runs.

### Functional verification and boundary

- Verify valid reuse on a real queue-tested tree and record which push-only duties still execute.
- Deliberately mutate each identity dimension in fixtures and prove exhaustive fallback.
- Confirm no DPF `ToolExecutionReceipt` row is minted or consumed by the GitHub workflow.
- Compare post-merge runner-minutes before/after without changing pre-`main` proof.

This is independently shippable after affected-PR activation. Rollback disables reuse and restores
exhaustive push execution; merge-group evidence remains unchanged.

## Cross-deliverable completion gate

Each BI may close only when its own PR is merged and its evidence is attached. The umbrella closes
only when all of the following are true:

1. All nine mapped BIs are `done`; the separate prompt isolation BI is also resolved.
2. Every commit is DCO-signed, every branch is pushed, every PR passes `pnpm pr:health`, and every
   merge occurs through the queue.
3. Targeted tests, web production build, applicable UX evidence, and applicable migration evidence
   pass for each slice through the correct local or shared-sandbox path.
4. The planner produces byte-stable semantic output locally and in GitHub for the same base/head.
5. All unknown/stale/dirty/mismatched inputs expand to exhaustive evidence in tests and live
   observation.
6. At least two representative weeks of shadow data show 100% failure recall before PR selection
   activation.
7. Full V8 baselines include unloaded owned files and publish statements, branches, functions, and
   lines for web and database code.
8. Merge-group execution remains exhaustive and proves all applicable gates on the exact
   integration tree.
9. Route measurement completes 100% of eligible inventory with zero harness skips and stable
   same-SHA evidence.
10. Exactly one authoritative CodeQL setup remains with language and required-check parity.
11. Safely classifiable PR feedback is no more than 5 minutes p90, merge-group exhaustive evidence
    is no more than 8 minutes p90, and representative runner-minutes fall at least 40%; otherwise
    the remaining measured bottleneck stays open in a live BI.
12. Documentation impact is recorded per PR. Contributor and agent docs describe the final
    lifecycle; no operator-facing portal docs are required unless implementation adds UI.

## Refactoring allocation

The implementation budget is ten units per slice: eight for behavior/evidence and two for
refactoring (20%). The refactor units are spent only on duplication the slice supersedes:

- one shared planner instead of workflow/local scope forks;
- one typed plan and GitHub evidence contract;
- extracted, testable process and page lifecycles;
- duration-balanced shard logic instead of hardcoded file-count shards;
- consolidated policy orchestration with named sub-results;
- deletion of duplicate build, typecheck, cache, and CodeQL paths only after parity proof.

Refactoring does not authorize unrelated cleanup or combine independently shippable BIs.

## Risks and rollback

| Risk | Prevention | Rollback |
| --- | --- | --- |
| Selector misses indirect dependency | Shadow window, 100% recall, risk expansions, exhaustive queue | Kill switch to exhaustive PRs |
| Queue becomes the slow surprise | Optimize exhaustive tier and keep affected PR build/UX evidence | Disable selection if early feedback loses value |
| Route parallelism creates nondeterminism | Stabilize first; bounded measured experiment | Worker count one |
| Consolidation hides the failed guard | Named sub-results and aggregate failure-injection tests | Restore separate job for that guard |
| Typecheck removal loses unique evidence | Observe parity before removal | Restore standalone Typecheck |
| CodeQL policy loses language/authority | Inspect live policy and prove parity | Restore the prior authoritative setup |
| Cache change revives stale builds | Exact content identity and freshness preflight | Disable cache; never broaden Turbopack restore |
| Exact-tree reuse accepts wrong evidence | Tree, policy, planner, toolchain, gate, checksum, expiry checks | Exhaustive push execution |
| Local-CI infrastructure red is blamed on product | Reserved exit codes and evidence classification | Disable optional preflight only; preserve safety checks |
| Metrics are gamed by excluding files | Explicit owned-source includes and unloaded-file invariant | Revert threshold, not visibility |

## Backlog coverage

- Decision: decomposed
- Parent: `BI-E5A0C9A7`
- Receipt: `cms2f1hjw0c0t01qo29b2w0q8`
- Dependencies: recorded in the deliverable graph below; `none` means independently startable.
- `observation-baselines` -> `BI-2F60FDCE` (dependencies: none)
- `route-sweep-determinism` -> `BI-EA221325` (dependencies: none)
- `windows-local-ci-timeouts` -> `BI-72AEDE8B` (dependencies: none)
- `delivery-loop-resilience` -> `BI-C22152E7` (dependencies: `windows-local-ci-timeouts`)
- `source-only-pregate` -> `BI-7FB50D1B` (dependencies: `delivery-loop-resilience`)
- `evidence-planner-shadow` -> `BI-A4EC0EA6` (dependencies: `observation-baselines`)
- `duplicate-execution-refactor` -> `BI-4DB73C5E` (dependencies: `observation-baselines`, `route-sweep-determinism`, `windows-local-ci-timeouts`)
- `affected-pr-activation` -> `BI-4527C1DA` (dependencies: `observation-baselines`, `evidence-planner-shadow`, `duplicate-execution-refactor`, `route-sweep-determinism`)
- `exact-tree-reuse` -> `BI-9585E580` (dependencies: `observation-baselines`, `evidence-planner-shadow`, `affected-pr-activation`)

## Documentation impact

This program changes contributor CI behavior and external-agent expectations. Each delivery PR
updates `docs/testing/ci-evidence.md` and the directly affected operational/testing guide.
`AGENTS.md` changes only when durable doctrine changes. No portal UI or operator workflow is
introduced by the architecture, so `docs/user-guide/` and UX verification are not required unless
a later implementation slice adds a visible surface.
