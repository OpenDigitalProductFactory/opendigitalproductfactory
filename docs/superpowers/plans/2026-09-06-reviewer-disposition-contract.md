---
status: active
---
# BI-31159978 implementation coverage

The ordered implementation sequence, scope, objectives, acceptance criteria,
risks, and rollback are canonical in
[the repair design](../specs/2026-09-06-reviewer-disposition-contract-design.md).
This plan is the coverage locator required by record_plan_backlog_coverage.

## Backlog coverage

Parent and sole atomic delivery item: BI-31159978.

| Deliverable | Backlog item | Requirements | Contracts | Flow | Verification |
| --- | --- | --- | --- | --- | --- |
| reviewer-disposition | BI-31159978 | OBJ-RDC-001, OBJ-RDC-002, OBJ-RDC-003, OBJ-RDC-004 | canonical-disposition, immutable-review, persisted-status | read-review-write-readiness | AC-RDC-001, AC-RDC-002, AC-RDC-003, AC-RDC-004, AC-RDC-005, AC-RDC-006 |

Decision: atomic. The schema, writer, bounded correction, and completion
projection must agree in one release to preserve lossless independent review.
No phase is independently shippable. Initial coverage and independent research
and spec-approval receipts were recorded before implementation; the immutable
receipt records remain the authority for their reviewed versions.

The shared disposition contract, persisted outcome projection, and terminal
writer replay reservation are separate focused modules. Existing receipt and
TaskRun storage remain canonical; this repair introduces no parallel ledger.

## October 18 continuation, not yet admitted

The existing design's recurrence section owns the research-ordering and
wrong-gate finding correction contract. Keep its phases in this same atomic BI:

1. Reconcile the current approved baseline and author-research route through
   supported writers. Preserve original receipts, unresolved findings and exact
   source identity. Current PLAN admission IRD-B6670530D1FB is input-required;
   no implementation or new coverage receipt is established.
2. Once admitted, reproduce the sequencing failure and wrong-gate correction
   cases described in the design. Refactor the shared recovery guidance, then
   implement the provenance-preserving disposition in existing receipt storage.
   Require authorization, ownership, idempotency and transactional failure tests.
3. Run affected source tests, package typecheck and the full governed gate.
   Obtain independent review and protected publication. Verify the deployed
   original OAuth correction without claiming that its product defect is fixed.

These steps are internal sequencing, not independently delivered children.
The old coverage applies only to its recorded source and baseline. Obtain
current coverage before production edits; do not copy historical approval into
the continuation. Revert through the normal PR/release path if necessary;
never roll back by deleting receipts or editing live baseline records.

October 19 recovery prerequisite: restore the existing independent amendment
writer for retained approved repository baselines before step 1 can proceed.
Keep the ordinary body-only medium path and inherited scope ownership intact.
The existing design records the bounded gate-failure recovery, failing
regression, exact readiness refusal and authority boundary. This prerequisite
does not implement or approve the wrong-gate disposition proposal in step 2.
