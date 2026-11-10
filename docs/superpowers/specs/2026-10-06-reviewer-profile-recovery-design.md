---
status: draft
---

# Recover authoritative initiative review classification

Backlog: BI-5BE81FE2. Status: proposed.

## Design grounding

Reuse the initiative-readiness design, section 5.1, and its monotonic
`deriveAuthoritativeReadinessProfile` contract. The defect is demonstrated by
BI-224E6E82's original immutable reviewer task: a `fix` proposal is rejected
against authoritative `feature`, but neither its exact tool surface nor the
error provides the expected value. Evidence: cmuxk829ss6ai01qqfkp0wanu.

## Contract and boundaries

Classification remains server-owned. Supply its existing authoritative value
to the bound independent reviewer without modifying the immutable request key,
artifact, principal or grants. Keep transaction-time validation authoritative;
a stale proposal cannot downgrade the item. Missing or contradictory facts
remain refused. A rejection must explain the expected value and support bounded
correction on the same task. Task reads must preserve the recorded rejection
after a transport timeout. The reviewer alone decides the merits and writes
its receipt; the author never receives that authority.

No database migration, new scheduler, provider configuration or approval lane.
Old task metadata remains readable. Reuse existing projection, correction and
classification helpers rather than create parallel policy. About one fifth of
the work is consolidation of those existing paths.

## Acceptance

- Bound spec approval receives the authoritative profile on initial and resumed
  execution, without changing request identity.
- Mismatch returns the expected profile and can be corrected within the same
  task; unavailable classification remains refused.
- Read-only task results retain rejection code, message and recovery action.
- Authority, immutable identity and lock-time classification checks remain.
- The original live task records an independent receipt before recovery is
  declared complete.

## Ordered implementation and verification

1. Reproduce missing context and rejection projection with focused tests.
2. Reuse authoritative classification at dispatch, expose precise rejection,
   and retain it in task read projections. Cover stale and missing facts.
3. Run affected tests/typechecks and the shared gate; publish a signed PR.
4. After canonical deployment, resume the original task and verify its saved
   receipt and next readiness state. Preserve failures as evidence.

Rollback is a reviewed code revert. Preserve all task and receipt history.
