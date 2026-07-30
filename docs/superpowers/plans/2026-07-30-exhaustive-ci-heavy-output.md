---
title: Exhaustive CI heavy-output boundary
date: 2026-07-30
status: implementation
backlog_item: BI-486DB0D7
epic: EP-0DFF753B
spec: docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md
---

# Exhaustive CI heavy-output boundary

## Outcome

Make the evidence planner's `fullSuite` decision authoritative for the GitHub
`heavy` output. A lifecycle or fail-safe escalation that requires exhaustive
evidence must execute Typecheck, Vitest, and Production Build even when the
changed files are intrinsically docs-only or app-mobile-only.

This also lets exhaustive UX consume the same-run exact-tree production artifact
instead of compiling the portal serially after fixture setup.

## Prior-design reconciliation

- The CI evidence-efficiency design makes `merge_group` the exhaustive pre-main
  safety net. File-scope selection may accelerate pull-request feedback, but it
  must not override an exhaustive lifecycle.
- The non-portal UX short-circuit remains pull-request-only. Its dedicated
  `portal_ux_required` output stays independent from the heavy gate switch.
- The exact-tree build-artifact design already moves one production bundle from
  Production Build to UX. This repair supplies that artifact on every exhaustive
  lifecycle; it does not add another build.

## Root-cause evidence

Merge-group run `30588354166` correctly required exhaustive UX for a docs-only
combined tree, but emitted `heavy=false`. Production Build, Typecheck, and
Vitest therefore skipped their real work. UX could not rendezvous with a
same-run artifact and spent 247 seconds in a fallback portal build before the
182-second route sweep.

`githubOutputsForPlan` currently serializes `heavy` from `plan.scope.heavy`
alone even though the semantic plan independently records `fullSuite=true`.

## Implementation

1. Add a failing planner-output contract for docs-only exhaustive lifecycles.
2. Emit `heavy=true` whenever `plan.fullSuite` or intrinsic file scope is heavy.
3. Keep ordinary docs-only and app-mobile-only pull requests light.
4. Retain the existing fail-closed portal UX lifecycle rules.
5. Verify focused planner/workflow contracts, then run the governed exact-SHA
   local-CI gate before publication.

## Acceptance

- Docs-only `merge_group`, `push`, `workflow_dispatch`, `schedule`, and
  `local-ci` plans emit `heavy=true` and `portal_ux_required=true`.
- An escalated docs-only pull request emits both values as `true`.
- A non-escalated docs-only pull request emits both values as `false`.
- Runtime-code pull requests remain heavy and require portal UX.
- Merge-group GitHub evidence shows full Typecheck, Vitest, Production Build,
  and UX; UX materializes the exact-tree build artifact without fallback.

## Documentation impact

Update contributor CI evidence documentation. No operator-facing or product UI
documentation changes are required because this changes CI execution only.

## Backlog coverage

Receipt: `cms84henv0aik01podqr9wy5m`.

This plan is atomic: the planner output, regression contract, and contributor
documentation form one fail-closed lifecycle boundary. Shipping any part alone
would leave either the defect or its operating guidance incorrect.
