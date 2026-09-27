# Archetype room projection repair plan

Status: proposed; coverage receipt and independent review pending.
Backlog: BI-224E6E82. Workroom: WC-0829A222.
Design: [repair contract](../specs/2026-09-27-archetype-room-projection-repair-design.md).

For agentic workers: use DPF test-first development, scoped workroom claims,
appropriate local verification and the protected PR process. Admission to design
does not authorize implementation before its readiness decision allows it.

## Backlog coverage

Proposed decision: atomic. All phases map to existing BI-224E6E82. Typed writes
without a caller do not deliver the feature; a caller without history-safe writes
violates acceptance. Tests and live verification are part of that same repair.
No phase is independently shippable. Live coverage receipt: pending; this section
does not substitute for `record_plan_backlog_coverage` or independent plan review.

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
integration coverage for AC1-AC5, plus focused pure tests for role fallback.
Prove failures on the unchanged source. Shared-runtime tests require a lease;
worktree dependency failures are inconclusive, not product failures.

## Phase 3: persistence and orchestration

Replace argument-erasing persistence shapes with generated Prisma-checked inputs.
Use existing lifecycle retirement/audit conventions; preserve IDs, relationships
and unrelated metadata. Compose EA and room projection at the existing app entry
with transaction rollback. Verify existing-install backfill eligibility. Inspect
active readers and prevent retired definitions appearing as active work. Refactor
shared conventions only where needed. Make AC1-AC5 green, including concurrency
and rollback tests, and run affected typechecks.

## Phase 4: delivery and live acceptance

Run impact-derived checks and required production build/PR gates. Document any
unrun gate. Ship one scoped signed PR through the merge queue, verify the resulting
image identity, use native self-upgrade when coordinated with the release owner,
and execute AC6 through the supported entrypoint with a governed test organization.
Record real evidence and independent acceptance before marking BI224E6E82 done.

## Risks and rollback

Transaction nesting, existing-install eligibility, concurrent duplicate creation,
retired-reader semantics and metadata loss are explicit regression cases. Preserve
history through failures. Revert via PR if necessary and reconcile after the fixed
image; never delete retained room data as rollback. No migration is currently
planned. A newly discovered schema change requires design amendment and migration
verification before delivery.

The current documentation scope impact contract has no testImpact or guardObligation
entries and identifies doc-index regeneration. Recompute impact for source scopes.
No tests or acceptance are claimed by this plan.
