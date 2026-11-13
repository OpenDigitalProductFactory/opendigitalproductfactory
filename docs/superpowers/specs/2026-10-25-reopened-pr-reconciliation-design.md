---
status: active
---

# Preserve an explicit reopen during PR reconciliation

BI-BC5C0817 repairs the existing PR-submit actuator. On 2026-10-25,
BI-7A4E70E9 was reopened at 17:07 UTC because its original acceptance was
incomplete. At 17:10 UTC the actuator advanced it again using old PR #6444.
This reproduces the defect already recorded against BI-271B8EEC and PR #6081.

## Contract

An explicit transition back into the coding pool after this same PR already
advanced the item supersedes that PR's automatic status advance. Reobserving
the PR, receiving a duplicate webhook, or sweeping its Workroom must preserve
the reopen and its active claim. A later delivery may advance the item normally.
This does not approve a review, satisfy acceptance, or change branch protection.

Use existing BacklogItem status history, scoped to the same item and PR URL.
Read that history while holding the existing item's transaction lock; compare
the current status before writing. Record no fabricated completion evidence.
When a Workroom lacks a saved PR URL, reconstruct the canonical URL only from
its recorded repository and PR number; skip a room whose identity is unavailable.
No schema, grant, credentials, runtime topology or offline execution privilege
changes are required. Existing records remain intact.

## Live acceptance correction

PR #6571 was deployed by SUR-780A521E on 2026-10-25. The canonical install
contained its merge commit, but live acceptance failed: activity
`cmvo8sagt0bnd01qfec4j3nd6` advanced BI-7A4E70E9 from open to awaiting acceptance
at 19:50:07.613 UTC using PR #6426, after the explicit reopen at 19:49:40.888 UTC.
GitHub records PR #6426 as merged on October 16 at 05:09:48 UTC. The earlier
same-PR history guard alone does not establish that an older merged PR belongs
to the resumed work. No absence of earlier #6426 status history is asserted.

Carry the existing provider `mergedAt` field through inventory reconciliation
and the webhook's `merged_at` into the shared transition. Under the existing
row lock, compare it with the latest explicit transition from done or awaiting
acceptance back into the coding pool. An older or equal merge cannot supersede
that reopen. Missing or invalid merge time cannot prove a later delivery.
The Workroom-only sweep has no provider delivery timestamp and must preserve
such a reopen; webhook or inventory evidence can establish a later delivery.
This extends the same existing actuator; it creates no new lifecycle or store.

Regression coverage includes an older merged PR with no prior local advance,
both provider adapters, a sparse sweep, missing/invalid/equal timestamps, and a
genuinely later merge. Inventory tests must prove the provider time survives
the adapter. Earlier source checks remain historical evidence, not acceptance
of this correction. Re-deployment and another canonical acceptance exercise
are still owed before this repair is complete.

## Ordered implementation and verification

1. Reproduce explicit reopen followed by repeated webhook/observation/sweep.
2. Guard the shared transition function using the original PR advance and the
   later explicit coding-pool transition, so every entry point follows it.
3. Verify a different PR still advances, withdrawn PR behavior still works,
   and a concurrent status change is not overwritten.
4. Run affected tests, package typecheck, required guards and canonical gate;
   publish a signed PR and verify its deployed behavior before claiming repair.

## Acceptance

- Reconcile and replay of the superseded PR leave the item open and claimed.
- A later PR can deliver the resumed implementation.
- Historical rows from another item or PR cannot suppress an eligible advance.
- A stale status snapshot cannot overwrite a newer transition.
- Live verification names the served source and proves the original recovery
  item remains active after an old PR is observed again.

This is a focused prerequisite repair. The original integration, offline
recovery and document lifecycle objectives remain incomplete until their own
acceptance evidence exists.
