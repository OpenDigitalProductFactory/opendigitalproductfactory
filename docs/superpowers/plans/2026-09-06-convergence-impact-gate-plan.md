---
status: active
title: Convergence-Impact Gate — implementation plan
backlog_item: BI-B19BE117
design: docs/superpowers/specs/2026-09-06-convergence-impact-gate-design.md
---

# Convergence-Impact Gate — implementation plan

- **Date:** 2026-09-06
- **Backlog item:** `BI-B19BE117` (umbrella, atomic)
- **Design:** [`2026-09-06-convergence-impact-gate-design.md`](../specs/2026-09-06-convergence-impact-gate-design.md)
- **Status:** delivered in PR #5133 (f0f8fcd), spec corrections in #5140 and #5142

## Decision: atomic

One deliverable. The guard, its registry, the trailer contract entry, the gate-context advertisement, the profile wiring and the docs row are not independently shippable: a guard without the profile entry never runs, a trailer name without the guard is dead vocabulary, and the Dockerfile COPY exists only because gate-context imports the classifier. Shipping any subset would be the inert-guard failure the plan exists to avoid.

## Phases (all complete)

| Phase | Deliverable | Verified by |
| --- | --- | --- |
| 1 | Kernel decisions: blocking vs shadow, sibling vs extension | DI-9DF1A83ECACD, DI-91594F6EF8FA |
| 2 | `scripts/convergence-surfaces.json` registry with a cited `why` per surface | test "registry lists only surfaces with a documented reason" |
| 3 | `scripts/check-convergence-impact.mjs` classifier, trailer parser, gate | 17 red/green fixtures in `scripts/check-convergence-impact.test.mjs` |
| 4 | Wiring: `pr-trailer-contract.mjs`, `gate-context.mjs`, `ci-policy-guards.mjs`, `pregate-preflight.mjs`, `package.json` | `pr-readiness.test.mjs`, `ci-policy-guards.test.mjs`, `pregate-preflight.test.mjs` |
| 5 | Dockerfile COPY of classifier and registry so the packaged gate-context names the same surfaces | `check-dockerfile-copied-script-imports.mjs` |
| 6 | Docs: `enforced-ci-gates.md`, `backlog-and-planning-runbook.md`, `pre-pr-gate.md`, `pr-health.md` | Docs Impact Gate |
| 7 | Non-inert proof: the gate fails this PR's own diff without a trailer, and failed its own first CI run on a quoted template | PR #5133 CI history, commit 3af4c61 |

## Traceability

- **Requirements:** spec §1 (problem), §4.1 (registry), §4.2 (attestation), §4.3 (where it runs); OBJ-CONVERGENCE-GATE-1.
- **Contracts:** Convergence-Impact-Decision trailer in scripts/lib/pr-trailer-contract.mjs; scripts/convergence-surfaces.json schemaVersion 1; guard id convergence-impact-gate in the pull-request profile.
- **Flows:** PR opened, Policy Guards (PR) runs check-convergence-impact.mjs over BASE_SHA...HEAD, trailer read from commits and PR_BODY, pass or fail with the mode table; gate-context advertises the trailer before generation.
- **Verification:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7 in the design (OBJ-CONVERGENCE-GATE-1); `pnpm check:convergence-impact:test`; local-CI gate PASS on 943922b and 3af4c61.

## Follow-ups filed

- `BI-A57B6185` — reviewer TaskRun reports "writer omitted" when the writer was called and rejected; surface the rejection.
