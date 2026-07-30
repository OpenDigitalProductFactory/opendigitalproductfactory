---
title: Non-portal UX sweep short-circuit
date: 2026-07-30
status: implementation
backlog_item: BI-B374EF2B
epic: EP-0DFF753B
spec: docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md
---

# Non-portal UX sweep short-circuit

## Outcome

Make the existing authoritative docs-only and `apps/mobile`-only pull-request
classifications prevent allocation of the reusable web-portal UX sweep runner
and Postgres service. Publish that decision through a dedicated
`portal_ux_required` output rather than coupling UX evidence to the broad
`heavy` build/test switch. Preserve the stable `UX Route Budget Sweep` required
context and retain exhaustive evidence for `merge_group`, `push`,
`workflow_dispatch`, and every unknown or malformed scope.

This is one atomic delivery: the reusable workflow input, caller wiring, fail-closed
aggregate, and workflow contract tests are unsafe to ship separately.

## Prior-design reconciliation

- The CI evidence-efficiency design keeps pull-request selection behind stable required
  contexts and retains exhaustive merge-group proof. This slice implements that lifecycle
  distinction; it does not activate affected-test or changed-route selection.
- The merge-readiness design requires always-triggered aggregate contexts. GitHub's
  documented job-level skip semantics preserve a successful dependency result without the
  pending-check failure mode caused by workflow-level path filters.
- The current evidence planner already owns docs-only and app-mobile-only
  classification. Workflow YAML consumes its dedicated `portal_ux_required`
  output; it does not introduce a second path classifier.
- Route assertions, baselines, tolerances, fixtures, route inventory, and production
  behavior are unchanged. Only the PR lifecycle admission boundary changes.

## Implementation

1. Add a boolean `run_sweep` `workflow_call` input whose safe default is `true`.
2. Guard the reusable `sweep` job with `inputs.run_sweep == true`, before runner and
   service allocation.
3. Emit `portal_ux_required` from the planner's existing scope fields without
   changing the semantic plan or its calibrated digest, then pass that output
   to `run_sweep`.
4. Make the stable aggregate depend on both `changes` and the runtime call. Accept
   `runtime=skipped` only when the authoritative signal is exactly
   `portal_ux_required=false`; require `runtime=success` otherwise.
5. Test-drive the YAML contract: explicit docs/mobile-only no-op, exhaustive
   defaults, stable check names, and fail-closed aggregate states.

## Verification

- Red/green source contract test for workflow wiring.
- Existing workflow-policy and merge-readiness contract suites.
- YAML/action validation and documentation guards.
- Governed exact-SHA local-CI before publication.
- Representative non-portal PR: verify no reusable sweep runner/service
  allocation and compare wall time against PR #3735's 585-second UX runtime
  baseline.
- Merge-group for the same PR: verify the full route sweep still runs and passes.

## Risks and rollback

- **False skip:** constrained to the planner's dedicated exact string
  `portal_ux_required=false`; missing, malformed, and non-PR values resolve to
  full execution.
- **Required-check ambiguity:** the stable aggregate runs with `always()` and explicitly
  evaluates both scope and runtime result.
- **Reusable workflow misuse:** `run_sweep` defaults to `true`, so direct/manual and future
  callers remain exhaustive unless they deliberately provide `false`.
- **Rollback:** revert this single workflow-contract commit; no data or baseline migration
  is involved.

## Documentation impact

Update contributor CI evidence guidance to state that non-portal PRs skip web
UX runtime allocation while merge groups remain exhaustive. No operator-facing
portal documentation changes are needed because product behavior is unchanged.

## Backlog coverage

Receipt: `cms75u2v60pfd01ogozeqbzw3`.

- Parent BI: `BI-B374EF2B`
- Deliverable: `non-portal-ux-sweep-short-circuit` → `BI-B374EF2B`
- Dependencies: none
- Decision: atomic; all five steps form one required-check contract and are not
  independently shippable.
