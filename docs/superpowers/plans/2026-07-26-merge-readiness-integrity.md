# Merge Readiness Integrity Implementation Plan

- **Status:** approved for implementation by the operator
- **Date:** 2026-07-26
- **Primary backlog item:** `BI-IMP-0EBA628A`
- **Dependent backlog item:** `BI-EA221325`
- **Epic anchors:** `EP-CLIENT-HOOK-PLANE`, `EP-UX-SYSTEM`
- **Work Capsule:** `WC-F7D1E82F`
- **WWMD decision:** `DI-1B5A872B0FA1`
- **Backlog coverage receipt:** `cms23088607le01lhnz2yfrjw`
- **Delivery branches:** `fix/merge-readiness-integrity` (route isolation), then a fresh
  `fix/composed-state-merge-authority` branch after the first slice merges

## Goal

Restore evidence-earned merge authority after PR #3603 merged while Prose Lint Guard and the
standalone UX Route Budget Sweep were red. The repair must make route measurement reproducible,
run the UX gate on speculative merge-group SHAs, collapse the repository's CI jobs into a stable
aggregate context, and make the small branch-protection contract versioned and mechanically
auditable.

## Grounded incident findings

1. PR #3603 merged at `2dac3e09999ff48cffad823053d62460b5e2abc6`.
2. Its merge-group and post-merge CI runs failed Prose Lint Guard. PR #3605 repaired that baseline.
3. Its post-merge UX sweep measured only 11 of 227 routes. The next main run measured 42 of 227.
   Both failed because a shared Playwright page's navigation was interrupted by a competing
   `about:blank` reset.
4. The sweep currently reuses one `Page` across every route and swallows reset-navigation errors.
   Two earlier repairs strengthened the same reset strategy without eliminating the race.
5. The UX workflow runs for pull requests and pushes, but not `merge_group`.
6. Classic protection for `main` requires six contexts: Typecheck, Production Build, DCO, Unit
   Tests, Module Size Guard, and Repo Guard Loop. It does not require Prose Lint Guard or UX Route
   Budget Sweep. The `main-merge-queue` ruleset requires an all-green queue but defines no required
   status-check rule, so the queue can only enforce the incomplete classic context list.

## WWMD architecture decision

The kernel compared three options:

1. require every current job directly in GitHub settings;
2. move all blocking work behind one CI aggregate;
3. version a small manifest, expose stable aggregates, and detect drift.

It recommended **manifest plus aggregates** with high confidence (composite 4.662, margin 1.319).
The strongest positive contributors were **Optimize for the Whole** and **Ship Real Functionality**;
no commandment conflict or weak-coverage flag fired.

## Architecture

```text
CI jobs on pull_request / merge_group
  -> Merge Readiness aggregate
UX sweep on pull_request / merge_group
  -> UX Route Budget Sweep
DCO app
  -> DCO

versioned merge policy
  -> [Merge Readiness, UX Route Budget Sweep, DCO]
  -> static workflow-conformance guard
  -> remote branch-protection drift audit/apply
```

The CI aggregate is the stable contract for repository jobs. It depends on every other CI job and
fails if any dependency fails or is cancelled; legitimate job-level skips remain allowed. A static
guard fails when a new CI job is added without joining the aggregate or when either binding
workflow loses its `merge_group` trigger.

The UX sweep remains a separate stable context because it owns an expensive runtime and ephemeral
Postgres service. It uses a fresh Playwright `Page` for each route inside one authenticated
`BrowserContext`. Closing the page in `finally` eliminates cross-route navigation ownership while
retaining authenticated cookies and avoiding 227 browser launches.

The repository manifest is the source of truth for required context names. A script checks local
workflow conformance by default and compares the manifest to live GitHub branch protection in
remote mode. After the code is merged and both contexts are green on `main`, the same script applies
the exact manifest to `main`; it must never tighten protection before the new contexts exist.

## Delivery slices

The coverage decision is **decomposed**. Each independently shippable slice has its own live BI,
branch, and PR. The second branch starts from `origin/main` only after the route-isolation PR merges
and its repeated-sweep evidence is green.

| Deliverable | Backlog item | Depends on | Coverage receipt |
| --- | --- | --- | --- |
| `route-isolated-ux-measurement` | `BI-EA221325` | none | `cms23088607le01lhnz2yfrjw` |
| `composed-state-merge-authority` | `BI-IMP-0EBA628A` | route-isolated UX measurement | `cms23088607le01lhnz2yfrjw` |

### 1. Route-isolated UX measurement (`BI-EA221325`)

1. Replace the reset-page test with a failing unit test for a route-isolation helper.
2. Create one page per route, execute measurement, and close it in `finally` on success or error.
3. Remove the `about:blank` reset and its obsolete explanation.
4. Add `merge_group` to the UX workflow.
5. Prove the targeted test and two consecutive complete sweeps on the same source revision.

### 2. Composed-state merge authority (`BI-IMP-0EBA628A`)

1. Add a versioned merge-policy manifest containing only stable aggregate contexts.
2. Add a testable dependency-result evaluator and a `Merge Readiness` job that needs every other
   CI job.
3. Add a static guard that proves all CI jobs feed the aggregate and both workflows run on
   `merge_group`.
4. Add remote audit/apply modes that compare or converge classic branch protection without
   changing merge-queue, review, or conversation-resolution settings.
5. Add the static guard to Repo Guard Loop so future workflow drift cannot merge.
6. After merge and main-green evidence, apply the manifest and re-read live protection.

## TDD and verification

1. Red: route-isolation tests fail because the helper does not exist.
2. Green: targeted `ux-route-sweep.test.ts` passes.
3. Red: merge-policy tests fail before the manifest/evaluator/conformance implementation exists.
4. Green: merge-policy unit tests and static conformance pass.
5. Run affected web tests, script tests, typecheck, and production build.
6. Run the local merged-code gate against current `origin/main`.
7. Open a ready PR with DCO sign-off and queue it only after `pnpm pr:health` is ready.
8. Require two consecutive complete UX sweeps for the same SHA; a partial sweep is not green
   evidence even if another attempt passes.
9. Verify the post-merge `main` CI aggregate and UX context, apply live protection, then verify the
   exact required-context set from GitHub.

## Refactor allocation

This plan budgets 10 implementation units, including 2 refactor units (20%):

- extract page lifecycle from route measurement so navigation ownership is explicit and testable;
- replace the scattered branch-protection context list with one manifest and one aggregate
  contract.

## Risks and rollback

- **Queue freeze:** requiring a context before it exists on merge-group SHAs would block all PRs.
  Mitigation: workflow changes merge and prove green before protection is changed.
- **False aggregate pass:** skipped dependencies can conceal upstream failure. Mitigation: include
  every CI job, including scope detection, and fail on any failed/cancelled result.
- **False aggregate failure:** docs-only jobs may legitimately skip. Mitigation: treat `skipped` as
  allowed while requiring the scope-detection and short-circuiting stable jobs.
- **Protection drift:** manual GitHub changes can diverge later. Mitigation: keep the manifest and
  remote audit command in the repository and run static conformance in the required aggregate.
- **Rollback:** revert the workflow/manifest PR and restore the previously captured six required
  contexts. Do not disable merge queue or conversation resolution.

## Documentation impact

Update `docs/testing/pr-health.md` to distinguish broad PR-health observation from the small stable
branch-protection authority. Update `AGENTS.md` only if the implementation changes the durable
operator/agent command; otherwise its existing “all checks terminal and passing” rule remains
correct and the plan records no doctrine change.
