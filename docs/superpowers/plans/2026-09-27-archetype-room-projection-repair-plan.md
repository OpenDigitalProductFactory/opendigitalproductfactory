---
status: active
---

# Archetype room projection repair plan

Status: implementation admitted; delivery and runtime acceptance pending.
Backlog: BI-224E6E82. Workroom: WC-0829A222.
Design: [repair contract](../specs/2026-09-27-archetype-room-projection-repair-design.md).

For agentic workers: use DPF test-first development, scoped workroom claims,
appropriate local verification and the protected PR process. Admission to design
does not authorize implementation before its readiness decision allows it.

## Backlog coverage

Proposed decision: atomic. All phases map to existing BI-224E6E82. Typed writes
without a caller do not deliver the feature; a caller without history-safe writes
violates acceptance. Tests and live verification are part of that same repair.
No phase is independently shippable. Coverage receipt `cmv0d8dpq0lxb01nwca20ypim`
and plan-review PASS `initiative-e4b4d354-8161-4e77-9ce9-1e7da0d890d3`
bind the reviewed plan at `c99fe7e96bcffd8d746d74dfb3e5a6b70872ed45`.
Implementation was readmitted after the source rebase by `IRD-599B98471429`.

### Implementation notes (2026-10-11)

The room projector uses generated Prisma argument types while retaining a narrow
delegate boundary to avoid the existing full-client type-instantiation cost.
One org-scoped PostgreSQL transaction lock serializes both projections; caller
transactions remain owned by the caller. Missing definitions become `inactive`
at their existing stage, with append-only `LifecycleEvent` records. The canonical
`retirement` stage is terminal, so reversible withdrawal must use the status axis.
The compatible `removed` result counts withdrawals, not deleted rows. Returning
stages reactivate the same IDs; unrelated JSON metadata and references survive.
The existing [lifecycle backbone design](../specs/2026-06-07-unified-lifecycle-backbone-design.md)
already prescribes inactive logical definitions with an audit reason. The stage
type seed is aligned with that rule on both create and upsert; it does not allow
the terminal retirement stage or alter other element types.

The existing boot reconciler now considers EA-only organizations. A source sweep
found no operational reader of persisted `archetype-room-definition` rows; future
active readers must exclude `lifecycleStatus: inactive`. Historical readers retain
access. There is no new model, migration, scheduler, or UI interaction.

Observed first-failing regressions covered invalid Prisma fields, missing inherited
roles, lost metadata, deleted history, missing atomic orchestration and skipped
EA-only reconciliation. Targeted unit tests pass. PostgreSQL, shared gate, semantic
review, protected PR, release and live acceptance evidence remain required.

The first shared PostgreSQL gate passed 89 tests and failed caller-transaction
identity: Prisma now exposes nested `$transaction` on transaction clients. The
helper's previous method-presence check opened a savepoint rather than reusing
the caller. A focused regression first failed on that behavior, then passed after
root detection switched to connection-management capability (`$connect`). The
database assertion compares identity as a boolean to avoid recursively formatting
Prisma proxies on failure. The corrected PostgreSQL gate remains pending.

### Explicit traceability for the atomic deliverable

Deliverable key: `room-projection-repair`. All rows belong to BI-224E6E82;
there are no separately shippable phases or deliverable dependencies.
Contract and flow identifiers below are local references for this coverage record,
not new platform types or runtime entities.

| Objective | Contract reference | Flow reference | Verification reference |
| --- | --- | --- | --- |
| OBJ-PERSIST | CONTRACT-PERSIST: valid typed writes and declared bindings (design R1) | FLOW-PROJECT: existing operational-value-stream projection entrypoint | AC-1 |
| OBJ-IDENTITY | CONTRACT-IDENTITY: tenant-scoped stable identity under repetition and concurrency (design R2) | FLOW-RECONCILE: repeat the existing reconciliation entrypoint | AC-2 |
| OBJ-HISTORY | CONTRACT-HISTORY: retain identities, relationships and lifecycle history (design R3) | FLOW-RETIRE-REACTIVATE: remove and restore a declared stage | AC-3 |
| OBJ-ATOMIC | CONTRACT-ATOMIC: one model and transaction for EA and room projection (design R4) | FLOW-ROLLBACK: inject a room write failure in combined projection | AC-4 |
| OBJ-CONVERGE | CONTRACT-CONVERGE: existing EA-only installations remain eligible (design R5) | FLOW-BACKFILL: existing operational-value-stream backfill | AC-5 |
| OBJ-PERSIST, OBJ-IDENTITY, OBJ-HISTORY, OBJ-ATOMIC, OBJ-CONVERGE | CONTRACT-LIVE: verify the served image and persisted outcome | FLOW-LIVE: supported reconciliation for an isolated governed test organization | AC-6 |

The coverage request must include every objective and acceptance ID above, with
the contract and flow IDs as its explicit references. It cannot be recorded until
a passing independent spec-approval creates this item's scope baseline. Preserve
the existing review task identities while that prerequisite is pending.

## Phase 1: reconcile evidence and review

Preserve PR5141 and historical design bindings from the repair design. Publish
this addendum and plan with DCO; adopt exact base/head, obtain independent design
and architecture review, record immutable plan coverage, then request plan review.
Resolve findings honestly and require implementation readiness before source edits.

## Phase 2: failing regressions

Claim `packages/db/src/archetype-room-definition-projection.ts` and its tests,
`apps/web/lib/storefront/project-operational-value-stream.ts` and its tests, and
the existing backfill implementation/tests if eligibility needs repair. Consume
every returned test-impact/guard obligation before editing. Add generated-Prisma
integration coverage for AC-1 through AC-5, plus focused pure tests for role fallback.
Prove failures on the unchanged source. Shared-runtime tests require a lease;
worktree dependency failures are inconclusive, not product failures.

## Phase 3: persistence and orchestration

Replace argument-erasing persistence shapes with generated Prisma-checked inputs.
Use existing lifecycle retirement/audit conventions; preserve IDs, relationships
and unrelated metadata. Compose EA and room projection at the existing app entry
with transaction rollback. Verify existing-install backfill eligibility. Inspect
active readers and prevent retired definitions appearing as active work. Refactor
shared conventions only where needed. Make AC-1 through AC-5 green, including concurrency
and rollback tests, and run affected typechecks.

## Phase 4: delivery and live acceptance

Run impact-derived checks and required production build/PR gates. Document any
unrun gate. Ship one scoped signed PR through the merge queue, verify the resulting
image identity, use native self-upgrade when coordinated with the release owner,
and execute AC-6 through the supported entrypoint with a governed test organization.
Record real evidence and independent acceptance before marking BI224E6E82 done.

## Risks and rollback

Transaction nesting, existing-install eligibility, concurrent duplicate creation,
retired-reader semantics and metadata loss are explicit regression cases. Preserve
history through failures. Revert via PR if necessary and reconcile after the fixed
image; never delete retained room data as rollback. No migration is currently
planned. A newly discovered schema change requires design amendment and migration
verification before delivery.

The source impact contract covers the projector, orchestration, backfill and stage
seed. Targeted tests, typechecks, style checks and derived-document checks were
executed before the initial shared gate. Release and live acceptance are not yet
claimed; retain the failing gate evidence when recording its replacement.
