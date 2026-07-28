# Data control operation journal

DPF uses one durable operation journal for consequential data mutations that can
cross Postgres and external or derived stores. The journal is the coordination
record; each data domain still owns the actual effect, verification, and
compensation rules.

## Protocol

1. Persist `DataControlOperation` intent before any mutation. The immutable
   envelope includes the organization, actor authority, action, purpose, input
   hash, assets and fields, classifications, policy and legal-hold versions,
   approvals, risk, and requested target PEPs.
2. In the same Prisma transaction as any source-row mutation, create one
   `DataControlOperationStep` per target. A pending step is the transactional
   outbox record; there is no second delivery table.
3. Link the canonical `AuthorizationDecisionLog` decision and consume its exact
   binding once, with an immediate authority and hold recheck.
4. Claim each target with a renewable lease. Every effect adapter receives the
   stable operation/step idempotency key.
5. Store a provider acknowledgement as `applied`. Only an independent verifier
   can advance the step to `verified`.
6. Derive operation state from persisted step truth. Terminal evidence is
   written only after every required target is verified, or after every applied
   effect has been compensated.
7. When an irreversible target fails after another target applied, keep the
   operation `partially-complete` and project one idempotent Work Item into the
   existing Work Case escalation surface.

## Adapter contract

Each target type must provide:

- `effect(step)`: idempotent by `step.idempotencyKey`;
- `verify(step)`: independently observes target truth and returns bounded
  evidence;
- `compensate(step)`: required only when the target is declared compensable.

An unregistered target adapter is not guessed or skipped as success. Its step
remains durable and visible until its owning domain ships the adapter.

## Substrate budget

The journal intentionally adds two relational models and ratchets the measured
Prisma-model budget from 528 to 530. `DataControlOperation` owns immutable
intent, authority, and aggregate outcome; `DataControlOperationStep` is the
independently claimable transactional outbox and verified checkpoint for one
target. Combining the rows into a JSON collection would remove database-enforced
target identity, lease and retry indexes, compare-and-set claims, and
target-specific crash recovery. The split is therefore the minimum safe
substrate for this cross-store protocol, not a parallel domain model.

## Adoption checklist

- Register the affected logical assets and classifications.
- Create journal intent and target steps in the source mutation transaction.
- Bind a current PDP/PEP authorization decision to the exact envelope.
- Demonstrate duplicate delivery and crash recovery without double effect.
- Demonstrate acknowledgement-versus-verification separation.
- Define the irreversible pivot and compensation behavior.
- Route non-compensable partial state to the Work Case escalation queue.
- Add focused tests and exact merged-code local-CI evidence.

Initial adopters are owned by their existing BIs: MDM merge/unmerge/publish,
legal-hold issue/release, archive and disposition, projection cleanup, and
subject access/erasure. This journal foundation does not reconstruct or backfill
legacy operations.
