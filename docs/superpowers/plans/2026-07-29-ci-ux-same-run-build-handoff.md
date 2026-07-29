---
title: CI UX same-run production-build handoff
date: 2026-07-29
status: active
backlog: BI-D9E8B8CB
epic: EP-0DFF753B
spec: docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md
coverage_receipt: cms5dxini0b6901qw5fr2ipzo
---

# CI UX same-run production-build handoff

## Outcome

Remove the UX route sweep's cross-workflow production-build discovery tail
without reducing its 202-route semantic, structure, word-budget, or WCAG
coverage. Pull-request, merge-group, and main-push UX verification will
consume the canonical CI build through a direct job dependency and same-run
artifact transfer. Manual baseline calibration remains independently
dispatchable and builds locally.

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion
gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Evidence and prior-design reconciliation

The existing architecture is sound in two important ways and must be retained:

- `BI-959F4F38` / PR #3682 created one checksummed exact-tree/toolchain
  production artifact and made UX validate it before materialization. It
  removed a second 216-second portal compilation.
- `BI-149370BD` / PR #3699 made discovery abandon immediately when every
  matching producer is terminal without an artifact. It correctly preserves
  bounded polling while a valid producer is still queued or running.

The residual latency is therefore not an artifact-integrity or terminality
defect. It is an orchestration defect: `.github/workflows/ci.yml` and
`.github/workflows/ux-route-sweep.yml` start independently, so the consumer can
only poll the Actions API until `Production Build` packages and uploads its
artifact.

Recent exact runs establish the current critical path:

- merge-group run `30384206549`: about 4m40 waiting for the exact-tree build,
  then about 3m08 sweeping all routes;
- PR-head run `30411380083`: about five minutes waiting for the build, then
  about three minutes sweeping 202 routes;
- earlier run `30407144235`: about 9m30 waiting for the build, then about 3m13
  sweeping routes.

Four same-runner sweep workers improved the crawl by only about 8.4 seconds
over two workers on the same SHA, so worker multiplication is not the material
optimization.

GitHub's supported contract is direct: artifacts pass files between jobs in
one workflow, and `needs` makes the consumer wait for the producer. Cross-run
download requires the token and source-run identifier that forced the current
polling locator. Merge-queue required checks must still trigger on
`merge_group`.

This plan extends:

- `docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md`;
- `docs/superpowers/plans/2026-07-26-ci-evidence-efficiency.md`;
- `docs/superpowers/plans/2026-07-27-ci-duplicate-execution-refactor.md`;
- `docs/testing/ci-evidence.md`.

It does not activate `BI-9585E580` cross-lifecycle merge-group-to-push evidence
reuse, change affected-test policy, broaden cache keys, or weaken the UX
baseline contract.

## Architecture

```text
pull_request / merge_group / push
        |
        v
CI workflow
  changes ----------+
        |            |
        v            |
  Production Build  |
        |            |
        | exact-tree receipt + archive
        v            |
  UX Route Budget Sweep
        |
        +-- same-run download + consume
        +-- immediate local build fallback when artifact is absent/invalid

workflow_dispatch (baseline calibration)
        |
        v
standalone UX workflow -> local build -> explicit baseline artifact
```

The stable check name remains `UX Route Budget Sweep`. The CI workflow owns
that check for pull requests, merge groups, and main pushes. The standalone
workflow keeps manual calibration only. This is same-run reuse and does not
consume merge-group evidence on the later push, so `BI-9585E580` remains
separate. Shared sweep steps may be extracted into a composite action if that
is the smallest way to avoid YAML duplication, but no new evidence identity
or runtime contract is introduced.

## Implementation phases

### Phase 1 — Red workflow-contract tests

Deliverable:

- add failing source-level conformance assertions that PR and merge-group UX:
  - are owned by the CI workflow;
  - depend on `build` and the change classifier;
  - download the current run's exact artifact without a token, source run id,
    Actions API locator, or polling deadline;
  - preserve the stable check name and `merge_group` trigger;
  - fall back immediately when build output is skipped, missing, or invalid;
  - leave standalone manual baseline calibration runnable.

Likely files:

- `scripts/check-ci-build-artifact.test.mjs`;
- workflow guard/conformance fixtures already registered by `check-guards`.

Verification:

- targeted Node tests fail for the current cross-workflow locator topology and
  pass only after Phase 2.

### Phase 2 — Same-run producer/consumer topology

Deliverable:

- move the PR/merge-group UX job into `.github/workflows/ci.yml`;
- add explicit `needs` edges to `changes` and `build`;
- download `web-production-build-${{ github.run_id }}-${{
  github.run_attempt }}` from the current run;
- retain `scripts/ci-build-artifact.mjs consume` as the exact
  tree/toolchain/checksum gate;
- skip download when the heavy build is intentionally absent and start the
  existing local build immediately;
- keep the standalone UX workflow for `workflow_dispatch` baseline
  calibration only;
- extract shared setup/sweep steps if necessary to keep one behavioral
  definition.

Verification:

- workflow-contract tests;
- YAML parse and repository guard suite;
- injected missing/corrupt artifact fixtures prove immediate local fallback;
- check-name inventory proves `UX Route Budget Sweep` still reports for
  `pull_request` and `merge_group`.

### Phase 3 — Documentation and timing evidence

Deliverable:

- update `docs/testing/ci-evidence.md` and `docs/testing/pr-health.md` to name
  CI as the PR/merge-group UX owner and manual dispatch as the standalone
  calibration path;
- remove the active-flow ten-minute locator description while retaining the
  exact receipt and fail-safe materialization contract;
- record artifact transfer time, total UX wall time, and runner-minutes on one
  PR-head and one merge-group run.

Verification:

- documentation index/link checks;
- GitHub PR-head workflow shows no `Find exact-tree CI production build` step;
- all 202 routes pass with unchanged baselines, tolerances, exclusions,
  semantic assertions, and WCAG/axe coverage;
- merge-group required check passes under the same name.

## Completion gate

- targeted artifact/workflow tests pass;
- `node scripts/check-guards.mjs` passes;
- documentation index and links pass;
- governed exact-SHA local pregate passes;
- PR-head CI and `UX Route Budget Sweep` are terminal green;
- merge-group CI and `UX Route Budget Sweep` are terminal green;
- measured artifact wait is zero; any remaining delay is classified as direct
  producer build time, transfer/materialization, portal startup, or route
  crawl.

## Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Required UX check disappears or is skipped after a dependency failure | Keep the exact job name, trigger CI on `merge_group`, and use a terminal aggregate shape that reports failure rather than silently skipping where GitHub requires `always()` |
| Heavy=false PR waits on or downloads an artifact that cannot exist | Gate same-run download on the change-plan output and run the existing local build immediately |
| Artifact publication fails while the canonical build itself succeeds | Keep upload non-authoritative and preserve immediate local build fallback |
| Same-run transfer bypasses receipt verification | Continue using the existing `consume` command; artifact proximity never substitutes for tree/toolchain/checksum proof |
| Manual baseline workflow drifts from blocking behavior | Share the behavioral steps through one composite action or a guarded source block and enforce conformance in tests |
| Workflow move changes route coverage | Make route baseline/projection files out of scope and require unchanged 202-route PR and merge-group evidence |

Rollback is one PR: restore the PR/merge-group triggers and locator block in
the standalone UX workflow, remove the CI-owned UX job, and retain the existing
exact-tree artifact producer/consumer contract. No schema rollback or baseline
change is involved.

## Backlog coverage

Decision: `atomic`.

Coverage receipt: `cms5dxini0b6901qw5fr2ipzo`.

Parent BI: `BI-D9E8B8CB`.

| Deliverable | Backlog item | Depends on | Independently shippable |
| --- | --- | --- | --- |
| Same-run build handoff and required-check topology transition | `BI-D9E8B8CB` | none | no |

Atomic rationale: adding the CI-owned UX check before removing the separate
PR/merge-group workflow duplicates binding evidence; removing the separate
trigger first can omit the required check. Dependency wiring, fallback,
conformance tests, and documentation are one rollback boundary.

## Standards references

- [GitHub Actions workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)
- [Store and share data with workflow artifacts](https://docs.github.com/actions/configuring-and-managing-workflows/persisting-workflow-data-using-artifacts)
- [GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
