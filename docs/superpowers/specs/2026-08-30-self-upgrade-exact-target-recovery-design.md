---
status: active
---

# Self-Upgrade Exact-Target Recovery Closure

**Backlog item:** BI-3FD07259
**Workroom:** WC-69E84242
**Parent design:** `2026-08-29-self-upgrade-admission-reconciliation-design.md`

## Problem and named-ref evidence

This operator install's recurrence exposed one residual contradiction after the parent
design shipped. `SUR-826364D5` was terminally watchdog-failed with zero dispatch
attempts, no acknowledgement, no provider event id, and no worker start, yet an
older rendered page still described it as running. The documented recovery then
refused the identical immutable release as `recovery-target-not-distinct`.

Research on named ref `8ed70d86fbc99c5a4d339b3f1f6c9dc799b505d8`
isolated the defect to `apps/web/lib/self-upgrade/run-store.ts:104-120`. The
predecessor-evidence guard proves that no dispatch was attempted. A later
`SHA OR tag` comparison then rejects both partial identity overlap and an exact
SHA-and-tag replay. Exact replay is the safe case that the evidence guard exists
to permit. Partial overlap remains an inconsistent release identity and must be
refused.

Two candidate causes were executed and ruled out on the same named ref:

- `SelfUpgradeLiveProvider.test.tsx` proves queued, pending, and running rows stay
  observed until an authoritative terminal snapshot arrives. Mount refresh,
  navigation, push invalidation, and bounded fallback polling already converge.
- `inngest-self-registration.test.ts` proves an unset `APP_URL` uses IPv4
  loopback, only a successful PUT records healthy registration, and success
  invokes admission reconciliation. Startup recovery no longer needs a manual
  portal restart.

## Contract

Classify recovery targets as:

- `exact`: SHA and tag both equal the predecessor;
- `distinct`: neither SHA nor tag equals the predecessor; or
- `conflicting`: exactly one identity field overlaps.

Permit `exact` and `distinct` only after the existing terminal,
`dispatchAttemptCount === 0`, no-acknowledgement, no-event-id,
latest-predecessor, and unique-successor guards pass. Keep `conflicting` and any
attempted or ambiguous predecessor fail closed.

The unique typed successor plus the worker claim CAS remains the physical
single-flight boundary. Repeating recovery must return the existing successor,
never enqueue a second physical upgrade.

## UX fit

- **Decision:** fits-with-guardrails.
- **Owning area and route:** Platform, `/ops/self-upgrade`; no new route.
- **Primary persona:** the platform operator deciding whether an upgrade needs
  attention, without reasoning about database or queue internals.
- **Reuse:** keep `SelfUpgradeLiveProvider`, `SelfUpgradeStatusSnapshot`, and
  `SelfUpgradeTriggerControl`; add no timer, banner family, status map, or retry
  button.
- **Source truth:** the canonical `SelfUpgradeRun` snapshot with quiescence and
  job-engine health.
- **Failure behavior:** a watchdog-terminal row removes running/installing
  presentation on the next authoritative observation; a never-dispatched exact
  target recovers only through one typed successor.
- **AI boundary:** none.

No UI source change is warranted. Current source already projects terminal truth
and converges registration; a second presentation mechanism would create a
competing status dialect.

## Ordered atomic fix sequence

1. Replace the exact-SHA-and-tag refusal fixture with a first-failing test that
   requires one typed successor for an unambiguously never-dispatched terminal
   predecessor.
2. Refactor target comparison into the explicit `exact`, `distinct`, and
   `conflicting` classifier, permitting only the first two behind all existing
   recovery guards.
3. Prove repeated exact recovery returns the unique successor and any attempted,
   acknowledged, event-bound, or partial-overlap predecessor remains refused.
4. Re-run live-observation and self-registration suites instead of adding
   duplicate UI or startup mechanisms.
5. Pass affected tests, web typecheck, preflight, semantic review, exact-tree CI,
   protected merge, canonical release, and governed live served-SHA/CAN-TEST
   verification.

This is one atomic safety repair. Target comparison without the typed successor
and worker CAS could duplicate execution; terminal presentation without durable
recovery would tell the truth but leave no safe way forward. The comparison,
successor relation, CAS, and operator projection therefore keep one revert
boundary under BI-3FD07259.
