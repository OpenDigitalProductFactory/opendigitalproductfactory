# PR readiness change scope — BI-D27ADE59

## Problem and reproduction

At source base `4f5def81786cd51816eb880740049a8a629b1faa`, PR readiness selected code-only policy guards for `AGENTS.md`-only edits. The added Node regression failed before the repair because the code guard remained in the plan. CI's classifier already identified this diff as docs-only. Mixed and unknown classifications were tested and retained all guards.

## Design grounding and decision

Extend `2026-08-15-resilient-concurrent-development-process.md` and `2026-09-03-local-first-agentic-delivery-throughput-design.md` sections 4, 9 and 12. Reuse `classifyChangedFiles` from `scripts/ci-change-scope.mjs` and `guardAppliesToScope` from `scripts/lib/pregate-preflight.mjs`. The PR-readiness adapter passes actual changed files through the classifier; its existing plan builder applies the same predicate used by pregate. A missing classification and guards without input declarations remain conservative. Avoid another classifier, policy table or orchestration layer.

## Acceptance

- A docs-only diff omits only declared code-only guards.
- Guards declaring docs and guards without declarations remain selected.
- Mixed, mobile and unknown changes retain the established conservative behavior.
- Existing DCO, immutable publication proof, independent approval and protected CI gates are unchanged.

## Boundaries

Source-local verification mechanics only: no database, permission, runtime, deployment, identity or UI changes. No migration. The optional `changeScope` argument defaults to the previous all-guards behavior for existing callers. Separate from BI-CAP-437F7745 and BI-56E9CEC2; no dependency on their authority repairs.

BI-7E0812E0 repairs a pregate self-test only and explicitly excludes production behavior. This item repairs production PR-readiness plan selection and is distinct.

## Ordered delivery

1. Reproduce the AGENTS.md-only mismatch against the named source base.
2. Reuse the existing predicate and classifier in PR readiness.
3. Execute scope, pregate and existing PR-readiness regression tests.
4. Complete governed publication checks and independent review before opening a ready PR.

Observed source-local result: 41 scope/preflight tests and 19 existing PR-readiness tests pass. `git diff --check` passes. Canonical runtime, protected CI and deployed verification are not established by these results.
